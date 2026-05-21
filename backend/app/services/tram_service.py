"""
Tram service.

ficheHoraires response format (confirmed from API):
{
  "0": {                              <- direction index
    "arrets": [                       <- ordered stops
      {
        "stopId": "SEM:3393",
        "stopName": "Le Pont-de-Claix, L'Etoile",
        "lat": 45.13782,
        "lon": 5.70369,
        "trips": [39360, 40260, 41160, 42060]  <- departure times, secs since midnight
      },
      ...
    ]
  },
  "1": { ... }                        <- opposite direction
}

Each trip is identified by its position in the trips[] array (same index across all stops).
Trip N departs stop[0] at trips[0][N] seconds, stop[1] at trips[1][N] seconds, etc.
"""
import json
import math
import logging
from datetime import datetime, timezone, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import mreso_client
from app.models.models import TramLine, TramStop, StopTimeSnapshot
from app.core.redis_client import get_redis

log = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# SEEDING
# ─────────────────────────────────────────────────────────────────────────────

def _sort_multilinestring_segments(segments: list) -> list:
    """
    Sort MultiLineString segments so they form a continuous path.
    Line D has two segments that share a start point but go in opposite directions.
    We detect the direction by checking which end of seg0 is closest to an end of seg1,
    then reorder/reverse segments so they chain end-to-start.
    Returns a flat list of coordinates (LineString).
    """
    if len(segments) <= 1:
        return segments[0] if segments else []

    # Try all combinations: seg0 forward/reversed -> seg1 forward/reversed
    # Pick the arrangement that minimises the gap between seg[i] end and seg[i+1] start
    def dist(a, b):
        return math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2)

    def try_chain(segs):
        """Try to chain segments greedily: for each seg pick the next unvisited
        segment whose start or end is closest to the current endpoint."""
        remaining = list(enumerate(segs))
        result = list(segs[0])
        used = {0}
        current_end = result[-1]

        while len(used) < len(segs):
            best_idx, best_seg, best_reversed, best_d = None, None, False, float('inf')
            for i, seg in remaining:
                if i in used:
                    continue
                d_fwd = dist(current_end, seg[0])
                d_rev = dist(current_end, seg[-1])
                if d_fwd < best_d:
                    best_d, best_idx, best_seg, best_reversed = d_fwd, i, seg, False
                if d_rev < best_d:
                    best_d, best_idx, best_seg, best_reversed = d_rev, i, seg, True
            if best_idx is None:
                break
            used.add(best_idx)
            seg_to_add = list(reversed(best_seg)) if best_reversed else list(best_seg)
            # Skip duplicate junction point
            result.extend(seg_to_add[1:])
            current_end = result[-1]

        return result

    return try_chain(segments)


async def seed_lines(db: AsyncSession) -> None:
    routes = await mreso_client.fetch_all_routes()
    tram_routes = [r for r in routes if r.get("mode") == "TRAM"]
    log.info(f"Found {len(routes)} total routes, {len(tram_routes)} trams")

    for route in tram_routes:
        rid  = route.get("id", "")
        code = route.get("shortName", rid.split(":")[-1])
        sem_code = f"SEM_{code}"

        geo_data = await mreso_client.fetch_line_geometry(sem_code)

        geometry   = None
        total_dist = None
        if isinstance(geo_data, dict) and "features" in geo_data:
            for feat in geo_data["features"]:
                geom = feat.get("geometry", {})
                if geom.get("type") == "LineString":
                    geometry = geom
                    total_dist = _haversine_path(geom["coordinates"])
                    break
                elif geom.get("type") == "MultiLineString":
                    # Keep as MultiLineString — frontend renders it natively.
                    # Also store a sorted flat LineString for position interpolation.
                    flat_coords = _sort_multilinestring_segments(geom["coordinates"])
                    geometry = {
                        "type": "MultiLineString",
                        "coordinates": geom["coordinates"],
                        # Extra field used by position interpolation
                        "_flat": flat_coords,
                    }
                    total_dist = _haversine_path(flat_coords)
                    break

        log.info(f"Line {sem_code}: geometry={'yes' if geometry else 'NO'}, dist={total_dist}")

        line = await db.get(TramLine, sem_code)
        if not line:
            line = TramLine(id=sem_code)
            db.add(line)

        raw_color = route.get("color", "AAAAAA")
        raw_text  = route.get("textColor", "FFFFFF")
        line.code        = code
        line.long_name   = route.get("longName", code)
        line.color       = f"#{raw_color}" if not raw_color.startswith("#") else raw_color
        line.text_color  = f"#{raw_text}"  if not raw_text.startswith("#")  else raw_text
        line.mode        = "TRAM"
        line.geometry    = geometry
        line.total_distance_m = total_dist

    await db.commit()
    log.info("seed_lines: committed")


async def seed_stops(db: AsyncSession) -> None:
    """
    Extract stops from ficheHoraires for all tram lines.
    This is the only reliable stop-coordinate source since bbox endpoint returns 204.
    """
    seen = set()
    count = 0

    for route_id in mreso_client.TRAM_ROUTE_IDS:
        schedule = await mreso_client.fetch_line_schedule(route_id)
        for direction in schedule.values():
            for arret in direction.get("arrets", []):
                sid = arret.get("stopId", "")
                lat = arret.get("lat")
                lon = arret.get("lon")
                name = arret.get("stopName") or arret.get("name") or sid
                if not sid or lat is None or lon is None or sid in seen:
                    continue
                seen.add(sid)

                stop = await db.get(TramStop, sid)
                if not stop:
                    stop = TramStop(id=sid)
                    db.add(stop)
                stop.name = name
                stop.lat  = float(lat)
                stop.lon  = float(lon)
                count += 1

    await db.commit()
    log.info(f"seed_stops: committed {count} stops from ficheHoraires")


# ─────────────────────────────────────────────────────────────────────────────
# TRAM POSITIONS  (schedule-interpolated)
# ─────────────────────────────────────────────────────────────────────────────

async def get_tram_positions(db: AsyncSession) -> list[dict]:
    """
    Compute current tram positions by interpolating along line geometry.
    Uses ficheHoraires schedule. Cached 10s in Redis.
    """
    redis = await get_redis()
    cached = await redis.get("tram:positions")
    if cached:
        return json.loads(cached)

    result = await db.execute(text(
        "SELECT id, code, color, geometry, total_distance_m FROM tram_lines"
    ))
    lines = result.mappings().all()

    positions = []
    now_utc = datetime.now(timezone.utc)
    now = (now_utc + timedelta(hours=2)).replace(tzinfo=None)

    for line in lines:
        if not line["geometry"]:
            continue

        geom = line["geometry"]
        # Use the sorted flat coords for interpolation; fall back to coordinates if LineString
        if geom.get("type") == "MultiLineString":
            coords = geom.get("_flat") or _sort_multilinestring_segments(geom["coordinates"])
        else:
            coords = geom["coordinates"]

        route_id = f"SEM:{line['code']}"

        schedule     = await mreso_client.fetch_line_schedule(route_id)
        active_trips = _find_active_trips_from_schedule(schedule, now)
        log.debug(f"Line {route_id}: {len(active_trips)} active trips at {now.strftime('%H:%M')}")

        for trip in active_trips:
            pos = _interpolate_on_geometry(coords, trip["progress"])
            if pos:
                positions.append({
                    "line_id":     line["id"],
                    "line_code":   line["code"],
                    "color":       line["color"] or "#888888",
                    "trip_id":     trip["trip_id"],
                    "lat":         pos[1],
                    "lon":         pos[0],
                    "heading":     pos[2],
                    "progress":    trip["progress"],
                    "delay_s":     0,
                    "next_stop":   trip.get("next_stop"),
                    "destination": trip.get("destination"),
                })

    await redis.setex("tram:positions", 10, json.dumps(positions))
    return positions


def _find_active_trips_from_schedule(schedule: dict, now: datetime) -> list[dict]:
    trips = []
    now_secs = now.hour * 3600 + now.minute * 60 + now.second

    for dir_key, direction in schedule.items():
        arrets = direction.get("arrets", [])
        if len(arrets) < 2:
            continue

        first_stop = arrets[0]
        last_stop  = arrets[-1]

        first_trips = first_stop.get("trips", [])
        last_trips  = last_stop.get("trips", [])

        if not first_trips or not last_trips:
            continue

        n_trips = min(len(first_trips), len(last_trips))
        dest = last_stop.get("stopName") or last_stop.get("name", "")

        for i in range(n_trips):
            try:
                dep_secs = int(first_trips[i])
                arr_secs = int(last_trips[i])
            except (TypeError, ValueError):
                continue

            if arr_secs < dep_secs:
                arr_secs += 86400

            if dep_secs <= now_secs <= arr_secs:
                duration = arr_secs - dep_secs
                elapsed  = now_secs - dep_secs
                progress = max(0.0, min(1.0, elapsed / duration)) if duration > 0 else 0.0

                next_stop_name = None
                for arret in arrets:
                    t = arret.get("trips", [])
                    try:
                        if i < len(t) and t[i] is not None and int(t[i]) > now_secs:
                            next_stop_name = arret.get("stopName") or arret.get("name")
                            break
                    except (TypeError, ValueError):
                        continue

                trips.append({
                    "trip_id":    f"{dir_key}_{i}",
                    "dep_secs":   dep_secs,
                    "arr_secs":   arr_secs,
                    "progress":   progress,
                    "destination": dest,
                    "next_stop":  next_stop_name,
                })

    return trips


def _interpolate_on_geometry(coords: list, progress: float) -> tuple | None:
    """Walk along polyline coords to the point at fractional progress 0-1."""
    total, segments = 0.0, []
    for i in range(len(coords) - 1):
        d = _haversine(coords[i], coords[i + 1])
        segments.append(d)
        total += d
    if total == 0:
        return None

    target, walked = progress * total, 0.0
    for i, seg_len in enumerate(segments):
        if walked + seg_len >= target:
            t = (target - walked) / seg_len if seg_len > 0 else 0
            lon = coords[i][0] + t * (coords[i+1][0] - coords[i][0])
            lat = coords[i][1] + t * (coords[i+1][1] - coords[i][1])
            return (lon, lat, _bearing(coords[i], coords[i+1]), progress)
        walked += seg_len

    return (coords[-1][0], coords[-1][1], 0.0, 1.0)


def _haversine(a, b):
    R = 6371000
    lo1, la1 = math.radians(a[0]), math.radians(a[1])
    lo2, la2 = math.radians(b[0]), math.radians(b[1])
    h = (math.sin((la2-la1)/2)**2
         + math.cos(la1)*math.cos(la2)*math.sin((lo2-lo1)/2)**2)
    return 2 * R * math.asin(math.sqrt(h))


def _haversine_path(coords):
    return sum(_haversine(coords[i], coords[i+1]) for i in range(len(coords)-1))


def _bearing(a, b):
    la1, la2 = math.radians(a[1]), math.radians(b[1])
    dlo = math.radians(b[0] - a[0])
    x = math.sin(dlo) * math.cos(la2)
    y = math.cos(la1)*math.sin(la2) - math.sin(la1)*math.cos(la2)*math.cos(dlo)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


# ─────────────────────────────────────────────────────────────────────────────
# ANALYTICS
# ─────────────────────────────────────────────────────────────────────────────

async def get_delay_probability(db: AsyncSession, line_id: str | None = None) -> list[dict]:
    where = "WHERE delay_seconds IS NOT NULL"
    params: dict = {}
    if line_id:
        where += " AND line_id = :line_id"
        params["line_id"] = line_id
    sql = text(f"""
        SELECT line_id, COUNT(*) AS total_samples,
            SUM(CASE WHEN delay_seconds > 60 THEN 1 ELSE 0 END) AS delayed_count,
            ROUND(100.0*SUM(CASE WHEN delay_seconds>60 THEN 1 ELSE 0 END)::numeric
                  /NULLIF(COUNT(*),0),1) AS delay_probability
        FROM stop_time_snapshots {where}
        GROUP BY line_id ORDER BY delay_probability DESC NULLS LAST
    """)
    result = await db.execute(sql, params)
    return [dict(r) for r in result.mappings()]


async def get_reliability_score(db: AsyncSession, stop_id: str | None = None) -> list[dict]:
    where = "WHERE s.delay_seconds IS NOT NULL"
    params: dict = {}
    if stop_id:
        where += " AND s.stop_id = :stop_id"
        params["stop_id"] = stop_id
    sql = text(f"""
        SELECT s.stop_id, t.name AS stop_name, COUNT(*) AS total_samples,
            ROUND(AVG(ABS(s.delay_seconds)),0) AS avg_abs_delay_s,
            GREATEST(0,LEAST(100,ROUND(100-AVG(ABS(s.delay_seconds))/30.0,1))) AS reliability_score
        FROM stop_time_snapshots s LEFT JOIN tram_stops t ON t.id=s.stop_id
        {where} GROUP BY s.stop_id, t.name ORDER BY reliability_score DESC
    """)
    result = await db.execute(sql, params)
    return [dict(r) for r in result.mappings()]


async def get_historical_punctuality(
    db: AsyncSession, line_id: str | None = None, hours: int = 24
) -> list[dict]:
    where = f"WHERE collected_at >= NOW() - INTERVAL '{int(hours)} hours' AND delay_seconds IS NOT NULL"
    params: dict = {}
    if line_id:
        where += " AND line_id = :line_id"
        params["line_id"] = line_id
    sql = text(f"""
        SELECT date_trunc('hour',collected_at) AS hour_bucket, line_id,
            ROUND(AVG(delay_seconds),0) AS avg_delay_s,
            ROUND(100.0*SUM(CASE WHEN delay_seconds BETWEEN -60 AND 60 THEN 1 ELSE 0 END)::numeric
                  /NULLIF(COUNT(*),0),1) AS on_time_pct
        FROM stop_time_snapshots {where}
        GROUP BY hour_bucket, line_id ORDER BY hour_bucket ASC, line_id
    """)
    result = await db.execute(sql, params)
    return [dict(r) for r in result.mappings()]