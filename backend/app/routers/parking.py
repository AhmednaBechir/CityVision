from fastapi import APIRouter
from ..cache import cache_get

router = APIRouter(prefix="/api/parking")

@router.get("/live")
async def live():
    data = await cache_get("parking:live")
    return data or []

@router.get("/with-sensor")
async def with_sensor():
    data = await cache_get("parking:live") or []
    return [p for p in data if p["has_sensor"]]