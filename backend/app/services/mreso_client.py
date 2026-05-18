"""
Thin async client for the Mobilités-M / Mreso OpenData API.
All public, no key needed.
CRITICAL: All requests need Origin header or API returns errors.
"""
import httpx
import logging
from app.core.config import get_settings

settings = get_settings()
log = logging.getLogger(__name__)

TRAM_ROUTE_IDS = ["SEM:A", "SEM:B", "SEM:C", "SEM:D", "SEM:E"]
TRAM_LINE_CODES = ["SEM_A", "SEM_B", "SEM_C", "SEM_D", "SEM_E"]

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


async def _get_json(url: str, params: dict = None):
    """GET url, return parsed JSON or None on failure/empty."""
    try:
        r = await _get_client().get(url, params=params or {})
        if r.status_code == 204 or not r.content or not r.text.strip():
            log.info(f"GET {url} params={params} -> {r.status_code} empty")
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


# ── TRAMS ──────────────────────────────────────────────────────────────────

async def fetch_all_routes() -> list[dict]:
    data = await _get_json(f"{settings.MRESO_API_BASE}/routers/default/index/routes")
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
    log.info(f"fetch_line_geometry({line_code}): {len(result.get('features', []))} features")
    return result


async def fetch_line_schedule(route_id: str) -> dict:
    """
    Schedule for a route e.g. 'SEM:A'.
    Returns dict keyed by direction index ("0", "1", ...):
    {
      "0": {
        "arrets": [
          {"stopId": "SEM:3393", "stopName": "...", "lat": 45.1, "lon": 5.7,
           "trips": [27900, 28140, ...]}   <- departure secs-since-midnight
        ],
        "trips": [...],   <- top-level trips array (same data)
        "prevTime": ...,
        "nextTime": ...
      }
    }
    NOTE: returns a windowed view (~4 trips) around current time.
    """
    data = await _get_json(
        f"{settings.MRESO_API_BASE}/ficheHoraires/json",
        {"route": route_id}
    )
    result = data if isinstance(data, dict) else {}
    n_trips = len(result.get("0", {}).get("arrets", [{}])[0].get("trips", [])) if result else 0
    log.info(f"fetch_line_schedule({route_id}): {len(result)} dirs, ~{n_trips} trips/window")
    return result


async def fetch_ligne_dynamic() -> dict:
    """
    Real-time vehicle positions: /api/dyn/ligne/json
    {"SEM_A": {"stops": [...], "time": ms}, ...}
    stops[] empty when no GPS feed available.
    """
    data = await _get_json(f"{settings.MRESO_API_BASE}/dyn/ligne/json")
    return data if isinstance(data, dict) else {}


# ── PARKING ────────────────────────────────────────────────────────────────

async def fetch_parking_static() -> list[dict]:
    """
    Static parking data: /api/bbox/json?types=parking
    Returns features with properties:
      id, nom, adresse, nb_places, nb_pr, gratuit, hauteur_max, type_usagers
    Geometry: Point [lon, lat]
    """
    data = await _get_json(
        f"{settings.MRESO_API_BASE}/bbox/json",
        {"types": "parking"}
    )
    features = data.get("features", []) if isinstance(data, dict) else []
    log.info(f"fetch_parking_static: {len(features)} parkings")
    return features


async def fetch_parking_dynamic() -> dict:
    """
    Real-time parking availability: /api/dyn/parking/json
    Returns dict keyed by parking id:
    {
      "38006-P-001": {
        "time": 1779090175013,
        "nb_places_libres": 5,      <- null when no real-time feed
        "nb_parking_libres": null,
        "nb_pr_libres": null,
        "nsv_id": 0
      }, ...
    }
    """
    data = await _get_json(f"{settings.MRESO_API_BASE}/dyn/parking/json")
    result = data if isinstance(data, dict) else {}
    log.info(f"fetch_parking_dynamic: {len(result)} entries")
    return result


async def close_client():
    global _client
    if _client and not _client.is_closed:
        await _client.aclose()
        _client = None