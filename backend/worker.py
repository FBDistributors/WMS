"""
Render Background Worker entrypoint for SmartUp sync.

Runs periodic sync of products and orders from SmartUp ERP.
Configure SYNC_INTERVAL_SECONDS (default: 300) for interval.
"""
from __future__ import annotations

import logging
import os
import sys
import time

from app.workers.smartup_sync import run_full_sync

# Structured logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=sys.stdout,
    force=True,
)
logger = logging.getLogger("smartup_worker")


def main() -> None:
    """Run sync loop with configurable interval."""
    interval = int(os.getenv("SYNC_INTERVAL_SECONDS", "600"))
    interval = max(60, min(interval, 86400))  # 1 min - 24 hours

    logger.info("SmartUp sync worker started, interval=%d seconds", interval)

    while True:
        try:
            run_full_sync()
        except KeyboardInterrupt:
            logger.info("Worker stopped by signal")
            raise
        except Exception as exc:
            logger.exception("Sync cycle failed (will retry): %s", exc)
            # Do NOT crash - sleep and retry

        try:
            time.sleep(interval)
        except KeyboardInterrupt:
            raise


if __name__ == "__main__":
    main()
