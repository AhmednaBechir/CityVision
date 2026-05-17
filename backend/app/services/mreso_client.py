"""
Thin async client for the Mobilités-M / Mreso OpenData API.
All public, no key needed.

CRITICAL: The API requires an Origin header on all requests.
"""
import httpx
import logging
from app.core.config import get_settings

settings = get_settings()
log = logging.getLogger(__name__)

TRAM_LINE_CODES = ["SEM_A", "SEM_B", "SEM_C", "SEM_D", "SEM_E"]
TRAM_ROUTE_IDS  = ["SEM:A", "SEM:B", "SEM:C", "SEM:D", "SEM:E"]

API_HEADERS = {
    "Origin": "http://localhost:5173",
    "Referer": "http://localhost:5173/",
}

_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=15.0,
            follow_redirects=True,
            headers=API_HEADERS,
        )
    return _client


async def _get_json(url: str, params: dict = None) -> any:
    """GET a URL, return parsed JSON or None on any failure/empty response."""
    try:
        r = await _get_client().get(url, params=params or {})
        if r.status_code == 204 or not r.content or not r.text.strip():
            log.info(f"GET {url} -> {r.status_code} empty")
            return None
        r.raise_for_status()
        data = r.json()
        if isinstance(data, dict) and data.get("error"):
            log.warning(f"GET {url} -> API error: {data['error']}")
            return None
        return data
    except Exception as e:
        log.warning(f"GET {url}: {e}")
        return None


async def fetch_all_routes() -> list[dict]:
    url = f"{settings.MRESO_API_BASE}/routers/default/index/routes"
    data = await _get_json(url)
    result = data if isinstance(data, list) else []
    log.info(f"fetch_all_routes: {len(result)} routes")
    return result


async def fetch_line_geometry(line_code: str) -> dict:
    """GeoJSON FeatureCollection for a line e.g. 'SEM_A'."""
    data = await _get_json(
        f"{settings.MRESO_API_BASE}/lines/json",
        {"types": "ligne", "codes": line_code}
    )
    result = data if isinstance(data, dict) else {}
    log.info(f"fetch_line_geometry({line_code}): features={len(result.get('features', []))}")
    return result


async def fetch_line_schedule(route_id: str) -> dict:
    """
    Schedule for a route e.g. 'SEM:A'.
    Returns dict: {
      "0": { "arrets": [ { "stopId", "stopName", "lat", "lon", "trips": [secs,...] }, ... ] },
      "1": { ... }  <- opposite direction
    }
    Each value in trips[] is departure time in seconds-since-midnight.
    """
    data = await _get_json(
        f"{settings.MRESO_API_BASE}/ficheHoraires/json",
        {"route": route_id}
    )
    result = data if isinstance(data, dict) else {}
    n_dirs = len(result)
    n_trips = sum(
        len(stop.get("trips", [])) 
        for d in result.values() 
        for stop in d.get("arrets", [])[:1]
    ) if result else 0
    log.info(f"fetch_line_schedule({route_id}): {n_dirs} directions, ~{n_trips} trips in dir0")
    return result


async def fetch_ligne_dynamic() -> dict:
    """
    Real-time dynamic line data: /api/dyn/ligne/json
    Returns {"SEM_A": {"stops": [...vehicle positions...], "time": ms_timestamp}, ...}
    stops[] is empty when no GPS data available.
    """
    data = await _get_json(f"{settings.MRESO_API_BASE}/dyn/ligne/json")
    result = data if isinstance(data, dict) else {}
    log.debug(f"fetch_ligne_dynamic: {len(result)} lines")
    return result


async def fetch_parking_dynamic() -> list[dict]:
    """
    Parking availability. The /dyn/PAR/json and /bbox?types=PAR endpoints
    both return 404/204 on this server. We use hardcoded Grenoble P+R data
    with simulated occupancy (no real-time source available).
    """
    import random, math
    from datetime import datetime
    hour = datetime.now().hour
    is_weekend = datetime.now().weekday() >= 5

    # Grenoble TAG P+R locations (publicly documented on mobilites-m.fr)
    PARKS = [
        {"id": "PAR_OXFORD",      "nom": "Oxford P+R",              "x": 5.7676, "y": 45.1942, "cap": 450},
        {"id": "PAR_SEYSSINS",    "nom": "Seyssins P+R",            "x": 5.6820, "y": 45.1605, "cap": 340},
        {"id": "PAR_SASSENAGE",   "nom": "Sassenage P+R",           "x": 5.6680, "y": 45.2005, "cap": 280},
        {"id": "PAR_FONTANIL",    "nom": "Fontanil-Cornillon P+R",  "x": 5.6910, "y": 45.2310, "cap": 195},
        {"id": "PAR_ETOILE",      "nom": "Le Pont-de-Claix P+R",    "x": 5.6975, "y": 45.1225, "cap": 260},
        {"id": "PAR_GIERES",      "nom": "Gières P+R",              "x": 5.7890, "y": 45.1840, "cap": 185},
        {"id": "PAR_EUROPOLE",    "nom": "Europole Parking",        "x": 5.7150, "y": 45.1960, "cap": 600},
        {"id": "PAR_VICTOR_HUGO", "nom": "Victor Hugo Parking",     "x": 5.7210, "y": 45.1860, "cap": 400},
        {"id": "PAR_ABBAYE",      "nom": "Abbaye Parking",          "x": 5.7340, "y": 45.1910, "cap": 350},
        {"id": "PAR_ALPEXPO",     "nom": "Alpexpo Parking",         "x": 5.7510, "y": 45.1780, "cap": 500},
    ]

    results = []
    for p in PARKS:
        # Realistic occupancy curve: peaks ~10h and ~15h on weekdays, lower on weekends
        if is_weekend:
            base = 0.25 + 0.35 * math.exp(-((hour - 11) ** 2) / 20)
        else:
            morning = 0.7 * math.exp(-((hour - 9.5) ** 2) / 8)
            afternoon = 0.5 * math.exp(-((hour - 15) ** 2) / 10)
            base = 0.15 + morning + afternoon
        occ = max(0.05, min(0.97, base + random.uniform(-0.08, 0.08)))
        cap = p["cap"]
        occupied = int(cap * occ)
        available = cap - occupied
        results.append({
            "id":       p["id"],
            "nom":      p["nom"],
            "x":        p["x"],
            "y":        p["y"],
            "capacite": cap,
            "dispo":    available,
            "status":   "OUVERT",
            "type":     "PAR",
        })
    log.info(f"fetch_parking_dynamic: returning {len(results)} hardcoded P+R (no real-time source)")
    return results


async def close_client():
    global _client
    if _client and not _client.is_closed:
        await _client.aclose()
        _client = None