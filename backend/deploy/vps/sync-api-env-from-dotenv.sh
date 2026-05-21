#!/usr/bin/env bash
# backend/.env dagi kalitlarni /etc/wms/api.env ga yozadi (systemd + alembic + worker uchun).
# .env ni "source" qilmaydi — faqat KEY=value qatorlarini o'qiydi (export/unbound xatolardan qochish).
#
# Ishlatish (root):
#   cd /var/www/wms/backend
#   sudo bash deploy/vps/sync-api-env-from-dotenv.sh

set -eo pipefail

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

# .env dan bitta kalit qiymati (birinchi mos qator, oxirgi ustunlik)
read_dotenv_key() {
  local key="$1"
  local line raw
  line=$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "$DOTENV" 2>/dev/null | tail -1) || return 1
  raw="${line#*=}"
  raw="${raw#"${raw%%[![:space:]]*}"}"
  raw="${raw%"${raw##*[![:space:]]}"}"
  if [[ "$raw" == \"*\" && "$raw" == *\" ]]; then
    raw="${raw:1:${#raw}-2}"
  elif [[ "$raw" == \'*\' && "$raw" == *\' ]]; then
    raw="${raw:1:${#raw}-2}"
  fi
  printf '%s' "$raw"
}

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

db_url="$(read_dotenv_key DATABASE_URL || true)"
if [[ -z "$db_url" ]]; then
  echo "DATABASE_URL .env da topilmadi — to'xtatildi." >&2
  exit 1
fi

touch "$API_ENV"
chmod 600 "$API_ENV"

written=0
for key in "${KEYS[@]}"; do
  val="$(read_dotenv_key "$key" || true)"
  [[ -n "$val" ]] || continue
  if grep -q "^[[:space:]]*${key}=" "$API_ENV" 2>/dev/null; then
    sed -i "/^[[:space:]]*${key}=/d" "$API_ENV"
  fi
  printf '%s=%s\n' "$key" "$val" >>"$API_ENV"
  written=$((written + 1))
done

echo "Yozildi: $API_ENV ($written ta kalit, jumladan DATABASE_URL)"
echo "Keyin:"
echo "  cd $BACKEND_DIR && set -a && source $API_ENV && set +a && .venv/bin/alembic upgrade head"
echo "  sudo systemctl restart wms-api wms-smartup-worker"
