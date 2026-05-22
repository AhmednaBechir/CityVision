"""
Parking service.

Static data:  /api/bbox/json?types=parking
  → id, nom, adresse, nb_places, nb_pr, gratuit, hauteur_max

Dynamic data: /api/dyn/parking/json
  → nb_places_libres (real-time available spaces, null when no feed)

When nb_places_libres is null we show capacity info only (no occupancy %).
"""
import json
import logging
import math
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import mreso_client
from app.models.models import ParkingLocation, ParkingSnapshot
from app.core.redis_client import get_redis

log = logging.getLogger(__name__)

CONGESTION_THRESHOLD_PCT = 85.0

# Grenoble zone classification by coordinates
ZONES = {
    "Centre":      (5.7200, 45.1880, 0.012),
    "Gare":        (5.7160, 45.1913, 0.008),
    "Campus":      (5.7676, 45.1942, 0.015),
    "Presqu'île":  (5.7107, 45.1850, 0.010),
    "Sud":         (5.7200, 45.1700, 0.020),
    "Nord":        (5.7200, 45.2100, 0.020),
}


def classify_zone(lon: float, lat: float) -> str:
    best, best_d = "Autre", float("inf")
    for zone, (zlon, zlat, r) in ZONES.items():
        d = math.sqrt((lon - zlon) ** 2 + (lat - zlat) ** 2)
        if d < r and d < best_d:
            best, best_d = zone, d
    return best


# ── SEEDING ────────────────────────────────────────────────────────────────

async def seed_parking(db: AsyncSession) -> None:
    """Fetch real parking locations from API and upsert to DB."""
    features = await mreso_client.fetch_parking_static()
    log.info(f"Seeding {len(features)} parking locations")

    for feat in features:
        props  = feat.get("properties", {})
        coords = feat.get("geometry", {}).get("coordinates", [None, None])
        if not coords or coords[0] is None:
            continue

        pid = str(props.get("id", ""))
        if not pid:
            continue

        try:
            lon, lat = float(coords[0]), float(coords[1])
        except (TypeError, ValueError):
            continue

        parking = await db.get(ParkingLocation, pid)
        if not parking:
            parking = ParkingLocation(id=pid)
            db.add(parking)

        parking.name     = props.get("nom") or pid
        parking.lon      = lon
        parking.lat      = lat
        parking.capacity = props.get("nb_places") or props.get("nb_pr") or None
        parking.type     = "parking"
        parking.zone     = classify_zone(lon, lat)
        parking.address  = props.get("adresse")

    await db.commit()
    log.info("seed_parking: committed")


# ── LIVE DATA ──────────────────────────────────────────────────────────────

async def get_live_parking(db: AsyncSession) -> list[dict]:
    """
    Merge static parking metadata with real-time availability.
    Cached 30s in Redis.
    """
    redis = await get_redis()
    cached = await redis.get("parking:live")
    if cached:
        return json.loads(cached)

    # Get static metadata from DB
    result = await db.execute(text(
        "SELECT id, name, lon, lat, capacity, zone, address FROM parking_locations"
    ))
    db_rows = {r["id"]: dict(r) for r in result.mappings()}

    # Get real-time availability
    dynamic = await mreso_client.fetch_parking_dynamic()

    enriched = []
    for pid, meta in db_rows.items():
        dyn = dynamic.get(pid, {})
        available = dyn.get("nb_places_libres")  # null = no real-time feed
        capacity  = meta["capacity"]

        occupied  = None
        occ_pct   = None
        if available is not None and capacity:
            try:
                available = int(available)
                occupied  = max(0, capacity - available)
                occ_pct   = round(occupied / capacity * 100, 1)
            except (TypeError, ValueError):
                available = None

        enriched.append({
            "id":             pid,
            "name":           meta["name"],
            "lon":            meta["lon"],
            "lat":            meta["lat"],
            "capacity":       capacity,
            "available":      available,
            "occupied":       occupied,
            "occupancy_pct":  occ_pct,
            "is_open":        True,
            "zone":           meta["zone"],
            "address":        meta["address"],
            "has_realtime":   available is not None,
            "is_congested":   occ_pct is not None and occ_pct >= CONGESTION_THRESHOLD_PCT,
        })

    await redis.setex("parking:live", 30, json.dumps(enriched))
    return enriched


# ── ANALYTICS ─────────────────────────────────────────────────────────────

async def get_availability_by_zone(db: AsyncSession) -> list[dict]:
    """Latest available spaces grouped by zone (from DB snapshots)."""
    sql = text("""
        WITH latest AS (
            SELECT DISTINCT ON (ps.parking_id)
                ps.parking_id, ps.available, ps.occupancy_pct
            FROM parking_snapshots ps
            ORDER BY ps.parking_id, ps.collected_at DESC
        )
        SELECT
            pl.zone,
            COUNT(l.parking_id)        AS parking_count,
            SUM(l.available)           AS total_available,
            SUM(pl.capacity)           AS total_capacity,
            ROUND(AVG(l.occupancy_pct)::numeric, 1) AS avg_occupancy_pct
        FROM latest l
        JOIN parking_locations pl ON pl.id = l.parking_id
        GROUP BY pl.zone
        ORDER BY avg_occupancy_pct DESC NULLS LAST
    """)
    result = await db.execute(sql)
    return [dict(r) for r in result.mappings()]


async def get_occupancy_over_time(
    db: AsyncSession, parking_id: str | None = None, hours: int = 24
) -> list[dict]:
    where = f"WHERE ps.collected_at >= NOW() - INTERVAL '{int(hours)} hours'"
    params: dict = {}
    if parking_id:
        where += " AND ps.parking_id = :pid"
        params["pid"] = parking_id
    sql = text(f"""
        SELECT date_trunc('hour', ps.collected_at) AS hour_bucket,
            ps.parking_id, pl.name AS parking_name, pl.zone,
            ROUND(AVG(ps.occupancy_pct)::numeric, 1) AS avg_occupancy_pct,
            ROUND(AVG(ps.available)::numeric, 0)     AS avg_available
        FROM parking_snapshots ps
        JOIN parking_locations pl ON pl.id = ps.parking_id
        {where}
        GROUP BY hour_bucket, ps.parking_id, pl.name, pl.zone
        ORDER BY hour_bucket ASC
    """)
    result = await db.execute(sql, params)
    return [dict(r) for r in result.mappings()]


async def get_congested_zones(db: AsyncSession) -> list[dict]:
    sql = text(f"""
        WITH latest AS (
            SELECT DISTINCT ON (parking_id)
                parking_id, occupancy_pct
            FROM parking_snapshots
            ORDER BY parking_id, collected_at DESC
        )
        SELECT pl.zone,
            COUNT(*)  AS total_in_zone,
            SUM(CASE WHEN l.occupancy_pct >= {CONGESTION_THRESHOLD_PCT} THEN 1 ELSE 0 END) AS congested_count,
            ROUND(AVG(l.occupancy_pct)::numeric, 1) AS avg_pct,
            AVG(l.occupancy_pct) >= {CONGESTION_THRESHOLD_PCT} AS is_congested
        FROM latest l
        JOIN parking_locations pl ON pl.id = l.parking_id
        GROUP BY pl.zone
        ORDER BY avg_pct DESC NULLS LAST
    """)
    result = await db.execute(sql)
    return [dict(r) for r in result.mappings()]


async def get_availability_trend(db: AsyncSession, parking_id: str, hours: int = 48) -> dict:
    rows = await get_occupancy_over_time(db, parking_id, hours)
    if len(rows) < 3:
        return {"parking_id": parking_id, "trend": "insufficient_data", "forecast": []}
    n = len(rows)
    x_vals = list(range(n))
    y_vals = [r["avg_occupancy_pct"] or 0 for r in rows]
    x_mean, y_mean = sum(x_vals) / n, sum(y_vals) / n
    num = sum((x - x_mean) * (y - y_mean) for x, y in zip(x_vals, y_vals))
    den = sum((x - x_mean) ** 2 for x in x_vals)
    slope = num / den if den else 0
    intercept = y_mean - slope * x_mean
    forecast = [
        {"hours_ahead": i,
         "predicted_occupancy_pct": max(0, min(100, round(slope * (n + i) + intercept, 1)))}
        for i in range(1, 4)
    ]
    trend = "increasing" if slope > 1 else "decreasing" if slope < -1 else "stable"
    return {"parking_id": parking_id, "trend": trend,
            "slope_per_hour": round(slope, 2), "forecast": forecast}