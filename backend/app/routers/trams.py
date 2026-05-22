from fastapi import APIRouter
from ..cache import cache_get
from ..mreso import get_schedule, get_tram_lines, get_line_geometry

router = APIRouter(prefix="/api/trams")


def safe_int(v):
    try:
        return int(v)
    except:
        return None


@router.get("/lines")
async def lines():
    cached = await cache_get("trams:lines")
    if cached:
        return cached

    raw = await get_tram_lines()
    result = []

    for line in raw:
        sem_code = line["id"].replace(":", "_")
        geom = await get_line_geometry(sem_code)
        result.append({**line, "geometry": geom})

    return result


@router.get("/schedule/{route_id}")
async def schedule(route_id: str):
    api_id = route_id.replace("_", ":")

    from datetime import datetime
    import pytz

    TZ = pytz.timezone("Europe/Paris")
    now = datetime.now(TZ)
    now_s = now.hour * 3600 + now.minute * 60 + now.second

    # Start 2 windows back from now
    start_ms = int(now.timestamp() * 1000) - 8 * 1080 * 1000

    data = await get_schedule(api_id, time_ms=start_ms)

    if data is None:
        return {}

    for _ in range(15):
        arrets = data.get("0", {}).get("arrets", [])

        first_trips = [
            x
            for t in arrets[0].get("trips", [])
            if (x := safe_int(t)) is not None
        ] if arrets else []

        if any(t > now_s for t in first_trips):
            break

        next_time = data.get("0", {}).get("nextTime")

        if not next_time:
            break

        data = await get_schedule(api_id, time_ms=next_time)

        if data is None:
            break

    for direction in data.values():
        if not isinstance(direction, dict):
            continue

        for stop in direction.get("arrets", []):
            trips = stop.get("trips", [])

            stop["upcoming"] = [
                {
                    "secs": x,
                    "minutes_away": round((x - now_s) / 60, 1),
                }
                for t in trips
                if (x := safe_int(t)) is not None and x - now_s > -60
            ]

    return data


@router.get("/stopstats/{route_id}")
async def stopstats(route_id: str):
    cached = await cache_get(f"trams:daystats:{route_id}")
    return cached or {}