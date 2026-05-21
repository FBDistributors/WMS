#!/usr/bin/env bash
# backend/.env dagi kalitlarni /etc/wms/api.env ga yozadi (systemd + alembic + worker uchun).
# Ishlatish (root):
#   cd /var/www/wms/backend
#   sudo bash deploy/vps/sync-api-env-from-dotenv.sh
#
# Mavjud /etc/wms/api.env zaxiralanadi. Faqat ro'yxatdagi kalitlar yangilanadi.

set -euo pipefail

BACKEND_DIR="${WMS_BACKEND_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
DOTENV="$BACKEND_DIR/.env"
API_ENV="/etc/wms/api.env"

KEYS=(
  DATABASE_URL
  SECRET_KEY
  CORS_ORIGINS
  PORT
  POOL_SIZE
  MAX_OVERFLOW
  SMARTUP_INVENTORY_EXPORT_URL
  SMARTUP_BASIC_USER
  SMARTUP_BASIC_PASS
  SMARTUP_PROJECT_CODE
  SMARTUP_FILIAL_ID
  SMARTUP_MFM_MOVEMENT_EXPORT_OMIT_DATES
  SMARTUP_MFM_EXPORT_FILL_CREATED_RANGE
  SMARTUP_MFM_SYNC_LOOKBACK_DAYS
  SMARTUP_MFM_DATE_FILTER_MODE
  SMARTUP_MFM_MOVEMENT_EXPORT_STATUS
  SYNC_INTERVAL_SECONDS
)

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Root bilan ishga tushiring: sudo bash $0" >&2
  exit 1
fi

if [[ ! -f "$DOTENV" ]]; then
  echo ".env topilmadi: $DOTENV" >&2
  exit 1
fi

mkdir -p /etc/wms
if [[ -f "$API_ENV" ]]; then
  cp "$API_ENV" "${API_ENV}.bak.$(date +%Y%m%d%H%M%S)"
  echo "Zaxira: ${API_ENV}.bak.*"
fi

# shellcheck disable=SC1090
set -a
source "$DOTENV"
set +a

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL .env da yo'q — to'xtatildi." >&2
  exit 1
fi

touch "$API_ENV"
chmod 600 "$API_ENV"

for key in "${KEYS[@]}"; do
  val="${!key:-}"
  [[ -n "$val" ]] || continue
  # Mavjud qatorni o'chirish, oxiriga yangi qo'shish
  if grep -q "^[[:space:]]*${key}=" "$API_ENV" 2>/dev/null; then
    sed -i "/^[[:space:]]*${key}=/d" "$API_ENV"
  fi
  printf '%s=%s\n' "$key" "$val" >>"$API_ENV"
done

echo "Yozildi: $API_ENV (kalitlar: ${#KEYS[@]} ro'yxatdan mavjudlari)"
echo "Keyin:"
echo "  cd $BACKEND_DIR && set -a && source $API_ENV && set +a && .venv/bin/alembic upgrade head"
echo "  sudo systemctl restart wms-api wms-smartup-worker"
