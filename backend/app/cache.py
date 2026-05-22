import redis.asyncio as aioredis
import json
from .config import settings

_redis = None

async def get_redis():
    global _redis
    if _redis is None:
        _redis = await aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis

async def cache_set(key: str, value, ttl: int = 30):
    r = await get_redis()
    await r.set(key, json.dumps(value), ex=ttl)

async def cache_get(key: str):
    r = await get_redis()
    v = await r.get(key)
    return json.loads(v) if v else None