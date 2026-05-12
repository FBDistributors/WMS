"""
PostgreSQL advisory locks for SmartUp sync.
Each source (asosiy, diller, orikzor) uses a separate lock so they can sync in parallel.
Prevents race between background worker and HTTP-triggered sync within the same source.
"""
from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Generator

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

SMARTUP_SYNC_LOCK_ID = 70000
DILLER_SYNC_LOCK_ID = 70001
ORIKZOR_SYNC_LOCK_ID = 70002


def _try_advisory_lock(db: Session, lock_id: int) -> bool:
    row = db.execute(text("SELECT pg_try_advisory_lock(:key)"), {"key": lock_id}).scalar()
    return row is True


def _advisory_unlock(db: Session, lock_id: int) -> bool:
    row = db.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": lock_id}).scalar()
    released = row is True
    if released:
        logger.info("Advisory lock %s released", lock_id)
    return released


@contextmanager
def _advisory_lock(db: Session, lock_id: int, label: str) -> Generator[bool, None, None]:
    acquired = _try_advisory_lock(db, lock_id)
    if not acquired:
        logger.warning("%s lock not acquired (another sync in progress?), skipping", label)
        yield False
        return
    try:
        yield True
    finally:
        _advisory_unlock(db, lock_id)


# ── Public helpers (backwards-compatible) ─────────────────────────

def try_acquire_sync_lock(db: Session) -> bool:
    return _try_advisory_lock(db, SMARTUP_SYNC_LOCK_ID)


def release_sync_lock(db: Session) -> bool:
    return _advisory_unlock(db, SMARTUP_SYNC_LOCK_ID)


@contextmanager
def smartup_sync_lock(db: Session) -> Generator[bool, None, None]:
    with _advisory_lock(db, SMARTUP_SYNC_LOCK_ID, "SmartUp orders") as acquired:
        yield acquired


@contextmanager
def diller_sync_lock(db: Session) -> Generator[bool, None, None]:
    with _advisory_lock(db, DILLER_SYNC_LOCK_ID, "Diller movements") as acquired:
        yield acquired


@contextmanager
def orikzor_sync_lock(db: Session) -> Generator[bool, None, None]:
    with _advisory_lock(db, ORIKZOR_SYNC_LOCK_ID, "O'rikzor movements") as acquired:
        yield acquired
