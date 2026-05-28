from fastapi import APIRouter, Query
from sqlalchemy import text

from ..cache import cache_get
from ..mreso import (
    get_schedule,
    get_tram_lines,
    get_line_geometry,
)
from ..db import SessionLocal

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

        geom = await get_line_geometry(
            sem_code
        )

        result.append({
            **line,
            "geometry": geom,
        })

    return result


@router.get("/schedule/{route_id}")
async def schedule(route_id: str):
    api_id = route_id.replace("_", ":")

    from datetime import datetime
    import pytz

    TZ = pytz.timezone("Europe/Paris")

    now = datetime.now(TZ)

    now_s = (
        now.hour * 3600
        + now.minute * 60
        + now.second
    )

    # Start 2 windows back from now
    start_ms = (
        int(now.timestamp() * 1000)
        - 8 * 1080 * 1000
    )

    data = await get_schedule(
        api_id,
        time_ms=start_ms,
    )

    if data is None:
        return {}

    for _ in range(15):
        arrets = data.get(
            "0",
            {},
        ).get("arrets", [])

        first_trips = (
            [
                x
                for t in arrets[0].get(
                    "trips",
                    [],
                )
                if (
                    x := safe_int(t)
                ) is not None
            ]
            if arrets
            else []
        )

        if any(
            t > now_s
            for t in first_trips
        ):
            break

        next_time = data.get(
            "0",
            {},
        ).get("nextTime")

        if not next_time:
            break

        data = await get_schedule(
            api_id,
            time_ms=next_time,
        )

        if data is None:
            break

    for direction in data.values():
        if not isinstance(
            direction,
            dict,
        ):
            continue

        for stop in direction.get(
            "arrets",
            [],
        ):
            trips = stop.get(
                "trips",
                [],
            )

            stop["upcoming"] = [
                {
                    "secs": x,
                    "minutes_away": round(
                        (
                            x - now_s
                        ) / 60,
                        1,
                    ),
                }
                for t in trips
                if (
                    x := safe_int(t)
                ) is not None
                and x - now_s > -60
                and (
                    x - now_s
                ) / 60 < 720
            ]

    return data


@router.get("/stopstats/{route_id}")
async def stopstats(route_id: str):
    cached = await cache_get(
        f"trams:daystats:{route_id}"
    )

    return cached or {}


@router.get("/stoptimes/{cluster_code:path}")
async def stoptimes(cluster_code: str):
    from ..mreso import get_stoptimes

    data = await get_stoptimes(cluster_code)

    delays = []

    for pattern in data:
        pid = pattern.get("pattern", {}).get("id", "")

        # Skip non-tram patterns (buses / regional)
        # buses typically: SE2:, C38:
        if pid.startswith("SE2:") or pid.startswith("C38:"):
            continue

        desc = pattern["pattern"].get("desc", "")

        for t in pattern.get("times", []):
            delay = t.get("arrivalDelay")
            if delay is None:
                continue
            delays.append({
                "delay_sec": delay,
                "scheduled": t["scheduledArrival"],
                "realtime": t["realtimeArrival"],
                "state": t.get("realtimeState"),
                "realtime_flag": t.get("realtime", False),
                "pattern": desc,
            })

    return delays


    

@router.get("/realtime/{route_id}")
async def realtime(route_id: str):
    """
    Returns current interpolated positions
    of all active trams on a line.
    Uses real-time stoptimes data matched
    by tripId across stops.
    """

    from ..mreso import (
        get_stoptimes_many,
        now_paris_seconds,
    )

    import pytz
    from datetime import datetime

    api_id = route_id.replace(
        "_",
        ":",
    )

    cached = await cache_get(
        "trams:lines"
    )

    lines = cached or []

    line = next(
        (
            l
            for l in lines
            if l["id"] == api_id
        ),
        None,
    )

    TZ = pytz.timezone(
        "Europe/Paris"
    )

    now = datetime.now(TZ)

    now_ms = int(
        now.timestamp() * 1000
    )

    start_ms = (
        now_ms - 8 * 1080 * 1000
    )

    now_s = (
        now.hour * 3600
        + now.minute * 60
        + now.second
    )

    data = await get_schedule(
        api_id,
        time_ms=start_ms,
    )

    if not data:
        return []

    stops = data.get(
        "0",
        {},
    ).get("arrets", [])

    cluster_codes = [
        s["parentStation"]["code"]
        for s in stops
        if s.get(
            "parentStation",
            {},
        ).get("code")
    ]

    if not cluster_codes:
        return []

    stoptimes = await get_stoptimes_many(
        cluster_codes
    )

    trip_arrivals = {}

    for i, code in enumerate(
        cluster_codes
    ):
        patterns = stoptimes.get(
            code,
            [],
        )

        for pattern in patterns:
            for t in pattern.get(
                "times",
                [],
            ):
                tid = t.get("tripId")

                arr = t.get(
                    "realtimeArrival"
                )

                if tid and arr:
                    if (
                        tid
                        not in trip_arrivals
                    ):
                        trip_arrivals[
                            tid
                        ] = []

                    trip_arrivals[
                        tid
                    ].append({
                        "stop_idx": i,
                        "arrival": arr,
                        "stop_name": (
                            stops[i][
                                "stopName"
                            ]
                            if i
                            < len(stops)
                            else ""
                        ),
                        "lat": (
                            stops[i]["lat"]
                            if i
                            < len(stops)
                            else 0
                        ),
                        "lon": (
                            stops[i]["lon"]
                            if i
                            < len(stops)
                            else 0
                        ),
                    })

    active = []

    for tid, arrivals in (
        trip_arrivals.items()
    ):
        arrivals_sorted = sorted(
            arrivals,
            key=lambda x: x[
                "stop_idx"
            ],
        )

        if (
            len(arrivals_sorted)
            < 2
        ):
            continue

        for j in range(
            len(arrivals_sorted)
            - 1
        ):
            a = arrivals_sorted[j]
            b = arrivals_sorted[
                j + 1
            ]

            if (
                a["arrival"]
                <= now_s
                <= b["arrival"]
            ):
                frac = (
                    now_s
                    - a["arrival"]
                ) / max(
                    b["arrival"]
                    - a["arrival"],
                    1,
                )

                lat = a["lat"] + frac * (
                    b["lat"]
                    - a["lat"]
                )

                lon = a["lon"] + frac * (
                    b["lon"]
                    - a["lon"]
                )

                active.append({
                    "tripId": tid,
                    "lat": lat,
                    "lon": lon,
                    "from_stop": a[
                        "stop_name"
                    ],
                    "to_stop": b[
                        "stop_name"
                    ],
                    "frac": round(
                        frac,
                        3,
                    ),
                })

                break

    return active


@router.get("/analytics/delays")
async def delay_analytics():
    async with SessionLocal() as session:
        result = await session.execute(
            text("""
                SELECT 
                    line_id,
                    ROUND(AVG(delay_sec)::numeric, 1) as avg_delay,
                    ROUND(MAX(delay_sec)::numeric, 1) as max_delay,
                    COUNT(*) as samples,
                    COUNT(CASE WHEN delay_sec > 60 THEN 1 END) as late_count,
                    ROUND(
                        (
                            COUNT(
                                CASE WHEN delay_sec > 60 THEN 1 END
                            ) * 100.0 / COUNT(*)
                        )::numeric,
                        1
                    ) as late_pct
                FROM tram_events
                WHERE ts > NOW() - INTERVAL '24 hours'
                GROUP BY line_id
                ORDER BY line_id
            """)
        )

        rows = result.fetchall()

        return [
            {
                "line_id": r[0],
                "avg_delay_sec": (
                    float(r[1])
                    if r[1]
                    else 0
                ),
                "max_delay_sec": (
                    float(r[2])
                    if r[2]
                    else 0
                ),
                "samples": r[3],
                "late_pct": (
                    float(r[5])
                    if r[5]
                    else 0
                ),
            }
            for r in rows
        ]


@router.get(
    "/analytics/delays/{line_id}"
)
async def delay_analytics_line(
    line_id: str,
    hours: int = Query(
        default=24,
        le=168,
    ),
):
    async with SessionLocal() as session:
        result = await session.execute(
            text(f"""
                SELECT 
                    date_trunc('hour', ts) + 
                    EXTRACT(minute FROM ts)::int / 30 * interval '30 minutes' as bucket,
                    ROUND(AVG(delay_sec)::numeric, 1) as avg_delay,
                    COUNT(*) as samples
                FROM tram_events
                WHERE line_id = :lid
                  AND ts > NOW() - INTERVAL '{int(hours)} hours'
                GROUP BY bucket
                ORDER BY bucket
            """),
            {"lid": line_id},
        )

        rows = result.fetchall()

        return [
            {
                "time": str(r[0]),
                "avg_delay": (
                    float(r[1])
                    if r[1]
                    else 0
                ),
                "samples": r[2],
            }
            for r in rows
        ]