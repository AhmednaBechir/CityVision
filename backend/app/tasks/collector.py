"""
Background scheduler — collects real-time data and stores snapshots in Postgres.

Jobs:
  every 60s  → collect tram stop times and save StopTimeSnapshot rows
  every 60s  → collect parking availability and save ParkingSnapshot rows
  on startup → seed static data (lines, stops, parking locations)
"""
import logging
from datetime import datetime, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.core.config import get_settings
from app.services import mreso_client
from app.services.tram_service import seed_lines, seed_stops
from app.services.parking_service import seed_parking
from app.models.models import StopTimeSnapshot, ParkingSnapshot, ParkingLocation, TramStop, TramLine
from sqlalchemy import text

log = logging.getLogger(__name__)
settings = get_settings()
scheduler = AsyncIOScheduler()


# ─────────────────────────────────────────────────────────────────────────────
# TRAM COLLECTION
# ─────────────────────────────────────────────────────────────────────────────

async def collect_tram_stoptimes():
    """
    For each tram stop in DB, hit the real-time stop-times endpoint
    and persist delay data.
    """
    async with AsyncSessionLocal() as db:
        try:
            result = await db.execute(text("SELECT id, name FROM tram_stops LIMIT 200"))
            stops = result.mappings().all()

            now = datetime.utcnow()
            snapshots = []

            for stop in stops:
                times_data = await mreso_client.fetch_stop_times(stop["id"])
                for route_info in times_data:
                    # Each item may have multiple times
                    route_id = route_info.get("pattern", {}).get("route", {}).get("id") or ""
                    # Only track tram lines (SEM:A..E)
                    if not any(f"SEM:{c}" in route_id for c in "ABCDE"):
                        continue
                    line_id = f"SEM_{route_id.split(':')[-1]}" if ":" in route_id else None

                    for t in route_info.get("times", []):
                        sched = t.get("scheduledDeparture")
                        rt    = t.get("realtimeDeparture")
                        is_rt = t.get("realtime", False)

                        if sched is None:
                            continue

                        # times are seconds-since-midnight
                        base = now.replace(hour=0, minute=0, second=0, microsecond=0)
                        sched_dt = base + timedelta(seconds=int(sched))
                        rt_dt    = (base + timedelta(seconds=int(rt))) if rt else None
                        delay    = (rt_dt - sched_dt).seconds if (rt_dt and sched_dt) else None
                        # negative if early
                        if delay and delay > 3600:
                            delay = delay - 86400  # wrap around midnight

                        snap = StopTimeSnapshot(
                            line_id=line_id or route_id,
                            stop_id=stop["id"],
                            trip_id=t.get("tripId"),
                            scheduled_departure=sched_dt,
                            realtime_departure=rt_dt,
                            delay_seconds=delay,
                            is_realtime=bool(is_rt),
                            collected_at=now,
                        )
                        snapshots.append(snap)

            db.add_all(snapshots)
            await db.commit()
            log.info(f"Collected {len(snapshots)} tram stop-time snapshots")
        except Exception as e:
            log.error(f"collect_tram_stoptimes error: {e}")
            await db.rollback()


# ─────────────────────────────────────────────────────────────────────────────
# PARKING COLLECTION
# ─────────────────────────────────────────────────────────────────────────────

async def collect_parking_snapshots():
    """
    Fetch live parking data and persist availability snapshots.
    """
    async with AsyncSessionLocal() as db:
        try:
            dynamic = await mreso_client.fetch_parking_dynamic()
            now = datetime.utcnow()
            snapshots = []

            for item in dynamic:
                pid = str(item.get("id", item.get("ID_PARKING", "")))
                if not pid:
                    continue

                available = item.get("dispo", item.get("DISPO", item.get("placesDisponibles")))
                capacity_raw = item.get("capacite", item.get("CAPACITE", item.get("capacity")))
                is_open = item.get("status", "OUVERT") in ("OUVERT", "OPEN", 1, "1")

                try:
                    available = int(available) if available is not None else None
                    capacity  = int(capacity_raw) if capacity_raw else None
                except (ValueError, TypeError):
                    available, capacity = None, None

                occupied  = (capacity - available) if (capacity and available is not None) else None
                occ_pct   = (occupied / capacity * 100) if (occupied is not None and capacity) else None

                # Upsert parking location if unknown
                existing = await db.get(ParkingLocation, pid)
                if not existing:
                    lon = item.get("x", item.get("lon"))
                    lat = item.get("y", item.get("lat"))
                    if lon and lat:
                        from app.services.parking_service import classify_zone
                        loc = ParkingLocation(
                            id=pid,
                            name=item.get("nom", pid),
                            lon=float(lon),
                            lat=float(lat),
                            capacity=capacity,
                            type="PAR",
                            zone=classify_zone(float(lon), float(lat)),
                        )
                        db.add(loc)

                snap = ParkingSnapshot(
                    parking_id=pid,
                    available=available,
                    occupied=occupied,
                    occupancy_pct=round(occ_pct, 2) if occ_pct else None,
                    is_open=is_open,
                    collected_at=now,
                )
                snapshots.append(snap)

            db.add_all(snapshots)
            await db.commit()
            log.info(f"Collected {len(snapshots)} parking snapshots")
        except Exception as e:
            log.error(f"collect_parking_snapshots error: {e}")
            await db.rollback()


# ─────────────────────────────────────────────────────────────────────────────
# SEED ON STARTUP
# ─────────────────────────────────────────────────────────────────────────────

async def run_seed():
    async with AsyncSessionLocal() as db:
        try:
            log.info("Seeding static data...")
            await seed_lines(db)
            await seed_stops(db)
            await seed_parking(db)
            log.info("Static seed complete.")
        except Exception as e:
            log.error(f"Seed error: {e}")


def start_scheduler():
    interval = settings.COLLECT_INTERVAL_SECONDS
    scheduler.add_job(collect_tram_stoptimes, IntervalTrigger(seconds=interval), id="tram_collect")
    scheduler.add_job(collect_parking_snapshots, IntervalTrigger(seconds=interval), id="parking_collect")
    scheduler.start()
    log.info(f"Scheduler started — collecting every {interval}s")
