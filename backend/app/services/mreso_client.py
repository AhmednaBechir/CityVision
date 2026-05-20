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
    The API returns a windowed view of ~4 trips. It does NOT support time params.
    We paginate forward using nextTime until we find a window that covers now.
    Max 20 pages to avoid infinite loop.
    """
    from datetime import datetime, timezone, timedelta
    # The ficheHoraires API serves times in Europe/Paris (UTC+2 in summer).
    # WSL may run at UTC+3 (EEST). Normalise to UTC+2 to match API times.
    now_utc = datetime.now(timezone.utc)
    now_paris = now_utc + timedelta(hours=2)   # Europe/Paris summer (CEST)
    now_secs = now_paris.hour * 3600 + now_paris.minute * 60 + now_paris.second

    params = {"route": route_id}
    best = {}

    for page in range(20):
        data = await _get_json(f"{settings.MRESO_API_BASE}/ficheHoraires/json", params)
        if not isinstance(data, dict) or not data:
            break

        # Check if any direction has a trip window covering now
        covered = False
        for dir_key, direction in data.items():
            arrets = direction.get("arrets", [])
            if not arrets:
                continue
            first_trips = arrets[0].get("trips", [])
            last_trips  = arrets[-1].get("trips", [])
            if not first_trips or not last_trips:
                continue
            try:
                # last trip in window: last departure of first stop
                window_end = int(first_trips[-1])
                # first trip arrival: first departure of last stop
                window_start = int(last_trips[0]) if last_trips else window_end
                # Window covers now if any trip straddles now_secs
                for dep, arr in zip(first_trips, last_trips):
                    d, a = int(dep), int(arr)
                    if a < d: a += 86400
                    if d <= now_secs <= a:
                        covered = True
                        break
                # Also accept if window is just ahead of now (next tram coming)
                if int(first_trips[0]) > now_secs - 300:
                    covered = True
            except (TypeError, ValueError):
                continue

        best = data  # keep last fetched as fallback
        if covered:
            log.info(f"fetch_line_schedule({route_id}): found active window on page {page}")
            break

        # Advance to next window using nextTime from any direction
        next_time = None
        for direction in data.values():
            nt = direction.get("nextTime")
            if nt is not None:
                try:
                    next_time = int(nt)
                    break
                except (TypeError, ValueError):
                    continue

        if next_time is None:
            log.info(f"fetch_line_schedule({route_id}): no nextTime, stopping at page {page}")
            break

        # nextTime is a Unix timestamp in milliseconds — convert to secs-since-midnight
        from datetime import datetime as _dt
        nt_dt = _dt.fromtimestamp(next_time / 1000)
        nt_secs = nt_dt.hour * 3600 + nt_dt.minute * 60 + nt_dt.second

        # Stop if the next window starts more than 2h ahead of now
        if nt_secs > now_secs + 7200:
            log.info(f"fetch_line_schedule({route_id}): nextTime {nt_secs//3600}h{(nt_secs%3600)//60:02d} too far ahead, stopping")
            break

        params = {"route": route_id, "time": next_time}
        log.debug(f"fetch_line_schedule({route_id}): page {page} not active, advancing to time={next_time}")

    n_trips = len(best.get("0", {}).get("arrets", [{}])[0].get("trips", [])) if best else 0
    log.info(f"fetch_line_schedule({route_id}): {len(best)} dirs, ~{n_trips} trips/window")
    return best


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