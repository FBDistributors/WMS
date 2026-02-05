#!/usr/bin/env bash
set -euo pipefail

alembic upgrade head
if [ "${SEED_ON_START:-false}" = "true" ]; then
  python -m app.scripts.seed
fi
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-10000}"
