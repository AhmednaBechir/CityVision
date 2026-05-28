import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import engine, Base
from .scheduler import (
    start_scheduler,
    refresh_parking,
    refresh_tram_lines,
    refresh_voi,
    build_day_schedule,
    collect_delays,
)
from .routers import trams, parking, voi


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Initial cache warmup
    await refresh_parking()
    await refresh_tram_lines()
    await refresh_voi()

    # Start scheduler
    start_scheduler()

    # Run heavy startup tasks in background
    asyncio.create_task(build_day_schedule())
    asyncio.create_task(collect_delays())

    yield


app = FastAPI(
    title="Grenoble Transport API",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(trams.router)
app.include_router(parking.router)
app.include_router(voi.router)


@app.get("/health")
async def health():
    return {"status": "ok"}