"""
PostgreSQL advisory lock for SmartUp sync: only one full/orders sync at a time.
Prevents race between background worker and HTTP-triggered sync.
"""
from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Generator

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Single lock key for all SmartUp sync (orders + products). Full sync and orders-only sync share it.
SMARTUP_SYNC_LOCK_ID = 70000


def try_acquire_sync_lock(db: Session) -> bool:
    """Acquire advisory lock if available. Returns True if acquired, False if another process holds it."""
    row = db.execute(text("SELECT pg_try_advisory_lock(:key)"), {"key": SMARTUP_SYNC_LOCK_ID}).scalar()
    return row is True


def release_sync_lock(db: Session) -> bool:
    """Release advisory lock. Returns True if released."""
    row = db.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": SMARTUP_SYNC_LOCK_ID}).scalar()
    return row is True


@contextmanager
def smartup_sync_lock(db: Session) -> Generator[bool, None, None]:
    """
    Context manager: acquire lock on enter, release on exit.
    Yields True if lock acquired, False otherwise. Caller should skip sync if False.
    """
    acquired = try_acquire_sync_lock(db)
    if not acquired:
        logger.warning("SmartUp sync lock not acquired (another sync in progress?), skipping")
        yield False
        return
    try:
        yield True
    finally:
        release_sync_lock(db)
