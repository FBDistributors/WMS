#!/usr/bin/env bash
# WMS API va SmartUp worker loglarini systemd journal orqali ko‘rish.
#
# Yo‘llar (serverdagi katalogga qarab):
#   Monorepo ildizi (ichida backend/ bor):  bash backend/deploy/vps/tail-wms-logs.sh
#   Faqat backend reposi (deploy/ shu yerda): bash deploy/vps/tail-wms-logs.sh
#   Monorepo ildizidan qisqa:               bash scripts/vps-tail-logs.sh
#
# Ishlatish (serverda):
#   bash deploy/vps/tail-wms-logs.sh          # jonli (-f), oxirgi 200 qator
#   bash deploy/vps/tail-wms-logs.sh api      # faqat API
#   bash deploy/vps/tail-wms-logs.sh worker  # faqat worker
#   bash deploy/vps/tail-wms-logs.sh since 1h  # oxirgi 1 soat, keyin -f

set -euo pipefail

MODE="${1:-all}"
SINCE=""

if [[ "${1:-}" == "since" && -n "${2:-}" ]]; then
  SINCE="$2"
  MODE="${3:-all}"
fi

units=()
case "$MODE" in
  api) units=(-u wms-api) ;;
  worker) units=(-u wms-smartup-worker) ;;
  all) units=(-u wms-api -u wms-smartup-worker) ;;
  *)
    echo "Noma'lum rejim: $MODE. Foydalanish: $0 [all|api|worker|since 1h [all|api|worker]]" >&2
    exit 1
    ;;
esac

if [[ -n "$SINCE" ]]; then
  exec journalctl "${units[@]}" --since "$SINCE" -f
fi

exec journalctl "${units[@]}" -n 200 -f
