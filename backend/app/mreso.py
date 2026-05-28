"""
Raw client for data.mobilites-m.fr/api
All requests must include Origin: http://localhost:5173
follow_redirects=True to handle HTTP→HTTPS
"""
import httpx
import pytz
from datetime import datetime
import asyncio

BASE = "https://data.mobilites-m.fr/api"
HEADERS = {"Origin": "http://localhost:5173"}
TZ = pytz.timezone("Europe/Paris")

client = httpx.AsyncClient(headers=HEADERS, follow_redirects=True, timeout=30)

async def get_tram_lines():
    """Returns list of tram line dicts with id, shortName, color, textColor."""
    r = await client.get(f"{BASE}/routers/default/index/routes")
    r.raise_for_status()
    routes = r.json()
    return [x for x in routes if x.get("mode") == "TRAM"]

async def get_line_geometry(sem_code: str):
    """sem_code like SEM_A. Returns GeoJSON FeatureCollection."""
    r = await client.get(f"{BASE}/lines/json", params={"types": "ligne", "codes": sem_code})
    if r.status_code == 204:
        return None
    r.raise_for_status()
    return r.json()

async def get_schedule(route_id: str, time_ms: int = None):
    """
    route_id like SEM:A
    Returns raw ficheHoraires JSON dict keyed "0","1"
    Pass time_ms to get next window.
    """
    params = {"route": route_id}
    if time_ms is not None:
        params["time"] = time_ms
    r = await client.get(f"{BASE}/ficheHoraires/json", params=params)
    if r.status_code == 204:
        return None
    r.raise_for_status()
    return r.json()

async def get_parking_static():
    """Returns GeoJSON FeatureCollection of all parking."""
    r = await client.get(f"{BASE}/bbox/json", params={"types": "parking"})
    if r.status_code == 204:
        return None
    r.raise_for_status()
    return r.json()

async def get_parking_live():
    """Returns dict {parking_id: {nb_places_libres, time}}."""
    r = await client.get(f"{BASE}/dyn/parking/json")
    if r.status_code == 204:
        return {}
    r.raise_for_status()
    return r.json()

def now_paris_seconds() -> int:
    """Current time as seconds since midnight in Europe/Paris."""
    now = datetime.now(TZ)
    return now.hour * 3600 + now.minute * 60 + now.second

async def get_voi_free_bikes():
    """
    Returns list of free-floating Voi vehicles.
    Includes bikes + scooters.
    """
    r = await client.get(f"{BASE}/gbfs/voi_grenoble/free_bike_status")
    if r.status_code == 204:
        return []
    r.raise_for_status()
    data = r.json()
    return data.get("data", {}).get("bikes", [])


async def get_stoptimes(cluster_code: str):
    """cluster_code like SEM:GENLETOILE — returns real-time delays."""
    r = await client.get(
        f"{BASE}/routers/default/index/clusters/{cluster_code}/stoptimes",
        params={"showCancelledTrips": "true"}
    )
    if r.status_code != 200 or not r.content:
        return []
    return r.json()



async def get_stoptimes_many(cluster_codes: list[str]) -> dict:
    """Fetch stoptimes for multiple clusters in parallel. Returns {code: [patterns]}"""
    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True, timeout=10) as c:
        tasks = [
            c.get(f"{BASE}/routers/default/index/clusters/{code}/stoptimes",
                  params={"showCancelledTrips": "true"})
            for code in cluster_codes
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)
    
    out = {}
    for code, r in zip(cluster_codes, results):
        if isinstance(r, Exception): continue
        if r.status_code != 200 or not r.content: continue
        try: out[code] = r.json()
        except: pass
    return out