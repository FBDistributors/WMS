#!/usr/bin/env bash
# WMS repo ildizidan ishga tushiring (masalan: /var/www/wms):
#   bash scripts/vps-tail-logs.sh
#   bash scripts/vps-tail-logs.sh api
#
# Agar serverda faqat backend papkasi bo'lsa (/var/www/wms = backend):
#   bash deploy/vps/tail-wms-logs.sh

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$ROOT/backend/deploy/vps/tail-wms-logs.sh"
if [[ ! -f "$TARGET" ]]; then
  echo "Skript topilmadi: $TARGET" >&2
  echo "Git pull qiling yoki to'g'ri katalogda ekaningizni tekshiring." >&2
  echo "  Monorepo: cd /var/www/wms && bash scripts/vps-tail-logs.sh" >&2
  echo "  Faqat backend: cd /var/www/wms && bash deploy/vps/tail-wms-logs.sh" >&2
  exit 1
fi
exec bash "$TARGET" "$@"
