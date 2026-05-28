from apscheduler.schedulers.asyncio import AsyncIOScheduler

from .mreso import (
    get_parking_static,
    get_parking_live,
    get_voi_free_bikes,
    get_tram_lines,
    get_line_geometry,
)

from .cache import (
    cache_set,
    cache_get,
)

from .db import SessionLocal

from .models import (
    ParkingSnapshot,
    TramEvent,
)

import logging
import httpx
import asyncio

log = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()

# Store static parking in memory once
_parking_static = None


async def refresh_parking():
    global _parking_static

    try:
        live = await get_parking_live()

        if _parking_static is None:
            _parking_static = (
                await get_parking_static()
            )

        merged = []

        if _parking_static:
            for feat in _parking_static.get(
                "features",
                [],
            ):
                p = feat["properties"]

                pid = p.get("id", "")

                lon, lat = feat[
                    "geometry"
                ]["coordinates"]

                entry = {
                    "id": pid,
                    "name": p.get(
                        "nom",
                        "",
                    ),
                    "address": p.get(
                        "adresse",
                        "",
                    ),
                    "total": p.get(
                        "nb_places"
                    ),
                    "lat": lat,
                    "lon": lon,
                    "free": None,
                    "has_sensor": False,
                }

                if (
                    pid in live
                    and live[pid].get(
                        "nb_places_libres"
                    )
                    is not None
                ):
                    entry["free"] = live[
                        pid
                    ][
                        "nb_places_libres"
                    ]

                    entry[
                        "has_sensor"
                    ] = True

                merged.append(entry)

        await cache_set(
            "parking:live",
            merged,
            ttl=60,
        )

        # Save snapshots to DB
        async with SessionLocal() as session:
            for p in merged:
                if p["has_sensor"]:
                    session.add(
                        ParkingSnapshot(
                            parking_id=p[
                                "id"
                            ],
                            nb_free=p[
                                "free"
                            ],
                            nb_total=p[
                                "total"
                            ],
                        )
                    )

            await session.commit()

        log.info(
            "Parking refreshed: %d parkings",
            len(merged),
        )

    except Exception as e:
        log.error(
            "refresh_parking error: %s",
            repr(e),
        )


async def refresh_tram_lines():
    """
    Cache tram lines + geometry.
    """

    try:
        lines = await get_tram_lines()

        result = []

        for line in lines:
            sem_code = line[
                "id"
            ].replace(":", "_")

            geom = (
                await get_line_geometry(
                    sem_code
                )
            )

            result.append({
                **line,
                "geometry": geom,
            })

        await cache_set(
            "trams:lines",
            result,
            ttl=3600,
        )

        log.info(
            "Tram lines cached: %d",
            len(result),
        )

    except Exception as e:
        log.error(
            "refresh_tram_lines error: %s",
            repr(e),
        )


async def build_day_schedule():
    from .mreso import (
        get_tram_lines,
    )

    import pytz

    from datetime import (
        datetime,
        timedelta,
    )

    await asyncio.sleep(5)

    TZ = pytz.timezone(
        "Europe/Paris"
    )

    try:
        lines = await get_tram_lines()

        for line in lines:
            route_id = line["id"]

            now = datetime.now(TZ)

            start = now.replace(
                hour=5,
                minute=0,
                second=0,
                microsecond=0,
            )

            end = start + timedelta(
                hours=21
            )

            t_ms = int(
                start.timestamp() * 1000
            )

            end_ms = int(
                end.timestamp() * 1000
            )

            step_ms = (
                4 * 60 * 1000
            )

            stop_trips = {}

            dir_terminus_count = {}

            async with httpx.AsyncClient(
                headers={
                    "Origin": "http://localhost:5173"
                },
                follow_redirects=True,
                timeout=10,
            ) as c:
                while t_ms < end_ms:
                    try:
                        r = await c.get(
                            "https://data.mobilites-m.fr/api/ficheHoraires/json",
                            params={
                                "route": route_id,
                                "time": t_ms,
                            },
                        )

                        if (
                            r.status_code
                            != 200
                            or not r.content
                        ):
                            break

                        data = r.json()

                    except Exception:
                        t_ms += step_ms
                        continue

                    for dir_key, d in (
                        data.items()
                    ):
                        if not isinstance(
                            d,
                            dict,
                        ):
                            continue

                        arrets = d.get(
                            "arrets",
                            [],
                        )

                        if arrets:
                            t_name = arrets[
                                -1
                            ][
                                "stopName"
                            ]

                            if (
                                dir_key
                                not in dir_terminus_count
                            ):
                                dir_terminus_count[
                                    dir_key
                                ] = {}

                            dir_terminus_count[
                                dir_key
                            ][
                                t_name
                            ] = (
                                dir_terminus_count[
                                    dir_key
                                ].get(
                                    t_name,
                                    0,
                                )
                                + 1
                            )

                        for stop in arrets:
                            sid = stop[
                                "stopId"
                            ]

                            name = stop[
                                "stopName"
                            ]

                            if (
                                name
                                not in stop_trips
                            ):
                                stop_trips[
                                    name
                                ] = {
                                    "stopName": name,
                                    "lat": stop[
                                        "lat"
                                    ],
                                    "lon": stop[
                                        "lon"
                                    ],
                                    "dirs": {},
                                }

                            if (
                                dir_key
                                not in stop_trips[
                                    name
                                ]["dirs"]
                            ):
                                stop_trips[
                                    name
                                ][
                                    "dirs"
                                ][
                                    dir_key
                                ] = set()

                            for t in stop.get(
                                "trips",
                                [],
                            ):
                                try:
                                    stop_trips[
                                        name
                                    ][
                                        "dirs"
                                    ][
                                        dir_key
                                    ].add(
                                        int(t)
                                    )
                                except:
                                    pass

                    t_ms += step_ms

            stats = {}

            for name, info in (
                stop_trips.items()
            ):
                dir_stats = {}

                for (
                    dir_key,
                    trips_set,
                ) in info["dirs"].items():
                    trips = sorted(
                        trips_set
                    )

                    if len(trips) < 2:
                        continue

                    gaps = [
                        trips[i + 1]
                        - trips[i]
                        for i in range(
                            len(trips)
                            - 1
                        )
                    ]

                    normal_gaps = [
                        g
                        for g in gaps
                        if g < 3600
                    ]

                    terminus = max(
                        dir_terminus_count.get(
                            dir_key,
                            {"?": 1},
                        ),
                        key=lambda k:
                        dir_terminus_count[
                            dir_key
                        ][k],
                    )

                    dir_stats[
                        dir_key
                    ] = {
                        "terminus": terminus,
                        "total_trips": len(
                            trips
                        ),
                        "first": trips[0],
                        "last": trips[-1],
                        "avg_gap_min": (
                            round(
                                sum(
                                    normal_gaps
                                )
                                / len(
                                    normal_gaps
                                )
                                / 60,
                                1,
                            )
                            if normal_gaps
                            else None
                        ),
                        "trips_per_hour": round(
                            len([
                                t
                                for t in trips
                                if 7
                                * 3600
                                <= t
                                <= 20
                                * 3600
                            ])
                            / 13,
                            1,
                        ),
                    }

                if dir_stats:
                    stats[name] = {
                        "stopName": name,
                        "lat": info["lat"],
                        "lon": info["lon"],
                        "dirs": dir_stats,
                    }

            cache_key = (
                f"trams:daystats:{route_id.replace(':', '_')}"
            )

            await cache_set(
                cache_key,
                stats,
                ttl=86400,
            )

            log.info(
                "Day stats cached for %s: %d stops",
                route_id,
                len(stats),
            )

    except Exception as e:
        log.error(
            "build_day_schedule error: %s",
            repr(e),
        )


async def refresh_voi():
    try:
        bikes = (
            await get_voi_free_bikes()
        )

        features = []

        for b in bikes:
            if (
                b.get("lat")
                is None
                or b.get("lon")
                is None
            ):
                continue

            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [
                        b["lon"],
                        b["lat"],
                    ],
                },
                "properties": {
                    "id": b[
                        "bike_id"
                    ],
                    "type": b.get(
                        "vehicle_type_id"
                    ),
                    "reserved": b.get(
                        "is_reserved"
                    ),
                    "disabled": b.get(
                        "is_disabled"
                    ),
                    "range_meters": b.get(
                        "current_range_meters"
                    ),
                    "last_reported": b.get(
                        "last_reported"
                    ),
                },
            })

        geojson = {
            "type": "FeatureCollection",
            "features": features,
        }

        await cache_set(
            "voi:live",
            geojson,
            ttl=120,
        )

        log.info(
            "VOI refreshed: %d vehicles",
            len(
                geojson["features"]
            ),
        )

    except Exception as e:
        log.error(
            "refresh_voi error: %s",
            repr(e),
        )


async def collect_delays():
    """
    Fetch real-time delays for all tram lines
    and record to DB.
    """

    log.warning(
        "collect_delays START"
    )

    from .mreso import (
        get_tram_lines,
        get_stoptimes_many,
        get_schedule,
    )

    import pytz

    from datetime import datetime

    TZ = pytz.timezone(
        "Europe/Paris"
    )

    try:
        lines = await get_tram_lines()

        now = datetime.now(TZ)

        now_ms = int(
            now.timestamp() * 1000
        )

        async with SessionLocal() as session:
            for line in lines:
                route_id = line["id"]

                line_code = route_id.replace(
                    ":",
                    "_",
                )

                start_ms = (
                    now_ms
                    - 8
                    * 1080
                    * 1000
                )

                data = await get_schedule(
                    route_id,
                    time_ms=start_ms,
                )

                if not data:
                    continue

                stops = data.get(
                    "0",
                    {},
                ).get("arrets", [])

                cluster_codes = [
                    s["parentStation"][
                        "code"
                    ]
                    for s in stops
                    if s.get(
                        "parentStation",
                        {},
                    ).get("code")
                ]

                if not cluster_codes:
                    continue

                stoptimes = (
                    await get_stoptimes_many(
                        cluster_codes
                    )
                )

                for (
                    code,
                    patterns,
                ) in stoptimes.items():
                    stop_idx = (
                        cluster_codes.index(
                            code
                        )
                        if code
                        in cluster_codes
                        else -1
                    )

                    stop_name = (
                        stops[stop_idx][
                            "stopName"
                        ]
                        if 0
                        <= stop_idx
                        < len(stops)
                        else ""
                    )

                    stop_id = (
                        stops[stop_idx][
                            "stopId"
                        ]
                        if 0
                        <= stop_idx
                        < len(stops)
                        else ""
                    )

                    for pattern in patterns:
                        p = pattern.get(
                            "pattern",
                            {},
                        )

                        pid = p.get(
                            "id",
                            "",
                        )

                        # Only tram lines A-E
                        pid = pattern.get("pattern", {}).get("id", "")

                        if pid.startswith("SE2:") or pid.startswith("C38:"):
                            continue

                        for t in pattern.get(
                            "times",
                            [],
                        ):
                            if not t.get(
                                "realtime"
                            ):
                                continue

                            delay = t.get(
                                "arrivalDelay"
                            )

                            if (
                                delay
                                is None
                            ):
                                continue

                            session.add(
                                TramEvent(
                                    line_id=line_code,
                                    stop_id=stop_id,
                                    stop_name=stop_name,
                                    trip_id=t.get(
                                        "tripId"
                                    ),
                                    scheduled=t.get(
                                        "scheduledArrival"
                                    ),
                                    actual=t.get(
                                        "realtimeArrival"
                                    ),
                                    delay_sec=delay,
                                )
                            )

            await session.commit()

            log.warning(
                "collect_delays DONE, committed"
            )

    except Exception as e:
        log.error(
            "collect_delays error: %s",
            repr(e),
        )


def start_scheduler():
    scheduler.add_job(
        refresh_parking,
        "interval",
        seconds=30,
        id="parking",
    )

    scheduler.add_job(
        refresh_tram_lines,
        "interval",
        minutes=60,
        id="tram_lines",
    )

    scheduler.add_job(
        build_day_schedule,
        "cron",
        hour=3,
        minute=0,
        id="day_schedule",
    )

    scheduler.add_job(
        refresh_voi,
        "interval",
        minutes=1,
        id="voi",
    )

    scheduler.add_job(
        collect_delays,
        "interval",
        minutes=2,
        id="delays",
    )

    scheduler.start()