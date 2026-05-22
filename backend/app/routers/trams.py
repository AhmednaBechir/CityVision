from fastapi import APIRouter
from ..cache import cache_get
from ..mreso import get_schedule, now_paris_seconds, get_tram_lines, get_line_geometry

router = APIRouter(prefix="/api/trams")

@router.get("/lines")
async def lines():
    cached = await cache_get("trams:lines")
    if cached:
        return cached
    # fallback: fetch fresh
    raw = await get_tram_lines()
    result = []
    for line in raw:
        sem_code = line["id"].replace(":", "_")
        geom = await get_line_geometry(sem_code)
        result.append({**line, "geometry": geom})
    return result

@router.get("/schedule/{route_id}")
async def schedule(route_id: str):
    """
    route_id: SEM_A, SEM_B, etc. (underscore, converted internally to SEM:A)
    Returns directions with stops and next few departures.
    """
    api_id = route_id.replace("_", ":")
    data = await get_schedule(api_id)
    if data is None:
        return {}
    now_s = now_paris_seconds()
    # Attach human-readable times and flag upcoming
    for direction in data.values():
        for stop in direction.get("arrets", []):
            trips = stop.get("trips", [])
            stop["upcoming"] = [
                {"secs": int(t), "minutes_away": round((int(t) - now_s) / 60, 1)}
                for t in trips
                if int(t) - now_s > -60  # include trips up to 1 min past
            ]
    return data