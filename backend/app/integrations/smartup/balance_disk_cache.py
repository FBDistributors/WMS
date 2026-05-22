"""SmartUP balance$export javobini kun/ombor bo'yicha diskda saqlash (API qayta ishga tushganda ham qoladi)."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


def _cache_dir() -> Path:
    raw = (os.getenv("SMARTUP_BALANCE_CACHE_DIR") or "").strip()
    if raw:
        base = Path(raw)
    else:
        base = Path(__file__).resolve().parents[3] / "data" / "smartup_balance_cache"
    base.mkdir(parents=True, exist_ok=True)
    return base


def _cache_path(day_str: str, warehouse_code: str, filial_id: str) -> Path:
    fid_safe = (filial_id or "_").replace("/", "_").replace("\\", "_") or "_"
    wh = (warehouse_code or "001").strip() or "001"
    path = _cache_dir() / day_str / f"{wh}_{fid_safe}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def read_balance_cache(day_str: str, warehouse_code: str, filial_id: str) -> dict[str, Any] | None:
    path = _cache_path(day_str, warehouse_code, filial_id)
    if not path.is_file():
        return None
    try:
        raw = path.read_text(encoding="utf-8")
        data = json.loads(raw)
        if isinstance(data, dict) and "balance" in data:
            return data
        if isinstance(data, dict):
            return data
    except Exception as exc:
        logger.warning("SmartUP disk cache read failed %s: %s", path, exc)
    return None


def write_balance_cache(day_str: str, warehouse_code: str, filial_id: str, payload: Any) -> None:
    if not isinstance(payload, dict):
        return
    path = _cache_path(day_str, warehouse_code, filial_id)
    try:
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    except Exception as exc:
        logger.warning("SmartUP disk cache write failed %s: %s", path, exc)


def cache_loaded_at(day_str: str, warehouse_code: str, filial_id: str) -> str | None:
    path = _cache_path(day_str, warehouse_code, filial_id)
    if not path.is_file():
        return None
    ts = path.stat().st_mtime
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
