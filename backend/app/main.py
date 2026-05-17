import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.database import engine
from app.core.redis_client import close_redis
from app.models.models import Base
from app.api import trams, parking
from app.tasks.collector import run_seed, start_scheduler, scheduler

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
log = logging.getLogger(__name__)
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    log.info("Creating DB tables if needed...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    log.info("Running static data seed...")
    await run_seed()

    log.info("Starting background scheduler...")
    start_scheduler()

    yield

    # Shutdown
    log.info("Shutting down scheduler...")
    scheduler.shutdown(wait=False)
    await close_redis()
    await engine.dispose()


app = FastAPI(
    title="Mreso Transport API",
    version="1.0.0",
    description="Real-time Grenoble transport visualizer backend",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(trams.router, prefix="/api")
app.include_router(parking.router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}
