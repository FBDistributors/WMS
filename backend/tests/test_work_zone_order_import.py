"""Work zone exclusions for main SmartUp order import."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.integrations.smartup.importer import delete_stale_orders, import_orders
from app.integrations.smartup.schemas import SmartupOrder
from app.models.order import Order, OrderWmsState
from app.models.work_zone import WorkZone


def _smartup_order(*, external_id: str, room_id: str | None = None) -> SmartupOrder:
    data: dict = {
        "external_id": external_id,
        "deal_id": external_id,
        "order_no": external_id,
        "status": "B#W",
        "customer_name": "Client",
        "lines": [
            {
                "sku": "SKU-1",
                "barcode": "BAR-1",
                "name": "Product 1",
                "quantity": 1,
                "uom": "PCS",
                "price": "1000",
            }
        ],
    }
    if room_id is not None:
        data["room_id"] = room_id
    return SmartupOrder(**data)


def test_smartup_order_room_id_int_normalized() -> None:
    order = SmartupOrder(external_id="x1", deal_id="x1", room_id=82462)
    assert order.room_id == "82462"


def test_smartup_order_room_id_from_alias() -> None:
    order = SmartupOrder(external_id="x2", deal_id="x2", work_zone_id="999")
    assert order.room_id == "999"


def test_import_skips_excluded_room_id(db_session) -> None:
    db_session.add(WorkZone(room_id="82462", name="Zone A"))
    db_session.commit()

    created, updated, skipped, errors, skipped_by_reason = import_orders(
        db_session,
        [_smartup_order(external_id="wz-skip", room_id="82462")],
        exclude_work_zones=True,
    )
    assert (created, updated, skipped, len(errors)) == (0, 0, 1, 0)
    assert skipped_by_reason.get("work_zone_excluded") == 1
    assert db_session.query(Order).filter(Order.source_external_id == "wz-skip").count() == 0


def test_import_without_exclude_imports_room_id(db_session) -> None:
    db_session.add(WorkZone(room_id="82462", name="Zone A"))
    db_session.commit()

    created, updated, skipped, errors, skipped_by_reason = import_orders(
        db_session,
        [_smartup_order(external_id="wz-allow", room_id="82462")],
        exclude_work_zones=False,
    )
    assert (created, updated, skipped, len(errors)) == (1, 0, 0, 0)
    assert skipped_by_reason.get("work_zone_excluded", 0) == 0
    assert db_session.query(Order).filter(Order.source_external_id == "wz-allow").count() == 1


def test_delete_stale_removes_existing_excluded_work_zone_order(db_session) -> None:
    db_session.add(WorkZone(room_id="82462", name="Orikzor"))
    db_session.commit()

    ext = "246266891:3788131"
    order = Order(
        source="smartup",
        source_external_id=ext,
        order_number="95588",
        customer_name="2 76 KIYIM",
    )
    order.wms_state = OrderWmsState(status="imported")
    db_session.add(order)
    db_session.commit()

    smartup_row = SmartupOrder(
        deal_id="246266891",
        filial_id="3788131",
        delivery_number="95588",
        status="B#W",
        room_id="82462",
        customer_name="2 76 KIYIM",
        lines=[{"sku": "SKU-1", "quantity": 1, "uom": "PCS"}],
    )
    deleted = delete_stale_orders(
        db_session,
        [smartup_row],
        excluded_room_ids=frozenset({"82462"}),
    )
    assert deleted == 1
    assert db_session.query(Order).filter(Order.source_external_id == ext).count() == 0


def test_import_other_room_id_not_skipped(db_session) -> None:
    db_session.add(WorkZone(room_id="82462", name="Zone A"))
    db_session.commit()

    created, _, skipped, errors, skipped_by_reason = import_orders(
        db_session,
        [_smartup_order(external_id="wz-other", room_id="11111")],
        exclude_work_zones=True,
    )
    assert (created, skipped, len(errors)) == (1, 0, 0)
    assert skipped_by_reason.get("work_zone_excluded", 0) == 0


def _login(client: TestClient, username: str, password: str) -> dict[str, str]:
    r = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_work_zones_api_crud(client: TestClient, test_user) -> None:
    headers = _login(client, test_user.username, "testpass123")

    create = client.post(
        "/api/v1/work-zones",
        json={"room_id": "82462", "name": "Test zone"},
        headers=headers,
    )
    assert create.status_code == 201, create.text
    body = create.json()
    assert body["room_id"] == "82462"
    assert body["name"] == "Test zone"
    item_id = body["id"]

    listing = client.get("/api/v1/work-zones", headers=headers)
    assert listing.status_code == 200
    assert any(x["id"] == item_id for x in listing.json())

    update = client.put(
        f"/api/v1/work-zones/{item_id}",
        json={"name": "Renamed"},
        headers=headers,
    )
    assert update.status_code == 200
    assert update.json()["name"] == "Renamed"

    delete = client.delete(f"/api/v1/work-zones/{item_id}", headers=headers)
    assert delete.status_code == 204

    dup = client.post(
        "/api/v1/work-zones",
        json={"room_id": "82462", "name": "Dup"},
        headers=headers,
    )
    assert dup.status_code == 201
    dup2 = client.post(
        "/api/v1/work-zones",
        json={"room_id": "82462", "name": "Dup2"},
        headers=headers,
    )
    assert dup2.status_code == 409
