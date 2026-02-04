import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db import create_engine_from_env

app = FastAPI(
    title="WMS Backend",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

def _get_cors_origins() -> list[str]:
    cors_env = os.getenv("CORS_ORIGINS", "*")
    if cors_env.strip() == "*":
        return ["*"]
    return [origin.strip() for origin in cors_env.split(",") if origin.strip()]


# CORS (frontend ulanishi uchun)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health_check():
    return {"status": "ok"}


@app.on_event("startup")
def on_startup() -> None:
    app.state.db_engine = create_engine_from_env()

# Keyinchalik shu yerga routerlar ulanadi:
# from app.api.v1.router import router as api_router
# app.include_router(api_router, prefix="/api/v1")

from app.api.v1.router import router as api_router
app.include_router(api_router, prefix="/api/v1")
