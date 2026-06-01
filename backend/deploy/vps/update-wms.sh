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
sleep 2
curl -sf "http://127.0.0.1:8000/health" && echo " — OK" || echo "WARN: /health javob bermadi"
curl -sf "http://127.0.0.1:8000/health/db" | head -c 200 || true
echo ""
echo "Tugadi. Log: journalctl -u wms-api -n 30 --no-pager"
