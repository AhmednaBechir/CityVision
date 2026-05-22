from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import engine, Base
from .scheduler import start_scheduler, refresh_parking, refresh_tram_lines
from .routers import trams, parking

@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await refresh_tram_lines()
    await refresh_parking()
    start_scheduler()
    yield

app = FastAPI(title="Grenoble Transport API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(trams.router)
app.include_router(parking.router)

@app.get("/health")
async def health():
    return {"status": "ok"}