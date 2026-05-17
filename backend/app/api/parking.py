from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.services import parking_service

router = APIRouter(prefix="/parking", tags=["parking"])


@router.get("/live")
async def get_live(db: AsyncSession = Depends(get_db)):
    """Real-time parking availability for all P+R lots."""
    return await parking_service.get_live_parking(db)


@router.get("/zones")
async def get_by_zone(db: AsyncSession = Depends(get_db)):
    """Aggregate availability by geographic zone."""
    return await parking_service.get_availability_by_zone(db)


@router.get("/occupancy")
async def get_occupancy(
    parking_id: str | None = Query(None, description="Filter by parking ID"),
    hours: int = Query(24, ge=1, le=168),
    db: AsyncSession = Depends(get_db),
):
    """Hourly occupancy history."""
    return await parking_service.get_occupancy_over_time(db, parking_id, hours)


@router.get("/congestion")
async def get_congestion(db: AsyncSession = Depends(get_db)):
    """Zones currently above congestion threshold."""
    return await parking_service.get_congested_zones(db)


@router.get("/trend/{parking_id}")
async def get_trend(
    parking_id: str,
    hours: int = Query(48, ge=6, le=168),
    db: AsyncSession = Depends(get_db),
):
    """Predicted availability trend for a specific parking."""
    return await parking_service.get_availability_trend(db, parking_id, hours)
