from __future__ import annotations

import json

from app.db import SessionLocal
from app.integrations.smartup.client import SmartupClient
from app.integrations.smartup.importer import import_orders


def main() -> None:
    client = SmartupClient()
    response = client.export_orders(filial_code=None)

    items_b_w = response.items
    db = SessionLocal()
    try:
        created, updated, skipped, errors, _ = import_orders(db, items_b_w)
    finally:
        db.close()

    summary = {
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "errors": [error.__dict__ for error in errors],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
