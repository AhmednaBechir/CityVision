"""
Background scheduler — collects real-time data into Postgres every 60s.

Jobs:
  collect_tram_stoptimes    — polls ficheHoraires, saves StopTimeSnapshot rows
  collect_parking_snapshots — polls dyn/parking, saves ParkingSnapshot rows
  on startup                — seeds static data
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
from app.models.models import StopTimeSnapshot, ParkingSnapshot, ParkingLocation
from sqlalchemy import text

log = logging.getLogger(__name__)
settings = get_settings()
scheduler = AsyncIOScheduler()


async def collect_tram_stoptimes():
    """
    For each tram line, fetch schedule window and save StopTimeSnapshot rows
    for any trip that is currently active (so we build delay history over time).
    Since ficheHoraires gives scheduled times only (no real-time delay),
    delay_seconds will be 0 unless we later get a real-time source.
    """
    async with AsyncSessionLocal() as db:
        try:
            now = datetime.utcnow()
            now_local = datetime.now()
            now_secs = now_local.hour * 3600 + now_local.minute * 60 + now_local.second
            snapshots = []

            for route_id in mreso_client.TRAM_ROUTE_IDS:
                line_id = f"SEM_{route_id.split(':')[1]}"
                schedule = await mreso_client.fetch_line_schedule(route_id)

                for dir_key, direction in schedule.items():
                    arrets = direction.get("arrets", [])
                    if len(arrets) < 2:
                        continue
                    first_stop = arrets[0]
                    last_stop  = arrets[-1]
                    first_trips = first_stop.get("trips", [])
                    last_trips  = last_stop.get("trips", [])
                    n = min(len(first_trips), len(last_trips))

                    for i in range(n):
                        try:
                            dep = int(first_trips[i])
                            arr = int(last_trips[i])
                        except (TypeError, ValueError):
                            continue
                        if arr < dep:
                            arr += 86400
                        if not (dep <= now_secs <= arr):
                            continue

                        # Walk through all stops for this trip
                        for arret in arrets:
                            stop_id = arret.get("stopId", "")
                            trips_at_stop = arret.get("trips", [])
                            if i >= len(trips_at_stop):
                                continue
                            try:
                                sched_secs = int(trips_at_stop[i])
                            except (TypeError, ValueError):
                                continue

                            base = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
                            sched_dt = base + timedelta(seconds=sched_secs)

                            snap = StopTimeSnapshot(
                                line_id=line_id,
                                stop_id=stop_id,
                                trip_id=f"{route_id}_{dir_key}_{i}",
                                scheduled_departure=sched_dt,
                                realtime_departure=None,
                                delay_seconds=0,   # no real-time source
                                is_realtime=False,
                                collected_at=now,
                            )
                            snapshots.append(snap)

            db.add_all(snapshots)
            await db.commit()
            log.info(f"collect_tram_stoptimes: saved {len(snapshots)} snapshots")
        except Exception as e:
            log.error(f"collect_tram_stoptimes error: {e}")
            await db.rollback()


async def collect_parking_snapshots():
    """
    Fetch live parking data and persist availability snapshots.
    fetch_parking_dynamic() returns a dict {id: {nb_places_libres, ...}}.
    """
    async with AsyncSessionLocal() as db:
        try:
            dynamic = await mreso_client.fetch_parking_dynamic()
            now = datetime.utcnow()
            snapshots = []

            # Load capacity info from DB
            result = await db.execute(text("SELECT id, capacity FROM parking_locations"))
            capacity_map = {r["id"]: r["capacity"] for r in result.mappings()}

            for pid, dyn in dynamic.items():
                if not isinstance(dyn, dict):
                    continue

                available_raw = dyn.get("nb_places_libres")
                if available_raw is None:
                    continue  # no real-time data for this parking, skip

                try:
                    available = int(available_raw)
                except (TypeError, ValueError):
                    continue

                capacity = capacity_map.get(pid)
                occupied = (capacity - available) if capacity else None
                occ_pct  = round(occupied / capacity * 100, 2) if (occupied is not None and capacity) else None

                # Upsert parking location if unknown
                if pid not in capacity_map:
                    existing = await db.get(ParkingLocation, pid)
                    if not existing:
                        loc = ParkingLocation(id=pid, name=pid, lon=0, lat=0, type="parking")
                        db.add(loc)

                snap = ParkingSnapshot(
                    parking_id=pid,
                    available=available,
                    occupied=occupied,
                    occupancy_pct=occ_pct,
                    is_open=True,
                    collected_at=now,
                )
                snapshots.append(snap)

            db.add_all(snapshots)
            await db.commit()
            log.info(f"collect_parking_snapshots: saved {len(snapshots)} snapshots")
        except Exception as e:
            log.error(f"collect_parking_snapshots error: {e}")
            await db.rollback()


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
    scheduler.add_job(collect_tram_stoptimes,    IntervalTrigger(seconds=interval), id="tram_collect")
    scheduler.add_job(collect_parking_snapshots, IntervalTrigger(seconds=interval), id="parking_collect")
    scheduler.start()
    log.info(f"Scheduler started — collecting every {interval}s")