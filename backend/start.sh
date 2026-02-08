#!/usr/bin/env bash
set -euo pipefail

alembic upgrade head
if [ "${SEED_ON_START:-false}" = "true" ]; then
  python -m app.scripts.seed
fi
if [ "${SEED_USERS_ON_START:-false}" = "true" ]; then
  python -m app.scripts.seed_users
fi
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-10000}"
