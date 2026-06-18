#!/usr/bin/env bash
# WMS VPS — kod yangilash (git pull + migratsiya + xizmatlarni qayta ishga tushirish).
#
# Ishlatish (serverda):
#   cd /var/www/wms/backend
#   bash deploy/vps/update-wms.sh
#
# Ixtiyoriy: WMS_ROOT=/ boshqa yo'l bo'lsa
#   WMS_ROOT=/var/www/wms bash deploy/vps/update-wms.sh

set -euo pipefail

WMS_ROOT="${WMS_ROOT:-/var/www/wms}"
BACKEND_DIR="${WMS_ROOT}/backend"

cd "$WMS_ROOT"
echo "==> git pull"
git pull origin main

cd "$BACKEND_DIR"

VENV_BIN=""
for v in ".venv/bin" "../.venv/bin" "venv/bin"; do
  if [[ -x "$v/pip" ]]; then
    VENV_BIN="$v"
    break
  fi
done
if [[ -z "$VENV_BIN" ]]; then
  echo "XATO: venv topilmadi ($BACKEND_DIR/.venv)"
  exit 1
fi

echo "==> pip install (requirements.txt)"
"$VENV_BIN/pip" install -r requirements.txt -q

echo "==> env yuklash"
set +u
set -a
if [[ -f /etc/wms/api.env ]]; then
  # shellcheck source=/dev/null
  source /etc/wms/api.env
fi
if [[ -z "${DATABASE_URL:-}" && -f "$BACKEND_DIR/.env" ]]; then
  line=$(grep -E '^[[:space:]]*(export[[:space:]]+)?DATABASE_URL=' "$BACKEND_DIR/.env" | tail -1 || true)
  if [[ -n "$line" ]]; then
    DATABASE_URL="${line#*=}"
    DATABASE_URL="${DATABASE_URL#"${DATABASE_URL%%[![:space:]]*}"}"
    DATABASE_URL="${DATABASE_URL%"${DATABASE_URL##*[![:space:]]}"}"
    export DATABASE_URL
  fi
fi
set +a
set -u

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "XATO: DATABASE_URL topilmadi (/etc/wms/api.env yoki backend/.env)"
  exit 1
fi

echo "==> alembic upgrade head"
"$VENV_BIN/alembic" upgrade head
"$VENV_BIN/alembic" current

echo "==> systemd restart"
sudo systemctl restart wms-api
sudo systemctl restart wms-smartup-worker

echo "==> health"
WMS_PORT="${WMS_PORT:-8000}"
HEALTH_URL="http://127.0.0.1:${WMS_PORT}/health"
HEALTH_OK=0
for _ in 1 2 3 4 5; do
  if systemctl is-active --quiet wms-api 2>/dev/null && curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
    HEALTH_OK=1
    break
  fi
  sleep 3
done
if [[ "$HEALTH_OK" -eq 1 ]]; then
  curl -sf "$HEALTH_URL" && echo " — OK"
  curl -sf "http://127.0.0.1:${WMS_PORT}/health/db" | head -c 200 || true
  echo ""
else
  echo "WARN: /health javob bermadi (${HEALTH_URL})"
  echo "--- wms-api status ---"
  systemctl status wms-api --no-pager -l 2>/dev/null | head -20 || true
  echo "--- journalctl (oxirgi 20) ---"
  journalctl -u wms-api -n 20 --no-pager 2>/dev/null || true
fi
echo ""
echo "Tugadi. Log: journalctl -u wms-api -n 30 --no-pager"
