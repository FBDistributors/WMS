import os
from functools import lru_cache
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker


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
    # Limit pool: Render free Postgres ~20 connections. Web + Worker share DB.
    # connect_timeout: tez muvaffaqiyatsizlik (ulanish bo'lmasa). pool_timeout: pooldan connection kutish.
    return create_engine(
        url,
        pool_pre_ping=True,
        pool_size=3,
        max_overflow=2,
        pool_recycle=300,
        pool_timeout=15,
        connect_args={"connect_timeout": 10},
    )


@lru_cache
def get_engine() -> Engine:
    return create_engine_from_env()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=get_engine())


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
