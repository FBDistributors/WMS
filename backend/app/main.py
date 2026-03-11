import logging
import os
import time

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from sqlalchemy import text
from sqlalchemy.engine.url import make_url

from app.db import get_engine, get_database_url

logger = logging.getLogger(__name__)


class RequestTimeLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - start) * 1000
        logger.info(
            "%s %s %s - %.0fms",
            request.method,
            request.scope.get("path", ""),
            response.status_code,
            elapsed_ms,
        )
        return response


app = FastAPI(
    title="WMS Backend",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
    redirect_slashes=False,
)

def _get_cors_config() -> tuple[list[str], str | None]:
    cors_env = os.getenv("CORS_ORIGINS")
    allow_all = False
    origins: list[str] = []

    if cors_env:
        if cors_env.strip() == "*":
            allow_all = True
        else:
            origins = [origin.strip() for origin in cors_env.split(",") if origin.strip()]

    if not origins:
        origins = ["https://wms-opal.vercel.app"]

    if allow_all:
        origins = ["*"]

    return origins, r"^https://.*\.vercel\.app$"


# CORS (frontend ulanishi uchun)
cors_origins, cors_origin_regex = _get_cors_config()
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=cors_origin_regex,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    max_age=600,
)
app.add_middleware(RequestTimeLoggingMiddleware)

@app.get("/")
async def root():
    """Render va boshqa platformalar health check uchun HEAD/GET / ishlatadi — 404 oldini olish."""
    return {"status": "ok"}


@app.get("/health")
async def health_check():
    return {"status": "ok"}


@app.get("/health/db")
async def health_db_check():
    try:
        engine = get_engine()
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
            documents = connection.execute(
                text("SELECT to_regclass('public.documents')")
            ).scalar()
            lines = connection.execute(
                text("SELECT to_regclass('public.document_lines')")
            ).scalar()
        if not documents or not lines:
            raise HTTPException(status_code=500, detail="Database tables missing")
        return {"status": "ok", "documents": True, "document_lines": True}
    except Exception as exc:  # pragma: no cover - safety net
        logging.getLogger("uvicorn").warning("Database health check failed: %s", exc)
        raise HTTPException(status_code=500, detail="Database unavailable") from exc


@app.on_event("startup")
def on_startup() -> None:
    engine = get_engine()
    app.state.db_engine = engine
    url = make_url(get_database_url())
    safe_target = f"{url.drivername}://{url.host}:{url.port}/{url.database}"
    logging.getLogger("uvicorn").info("Database configured: %s", safe_target)

# Keyinchalik shu yerga routerlar ulanadi:
# from app.api.v1.router import router as api_router
# app.include_router(api_router, prefix="/api/v1")

from app.api.v1.router import router as api_router
app.include_router(api_router, prefix="/api/v1")
