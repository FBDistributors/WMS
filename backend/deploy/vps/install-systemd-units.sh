#!/usr/bin/env bash
# VPS: systemd unitlarni generatsiya qilib /etc/systemd/system ga yozadi va ishga tushiradi.
# Ishlatish (serverda, repo backend papkasida):
#   sudo bash deploy/vps/install-systemd-units.sh
#
# Muhit o‘zgaruvchilari (ixtiyoriy):
#   WMS_DEPLOY_DIR     — backend katalogi (default: joriy katalog)
#   WMS_VENV_BIN       — venv ichidagi bin (default: $WMS_DEPLOY_DIR/.venv/bin;
#                        topilmasa: backend/venv, ildiz/venv, ildiz/.venv qarab chiqiladi)
#   WMS_DEPLOY_USER    — linux user (default: www-data)
#   WMS_PORT           — API port (default: 8000)
#   WMS_SKIP_WORKER    — 1 bo‘lsa faqat API unit yoziladi
#   WMS_ENABLE_UZUM_WORKER — 1 bo‘lsa Uzum qoldiq sinxron worker ham o‘rnatiladi
#                        (api.env da UZUM_API_TOKEN bo‘lishi shart)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

WMS_DEPLOY_DIR="${WMS_DEPLOY_DIR:-$BACKEND_DIR}"
WMS_VENV_BIN="${WMS_VENV_BIN:-$WMS_DEPLOY_DIR/.venv/bin}"
WMS_DEPLOY_USER="${WMS_DEPLOY_USER:-www-data}"
WMS_PORT="${WMS_PORT:-8000}"
WMS_SKIP_WORKER="${WMS_SKIP_WORKER:-0}"
WMS_ENABLE_UZUM_WORKER="${WMS_ENABLE_UZUM_WORKER:-0}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Root bilan ishga tushiring: sudo bash $0" >&2
  exit 1
fi

if [[ ! -x "$WMS_VENV_BIN/uvicorn" ]]; then
  _repo_root="$(cd "$WMS_DEPLOY_DIR/.." && pwd)"
  _found=""
  for _c in "$WMS_DEPLOY_DIR/.venv/bin" "$WMS_DEPLOY_DIR/venv/bin" "$_repo_root/venv/bin" "$_repo_root/.venv/bin"; do
    if [[ -x "$_c/uvicorn" ]]; then
      _found="$_c"
      break
    fi
  done
  if [[ -n "$_found" ]]; then
    echo "Eslatma: uvicorn $WMS_VENV_BIN da yo'q, ishlatiladi: $_found" >&2
    WMS_VENV_BIN="$_found"
  else
    echo "uvicorn topilmadi. Quyidagilardan birini bajaring:" >&2
    echo "  1) cd $WMS_DEPLOY_DIR && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2
    echo "  2) yoki: export WMS_VENV_BIN=/to'g'ri/venv/bin && sudo bash $0" >&2
    exit 1
  fi
fi

if [[ ! -x "$WMS_VENV_BIN/python" ]]; then
  echo "python topilmadi: $WMS_VENV_BIN/python" >&2
  exit 1
fi

substitute() {
  local src="$1" dest="$2"
  sed \
    -e "s|@WMS_DEPLOY_DIR@|${WMS_DEPLOY_DIR//\\/\\\\}|g" \
    -e "s|@WMS_VENV_BIN@|${WMS_VENV_BIN//\\/\\\\}|g" \
    -e "s|@WMS_DEPLOY_USER@|$WMS_DEPLOY_USER|g" \
    -e "s|@WMS_PORT@|$WMS_PORT|g" \
    "$src" >"$dest"
  echo "Yozildi: $dest"
}

substitute "$SCRIPT_DIR/wms-api.service.example" /etc/systemd/system/wms-api.service

if [[ "$WMS_SKIP_WORKER" != "1" ]]; then
  substitute "$SCRIPT_DIR/wms-smartup-worker.service.example" /etc/systemd/system/wms-smartup-worker.service
fi

if [[ "$WMS_ENABLE_UZUM_WORKER" == "1" ]]; then
  substitute "$SCRIPT_DIR/wms-uzum-worker.service.example" /etc/systemd/system/wms-uzum-worker.service
fi

mkdir -p /etc/wms
if [[ ! -f /etc/wms/api.env ]]; then
  echo "# DATABASE_URL=postgresql://..." >/etc/wms/api.env
  chmod 600 /etc/wms/api.env
  echo "Yaratildi /etc/wms/api.env — DATABASE_URL va boshqa maxfiy o‘zgaruvchilarni qo‘shing."
fi

systemctl daemon-reload
systemctl enable wms-api.service
systemctl restart wms-api.service

if [[ "$WMS_SKIP_WORKER" != "1" ]]; then
  systemctl enable wms-smartup-worker.service
  systemctl restart wms-smartup-worker.service
fi

if [[ "$WMS_ENABLE_UZUM_WORKER" == "1" ]]; then
  systemctl enable wms-uzum-worker.service
  systemctl restart wms-uzum-worker.service
fi

echo ""
echo "Holat: systemctl status wms-api wms-smartup-worker"
echo "Loglar (jonli): journalctl -u wms-api -u wms-smartup-worker -f -n 200"
echo "Yoki: bash $SCRIPT_DIR/tail-wms-logs.sh"
