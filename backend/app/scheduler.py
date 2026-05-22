from apscheduler.schedulers.asyncio import AsyncIOScheduler
from .mreso import get_parking_static, get_parking_live
from .cache import cache_set
import logging

log = logging.getLogger(__name__)
scheduler = AsyncIOScheduler()

# Store static parking in memory once
_parking_static = None

async def refresh_parking():
    global _parking_static
    try:
        live = await get_parking_live()
        if _parking_static is None:
            _parking_static = await get_parking_static()

        merged = []
        if _parking_static:
            for feat in _parking_static.get("features", []):
                p = feat["properties"]
                pid = p.get("id", "")
                lon, lat = feat["geometry"]["coordinates"]
                entry = {
                    "id": pid,
                    "name": p.get("nom", ""),
                    "address": p.get("adresse", ""),
                    "total": p.get("nb_places"),
                    "lat": lat,
                    "lon": lon,
                    "free": None,
                    "has_sensor": False,
                }
                if pid in live and live[pid].get("nb_places_libres") is not None:
                    entry["free"] = live[pid]["nb_places_libres"]
                    entry["has_sensor"] = True
                merged.append(entry)

        await cache_set("parking:live", merged, ttl=60)
        log.info("Parking refreshed: %d lots, %d with sensors",
                 len(merged), sum(1 for x in merged if x["has_sensor"]))
    except Exception as e:
        log.error("refresh_parking error: %s", e)

async def refresh_tram_lines():
    """Cache tram lines + geometry."""
    from .mreso import get_tram_lines, get_line_geometry
    try:
        lines = await get_tram_lines()
        result = []
        for line in lines:
            sem_code = line["id"].replace(":", "_")  # SEM:A -> SEM_A
            geom = await get_line_geometry(sem_code)
            result.append({**line, "geometry": geom})
        await cache_set("trams:lines", result, ttl=3600)
        log.info("Tram lines cached: %d", len(result))
    except Exception as e:
        log.error("refresh_tram_lines error: %s", e)

def start_scheduler():
    scheduler.add_job(refresh_parking, "interval", seconds=30, id="parking")
    scheduler.add_job(refresh_tram_lines, "interval", minutes=60, id="tram_lines")
    scheduler.start()