#!/usr/bin/env bash
# WMS VPS: deploy / DB / migratsiya diagnostikasi (natijani support uchun yuboring).
# Ishlatish:
#   cd /var/www/wms/backend
#   bash deploy/vps/check-wms-deploy.sh
# yoki:
#   bash /var/www/wms/backend/deploy/vps/check-wms-deploy.sh

set -uo pipefail

BACKEND_DIR="${WMS_BACKEND_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$BACKEND_DIR" || { echo "BACKEND_DIR topilmadi: $BACKEND_DIR"; exit 1; }

mask_url() {
  # postgresql://user:pass@host:port/db -> user:***@host:port/db
  sed -E 's#(postgresql(\+psycopg2)?://[^:]+:)[^@]+#\1***#g' <<<"$1"
}

section() { echo ""; echo "========== $1 =========="; }

section "1. Tizim"
echo "hostname: $(hostname)"
echo "date: $(date -Is 2>/dev/null || date)"
echo "pwd: $(pwd)"
echo "user: $(whoami)"

section "2. Git (ixtiyoriy)"
if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "branch: $(git branch --show-current 2>/dev/null || echo '?')"
  echo "commit: $(git rev-parse --short HEAD 2>/dev/null || echo '?')"
  git log -1 --oneline 2>/dev/null || true
else
  echo "git: yo'q yoki repo emas"
fi

section "3. Python venv va alembic"
for v in ".venv/bin" "../.venv/bin" "venv/bin"; do
  if [[ -x "$v/python" ]]; then
    echo "venv: $BACKEND_DIR/$v"
    echo "python: $($v/python --version 2>&1)"
    [[ -x "$v/alembic" ]] && echo "alembic: $($v/alembic --version 2>&1)" || echo "alembic: YO'Q"
    VENV_BIN="$v"
    break
  fi
done
if [[ -z "${VENV_BIN:-}" ]]; then
  echo "venv: TOPILMADI (.venv/bin yoki venv/bin)"
  VENV_BIN=""
fi

section "4. Env fayllar (parol yashirilgan)"
ENV_LOADED=0
for f in /etc/wms/api.env "$BACKEND_DIR/.env"; do
  if [[ -f "$f" ]]; then
    echo "file: $f (exists, mode $(stat -c '%a' "$f" 2>/dev/null || stat -f '%OLp' "$f" 2>/dev/null || echo '?'))"
    if grep -q '^[[:space:]]*DATABASE_URL=' "$f" 2>/dev/null; then
      line=$(grep '^[[:space:]]*DATABASE_URL=' "$f" | head -1 | sed 's/^[[:space:]]*//')
      echo "  $(mask_url "$line")"
    else
      echo "  DATABASE_URL: yo'q yoki faqat izoh (#)"
    fi
    grep -q '^[[:space:]]*SECRET_KEY=' "$f" 2>/dev/null && echo "  SECRET_KEY: bor" || echo "  SECRET_KEY: yo'q"
    grep -q '^[[:space:]]*SMARTUP_BASIC_USER=' "$f" 2>/dev/null && echo "  SMARTUP_BASIC_USER: bor" || echo "  SMARTUP_BASIC_USER: yo'q"
  else
    echo "file: $f — yo'q"
  fi
done

section "5. Joriy shell DATABASE_URL"
if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL (shell): $(mask_url "$DATABASE_URL")"
  ENV_LOADED=1
else
  echo "DATABASE_URL (shell): o'rnatilmagan"
fi

section "6. systemd (wms-api / wms)"
for unit in wms-api wms wms-smartup-worker; do
  if systemctl list-unit-files "$unit.service" &>/dev/null; then
    echo "--- $unit.service ---"
    systemctl is-active "$unit.service" 2>/dev/null || true
    systemctl is-enabled "$unit.service" 2>/dev/null || true
    systemctl show "$unit.service" -p EnvironmentFiles -p WorkingDirectory -p ExecStart --no-pager 2>/dev/null | head -20 || true
  fi
done

section "7. Alembic (env yuklangan holda)"
ALEMBIC_CMD=""
if [[ -n "${VENV_BIN:-}" && -x "${VENV_BIN}/alembic" ]]; then
  ALEMBIC_CMD="${VENV_BIN}/alembic"
elif command -v alembic >/dev/null 2>&1; then
  ALEMBIC_CMD="alembic"
fi

run_alembic() {
  if [[ -z "$ALEMBIC_CMD" ]]; then
    echo "alembic: ishga tushirilmadi (venv yo'q)"
    return 1
  fi
  if [[ -f /etc/wms/api.env ]]; then
    set -a
    # shellcheck source=/dev/null
    source /etc/wms/api.env
    set +a
    echo "env: /etc/wms/api.env yuklandi"
  elif [[ -f "$BACKEND_DIR/.env" ]]; then
    set -a
    # shellcheck source=/dev/null
    source "$BACKEND_DIR/.env"
    set +a
    echo "env: $BACKEND_DIR/.env yuklandi"
  else
    echo "env: hech qanday fayl yuklanmadi — xato kutiladi"
  fi
  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "DATABASE_URL: hali yo'q — alembic ishlamaydi"
    return 1
  fi
  echo "DATABASE_URL: $(mask_url "$DATABASE_URL")"
  echo "--- alembic current ---"
  $ALEMBIC_CMD current 2>&1 || true
  echo "--- alembic heads ---"
  $ALEMBIC_CMD heads 2>&1 || true
  echo "--- alembic history (oxirgi 5) ---"
  $ALEMBIC_CMD history -r -n 5 2>&1 || true
}

run_alembic || true

section "8. PostgreSQL ulanish (Python)"
if [[ -n "${VENV_BIN:-}" && -x "${VENV_BIN}/python" ]]; then
  PY="${VENV_BIN}/python"
elif command -v python3 >/dev/null 2>&1; then
  PY="python3"
else
  PY=""
fi

if [[ -n "$PY" ]]; then
  if [[ -f /etc/wms/api.env ]]; then set -a; source /etc/wms/api.env; set +a; fi
  $PY <<'PYEOF' 2>&1
import os
import sys
sys.path.insert(0, os.getcwd())
try:
    from app.db import get_database_url, get_engine
    from sqlalchemy import text
    url = get_database_url()
    safe = url.split("@")[-1] if "@" in url else "(masked)"
    print(f"get_database_url: ...@{safe}")
    eng = get_engine()
    with eng.connect() as conn:
        v = conn.execute(text("SELECT version()")).scalar()
        print(f"postgres: OK — {str(v)[:80]}")
        cur = conn.execute(text(
            "SELECT version_num FROM alembic_version LIMIT 1"
        )).scalar()
        print(f"alembic_version (DB): {cur}")
        try:
            n = conn.execute(text("SELECT COUNT(*) FROM work_zones")).scalar()
            print(f"work_zones jadvali: bor, qatorlar={n}")
        except Exception as e:
            print(f"work_zones jadvali: {type(e).__name__}: {e}")
except Exception as e:
    print(f"DB test: XATO — {type(e).__name__}: {e}")
    sys.exit(0)
PYEOF
else
  echo "python: topilmadi"
fi

section "9. API health (localhost)"
for port in 8000 10000; do
  if command -v curl >/dev/null 2>&1; then
    code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${port}/api/v1/health" 2>/dev/null || echo "000")
    echo "GET :${port}/api/v1/health -> HTTP $code"
  fi
done

section "10. Oxirgi API log (10 qator)"
for unit in wms-api wms; do
  if systemctl is-active "$unit.service" &>/dev/null; then
    echo "--- journalctl -u $unit -n 10 ---"
    journalctl -u "$unit.service" -n 10 --no-pager 2>/dev/null || true
    break
  fi
done

echo ""
echo "========== TUGADI =========="
echo "Butun chiqishni nusxa oling va yuboring (parollar avtomatik *** qilinadi)."
