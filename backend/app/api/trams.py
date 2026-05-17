from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.services import tram_service

router = APIRouter(prefix="/trams", tags=["trams"])


@router.get("/lines")
async def get_lines(db: AsyncSession = Depends(get_db)):
    """All tram lines with geometry."""
    from sqlalchemy import text
    result = await db.execute(text(
        "SELECT id, code, long_name, color, text_color, geometry, total_distance_m, travel_time_s FROM tram_lines"
    ))
    return [dict(r) for r in result.mappings()]


@router.get("/stops")
async def get_stops(db: AsyncSession = Depends(get_db)):
    """All tram stops."""
    from sqlalchemy import text
    result = await db.execute(text("SELECT id, name, lon, lat, lines FROM tram_stops"))
    return [dict(r) for r in result.mappings()]


@router.get("/positions")
async def get_positions(db: AsyncSession = Depends(get_db)):
    """
    Live (or schedule-interpolated) tram positions on all lines.
    Refreshes every 10 seconds via Redis cache.
    """
    return await tram_service.get_tram_positions(db)


@router.get("/analytics/delay-probability")
async def delay_probability(
    line_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    return await tram_service.get_delay_probability(db, line_id)


@router.get("/analytics/reliability")
async def reliability(
    stop_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    return await tram_service.get_reliability_score(db, stop_id)


@router.get("/analytics/punctuality")
async def punctuality(
    line_id: str | None = Query(None),
    hours: int = Query(24, ge=1, le=168),
    db: AsyncSession = Depends(get_db),
):
    return await tram_service.get_historical_punctuality(db, line_id, hours)
