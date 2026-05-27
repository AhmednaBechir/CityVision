
from fastapi import APIRouter
from ..cache import cache_get

router = APIRouter(prefix="/api/voi")


@router.get("/live")
async def live():
    data = await cache_get("voi:live")
    return data or {"type": "FeatureCollection", "features": []}

@router.get("/stats")
async def stats():
    data = await cache_get("voi:stats")
    return data or {total:0, types:{"voi_bike":0,"voi_scooter":0}}
