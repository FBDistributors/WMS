"""
Uzum Market stock sync worker entrypoint.

Smartup balansini (001 − 002) olib, masking bilan (>= cap → cap, aks holda 0)
Uzum FBS qoldiqlarini davriy yangilaydi.
Configure UZUM_SYNC_INTERVAL_SECONDS (default: 900) for interval.
"""
from __future__ import annotations

import logging
import os
import sys
import time

from app.integrations.uzum.stock_sync import run_uzum_stock_sync

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=sys.stdout,
    force=True,
)
logger = logging.getLogger("uzum_worker")


def main() -> None:
    interval = int(os.getenv("UZUM_SYNC_INTERVAL_SECONDS", "900"))
    interval = max(60, min(interval, 86400))  # 1 min - 24 hours

    logger.info("Uzum stock sync worker started, interval=%d seconds", interval)

    while True:
        try:
            run_uzum_stock_sync()
        except KeyboardInterrupt:
            logger.info("Worker stopped by signal")
            raise
        except Exception as exc:
            logger.exception("Uzum sync cycle failed (will retry): %s", exc)
            # Do NOT crash - sleep and retry

        try:
            time.sleep(interval)
        except KeyboardInterrupt:
            raise


if __name__ == "__main__":
    main()
