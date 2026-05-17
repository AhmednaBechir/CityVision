"""
Parking service — handles:
  - seeding static parking locations from Mreso API
  - fetching live availability (PAR dynamic endpoint)
  - collecting snapshots for occupancy-over-time
  - zone grouping, congestion detection, trend forecasting
"""
import json
import logging
import math
from datetime import datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import mreso_client
from app.models.models import ParkingLocation, ParkingSnapshot
from app.core.redis_client import get_redis

log = logging.getLogger(__name__)

# Grenoble rough zone classification by coordinates
ZONES = {
    "Centre":       (5.7200, 45.1880, 0.012),   # (lon, lat, radius_deg)
    "Gare":         (5.7160, 45.1913, 0.008),
    "Campus":       (5.7676, 45.1942, 0.015),
    "Presqu'île":   (5.7107, 45.1850, 0.010),
    "Sud":          (5.7200, 45.1700, 0.020),
    "Nord":         (5.7200, 45.2100, 0.020),
}

CONGESTION_THRESHOLD_PCT = 85.0   # above this = congested


def classify_zone(lon: float, lat: float) -> str:
    best, best_d = "Autre", float("inf")
    for zone, (zlon, zlat, r) in ZONES.items():
        d = math.sqrt((lon - zlon) ** 2 + (lat - zlat) ** 2)
        if d < r and d < best_d:
            best, best_d = zone, d
    return best


# ─────────────────────────────────────────────────────────────────────────────
# SEEDING
# ─────────────────────────────────────────────────────────────────────────────

async def seed_parking(db: AsyncSession) -> None:
    """Fetch static parking data and upsert to DB."""
    geo = await mreso_client.fetch_parking_static()
    features = geo.get("features", [])
    log.info(f"Seeding {len(features)} parking locations")

    for feat in features:
        props = feat.get("properties", {})
        coords = feat.get("geometry", {}).get("coordinates", [None, None])
        pid = str(props.get("id", props.get("ID_PARKING", props.get("CODE_LIEU"))))
        if not pid or pid == "None":
            continue
        lon, lat = float(coords[0]), float(coords[1])

        parking = await db.get(ParkingLocation, pid)
        if not parking:
            parking = ParkingLocation(id=pid)
            db.add(parking)

        parking.name = props.get("NOM", props.get("name", pid))
        parking.lon = lon
        parking.lat = lat
        parking.capacity = props.get("CAPACITY", props.get("capacity"))
        parking.type = "PAR"
        parking.zone = classify_zone(lon, lat)
        parking.address = props.get("ADRESSE")

    await db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# LIVE DATA
# ─────────────────────────────────────────────────────────────────────────────

async def get_live_parking(db: AsyncSession) -> list[dict]:
    """
    Fetch real-time parking availability and enrich with static metadata.
    Cached in Redis for 30 seconds.
    """
    redis = await get_redis()
    cache_key = "parking:live"
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    dynamic = await mreso_client.fetch_parking_dynamic()

    # Build lookup from DB
    result = await db.execute(text("SELECT id, name, lon, lat, capacity, zone FROM parking_locations"))
    db_map = {r["id"]: dict(r) for r in result.mappings()}

    enriched = []
    for item in dynamic:
        pid = str(item.get("id", item.get("ID_PARKING", "")))
        available = item.get("dispo", item.get("DISPO", item.get("placesDisponibles")))
        capacity = item.get("capacite", item.get("CAPACITE", item.get("capacity")))
        is_open = item.get("status", item.get("STATUS", "OUVERT")) in ("OUVERT", "OPEN", 1, "1")
        name = item.get("nom", item.get("NOM", pid))
        lon = item.get("x", item.get("lon", item.get("longitude")))
        lat = item.get("y", item.get("lat", item.get("latitude")))

        # Try to coerce
        try:
            available = int(available) if available is not None else None
        except (ValueError, TypeError):
            available = None
        try:
            capacity = int(capacity) if capacity else None
        except (ValueError, TypeError):
            capacity = None

        occupied = (capacity - available) if (capacity and available is not None) else None
        occ_pct = (occupied / capacity * 100) if (occupied is not None and capacity) else None

        meta = db_map.get(pid, {})
        entry = {
            "id": pid,
            "name": meta.get("name", name),
            "lon": meta.get("lon", lon),
            "lat": meta.get("lat", lat),
            "capacity": meta.get("capacity", capacity),
            "available": available,
            "occupied": occupied,
            "occupancy_pct": round(occ_pct, 1) if occ_pct is not None else None,
            "is_open": is_open,
            "zone": meta.get("zone", classify_zone(float(lon), float(lat)) if lon and lat else "Autre"),
            "is_congested": occ_pct is not None and occ_pct >= CONGESTION_THRESHOLD_PCT,
        }
        enriched.append(entry)

    await redis.setex(cache_key, 30, json.dumps(enriched))
    return enriched


# ─────────────────────────────────────────────────────────────────────────────
# ANALYTICS
# ─────────────────────────────────────────────────────────────────────────────

async def get_availability_by_zone(db: AsyncSession) -> list[dict]:
    """Latest available spaces grouped by zone."""
    sql = text("""
        WITH latest AS (
            SELECT DISTINCT ON (ps.parking_id)
                ps.parking_id, ps.available, ps.occupancy_pct, ps.collected_at
            FROM parking_snapshots ps
            ORDER BY ps.parking_id, ps.collected_at DESC
        )
        SELECT
            pl.zone,
            COUNT(l.parking_id) AS parking_count,
            SUM(l.available) AS total_available,
            SUM(pl.capacity) AS total_capacity,
            ROUND(AVG(l.occupancy_pct), 1) AS avg_occupancy_pct
        FROM latest l
        JOIN parking_locations pl ON pl.id = l.parking_id
        GROUP BY pl.zone
        ORDER BY avg_occupancy_pct DESC NULLS LAST
    """)
    result = await db.execute(sql)
    return [dict(r) for r in result.mappings()]


async def get_occupancy_over_time(
    db: AsyncSession,
    parking_id: str | None = None,
    hours: int = 24,
) -> list[dict]:
    """Hourly average occupancy for one or all parkings."""
    where = "WHERE ps.collected_at >= NOW() - INTERVAL '" + str(hours) + "' "
    params: dict[str, Any] = {"h": hours}
    if parking_id:
        where += " AND ps.parking_id = :pid"
        params["pid"] = parking_id

    sql = text(f"""
        SELECT
            date_trunc('hour', ps.collected_at) AS hour_bucket,
            ps.parking_id,
            pl.name AS parking_name,
            pl.zone,
            ROUND(AVG(ps.occupancy_pct), 1) AS avg_occupancy_pct,
            ROUND(AVG(ps.available), 0) AS avg_available
        FROM parking_snapshots ps
        JOIN parking_locations pl ON pl.id = ps.parking_id
        {where}
        GROUP BY hour_bucket, ps.parking_id, pl.name, pl.zone
        ORDER BY hour_bucket ASC
    """)
    result = await db.execute(sql, params)
    return [dict(r) for r in result.mappings()]


async def get_congested_zones(db: AsyncSession) -> list[dict]:
    """
    Detect zones currently at or above the congestion threshold.
    Uses the most recent snapshot per parking.
    """
    sql = text("""
        WITH latest AS (
            SELECT DISTINCT ON (parking_id)
                parking_id, occupancy_pct, collected_at
            FROM parking_snapshots
            ORDER BY parking_id, collected_at DESC
        )
        SELECT
            pl.zone,
            COUNT(*) AS total_in_zone,
            SUM(CASE WHEN l.occupancy_pct >= :thresh THEN 1 ELSE 0 END) AS congested_count,
            ROUND(AVG(l.occupancy_pct), 1) AS avg_pct,
            CASE WHEN AVG(l.occupancy_pct) >= :thresh THEN true ELSE false END AS is_congested
        FROM latest l
        JOIN parking_locations pl ON pl.id = l.parking_id
        GROUP BY pl.zone
        ORDER BY avg_pct DESC NULLS LAST
    """)
    result = await db.execute(sql, {"thresh": CONGESTION_THRESHOLD_PCT})
    return [dict(r) for r in result.mappings()]


async def get_availability_trend(
    db: AsyncSession,
    parking_id: str,
    hours: int = 48,
) -> dict:
    """
    Simple linear trend forecast for a parking:
    uses last N hours of data to predict next 3 hours.
    """
    rows = await get_occupancy_over_time(db, parking_id, hours)
    if len(rows) < 3:
        return {"parking_id": parking_id, "trend": "insufficient_data", "forecast": []}

    # Simple linear regression on occupancy_pct
    n = len(rows)
    x_vals = list(range(n))
    y_vals = [r["avg_occupancy_pct"] or 0 for r in rows]
    x_mean = sum(x_vals) / n
    y_mean = sum(y_vals) / n
    slope_num = sum((x - x_mean) * (y - y_mean) for x, y in zip(x_vals, y_vals))
    slope_den = sum((x - x_mean) ** 2 for x in x_vals)
    slope = slope_num / slope_den if slope_den else 0
    intercept = y_mean - slope * x_mean

    forecast = []
    for i in range(1, 4):
        predicted_pct = max(0, min(100, round(slope * (n + i) + intercept, 1)))
        forecast.append({
            "hours_ahead": i,
            "predicted_occupancy_pct": predicted_pct,
        })

    trend_label = "increasing" if slope > 1 else "decreasing" if slope < -1 else "stable"
    return {
        "parking_id": parking_id,
        "trend": trend_label,
        "slope_per_hour": round(slope, 2),
        "forecast": forecast,
    }