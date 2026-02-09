from __future__ import annotations

import json
from datetime import date

from app.db import SessionLocal
from app.integrations.smartup.client import SmartupClient
from app.integrations.smartup.importer import import_orders


def main() -> None:
    client = SmartupClient()
    begin = date.today().replace(day=1)
    end = date.today()

    response = client.export_orders(
        begin_deal_date=begin.strftime("%d.%m.%Y"),
        end_deal_date=end.strftime("%d.%m.%Y"),
        filial_code=None,
    )

    db = SessionLocal()
    try:
        created, updated, skipped, errors = import_orders(db, response.items)
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
