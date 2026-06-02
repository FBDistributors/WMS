from __future__ import annotations

import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.main import app
from app.models.order import Order, OrderWmsState
from app.models.settings_organization import SettingsOrganization
from tests.test_order_transition_policy import _mk_user


def test_diller_list_search_by_to_filial_name(client: TestClient, db_session: Session) -> None:
    admin = _mk_user(db_session, username=f"adm-diller-{uuid.uuid4().hex[:8]}", role="warehouse_admin")

    org = SettingsOrganization(org_id="7000001", name="Дилер Хорезм (Мансур)")
    db_session.add(org)
    db_session.flush()

    order = Order(
        source="diller",
        source_external_id=f"mfm:search-{uuid.uuid4().hex[:8]}",
        order_number="MV-SEARCH-1",
        filial_id="7000001",
        to_filial_code="7000001",
        movement_note="test note",
    )
    order.wms_state = OrderWmsState(status="W")
    db_session.add(order)
    db_session.commit()

    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        res = client.get(
            "/api/v1/orders",
            params={
                "order_source": "diller",
                "status": "W",
                "filial_id": "all",
                "q": "Хорезм",
                "search_fields": "to_filial",
            },
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert res.status_code == 200, res.text
    items = res.json()["items"]
    assert any(item["id"] == str(order.id) for item in items)
