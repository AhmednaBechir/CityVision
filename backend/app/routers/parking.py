from fastapi import APIRouter, Query
from ..cache import cache_get
from ..db import SessionLocal
from sqlalchemy import text

router = APIRouter(prefix="/api/parking")

@router.get("/live")
async def live():
    data = await cache_get("parking:live")
    return data or []

@router.get("/with-sensor")
async def with_sensor():
    data = await cache_get("parking:live") or []
    return [p for p in data if p["has_sensor"]]

@router.get("/history/{parking_id}")
async def history(parking_id: str, hours: int = Query(default=24, le=168)):
    async with SessionLocal() as session:
        result = await session.execute(
            text(f"""
                SELECT date_trunc('hour', ts) + 
                       EXTRACT(minute FROM ts)::int / 10 * interval '10 minutes' as bucket,
                       ROUND(AVG(nb_free)::numeric, 0) as avg_free,
                       ROUND(AVG(nb_total)::numeric, 0) as avg_total
                FROM parking_snapshots
                WHERE parking_id = :pid
                  AND ts > NOW() - INTERVAL '{int(hours)} hours'
                GROUP BY bucket
                ORDER BY bucket
            """),
            {"pid": parking_id}
        )
        rows = result.fetchall()
        return [
            {"time": str(r[0]), "free": int(r[1]) if r[1] else None, "total": int(r[2]) if r[2] else None}
            for r in rows
        ]