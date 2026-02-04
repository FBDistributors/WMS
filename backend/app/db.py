import os

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine


def _normalize_database_url(url: str) -> str:
    if url.startswith("postgres://"):
        return "postgresql+psycopg2://" + url[len("postgres://") :]
    if url.startswith("postgresql://") and "+psycopg2" not in url:
        return url.replace("postgresql://", "postgresql+psycopg2://", 1)
    return url


def get_database_url() -> str:
    url = os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL env var is required")
    return _normalize_database_url(url)


def create_engine_from_env() -> Engine:
    url = get_database_url()
    return create_engine(url, pool_pre_ping=True)
