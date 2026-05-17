from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://mreso:mreso@localhost:5432/mreso_db"
    DATABASE_SYNC_URL: str = "postgresql://mreso:mreso@localhost:5432/mreso_db"
    REDIS_URL: str = "redis://localhost:6379/0"
    MRESO_API_BASE: str = "http://data.mobilites-m.fr/api"
    MRESO_OTP_BASE: str = "http://data.mobilites-m.fr/otp/routers/default"
    COLLECT_INTERVAL_SECONDS: int = 60
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"

    class Config:
        env_file = ".env"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",")]


@lru_cache()
def get_settings() -> Settings:
    return Settings()
