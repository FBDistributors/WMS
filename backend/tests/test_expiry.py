"""
Tests for expiry date functionality in WMS.

Tests cover:
1. Creating lots with expiry dates
2. Unique constraint enforcement
3. FEFO (First Expired, First Out) logic
4. Receiving flow with expiry
5. Expiry date validation
"""
import pytest
from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4


def test_create_lot_with_expiry(db_session, test_product):
    """Test creating a stock lot with expiry date"""
    from app.models.stock import StockLot
    
    expiry = date.today() + timedelta(days=90)
    lot = StockLot(
        product_id=test_product.id,
        batch="BATCH-001",
        expiry_date=expiry
    )
    db_session.add(lot)
    db_session.commit()
    
    assert lot.id is not None
    assert lot.expiry_date == expiry
    assert lot.batch == "BATCH-001"


def test_prevent_duplicate_lots(db_session, test_product):
    """Test unique constraint on (product_id, batch, expiry_date)"""
    from app.models.stock import StockLot
    from sqlalchemy.exc import IntegrityError
    
    expiry = date.today() + timedelta(days=90)
    
    # Create first lot
    lot1 = StockLot(product_id=test_product.id, batch="BATCH-001", expiry_date=expiry)
    db_session.add(lot1)
    db_session.commit()
    
    # Try to create duplicate - should fail
    lot2 = StockLot(product_id=test_product.id, batch="BATCH-001", expiry_date=expiry)
    db_session.add(lot2)
    
    with pytest.raises(IntegrityError):
        db_session.commit()


def test_different_expiry_allows_duplicate_batch(db_session, test_product):
    """Test same batch with different expiry creates separate lots"""
    from app.models.stock import StockLot
    
    expiry1 = date.today() + timedelta(days=30)
    expiry2 = date.today() + timedelta(days=90)
    
    lot1 = StockLot(product_id=test_product.id, batch="BATCH-001", expiry_date=expiry1)
    lot2 = StockLot(product_id=test_product.id, batch="BATCH-001", expiry_date=expiry2)
    
    db_session.add_all([lot1, lot2])
    db_session.commit()
    
    assert lot1.id != lot2.id
    assert lot1.batch == lot2.batch
    assert lot1.expiry_date != lot2.expiry_date


def test_fefo_picks_earliest_expiry(db_session, test_product, test_location, test_user):
    """Test FEFO logic picks lot with earliest expiry first"""
    from app.models.stock import StockLot, StockMovement
    from app.api.v1.endpoints.orders import _fefo_available_lots
    
    # Create 3 lots with different expiry dates
    lot1 = StockLot(
        product_id=test_product.id, 
        batch="BATCH-001", 
        expiry_date=date.today() + timedelta(days=30)  # Expires soonest
    )
    lot2 = StockLot(
        product_id=test_product.id, 
        batch="BATCH-002", 
        expiry_date=date.today() + timedelta(days=90)
    )
    lot3 = StockLot(
        product_id=test_product.id, 
        batch="BATCH-003", 
        expiry_date=date.today() + timedelta(days=60)
    )
    db_session.add_all([lot1, lot2, lot3])
    db_session.flush()
    
    # Add stock to each lot
    for lot in [lot1, lot2, lot3]:
        movement = StockMovement(
            product_id=test_product.id,
            lot_id=lot.id,
            location_id=test_location.id,
            qty_change=Decimal("100"),
            movement_type="receipt",
            created_by_user_id=test_user.id
        )
        db_session.add(movement)
    db_session.commit()
    
    # Query FEFO
    available = _fefo_available_lots(db_session, test_product.id)
    
    # First lot should be the one expiring soonest (lot1)
    assert len(available) == 3
    assert available[0].lot_id == lot1.id
    assert available[0].expiry_date == lot1.expiry_date
    
    # Second should be lot3 (60 days)
    assert available[1].lot_id == lot3.id
    
    # Third should be lot2 (90 days)
    assert available[2].lot_id == lot2.id


def test_null_expiry_comes_last(db_session, test_product, test_location, test_user):
    """Test NULLS LAST in FEFO ordering"""
    from app.models.stock import StockLot, StockMovement
    from app.api.v1.endpoints.orders import _fefo_available_lots
    
    # Create lot with expiry and lot without
    lot_with_expiry = StockLot(
        product_id=test_product.id,
        batch="BATCH-WITH-EXPIRY",
        expiry_date=date.today() + timedelta(days=30)
    )
    lot_no_expiry = StockLot(
        product_id=test_product.id,
        batch="BATCH-NO-EXPIRY",
        expiry_date=None
    )
    db_session.add_all([lot_with_expiry, lot_no_expiry])
    db_session.flush()
    
    # Add stock to both
    for lot in [lot_with_expiry, lot_no_expiry]:
        movement = StockMovement(
            product_id=test_product.id,
            lot_id=lot.id,
            location_id=test_location.id,
            qty_change=Decimal("100"),
            movement_type="receipt",
            created_by_user_id=test_user.id
        )
        db_session.add(movement)
    db_session.commit()
    
    # Query FEFO
    available = _fefo_available_lots(db_session, test_product.id)
    
    # Lot with expiry should come first
    assert available[0].lot_id == lot_with_expiry.id
    assert available[0].expiry_date is not None
    
    # Lot without expiry should come last
    assert available[1].lot_id == lot_no_expiry.id
    assert available[1].expiry_date is None


def test_receiving_creates_new_lot(client, db_session, test_product, test_location, admin_token):
    """Test receiving creates new lot if not found"""
    expiry = (date.today() + timedelta(days=90)).isoformat()
    
    response = client.post(
        "/api/v1/receiving/receipts",
        json={
            "lines": [{
                "product_id": str(test_product.id),
                "qty": 50,
                "batch": "NEW-BATCH-001",
                "expiry_date": expiry,
                "location_id": str(test_location.id)
            }]
        },
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    assert response.status_code == 201
    data = response.json()
    assert data["lines"][0]["batch"] == "NEW-BATCH-001"
    assert data["lines"][0]["expiry_date"] == expiry
    
    # Complete the receipt
    receipt_id = data["id"]
    response = client.post(
        f"/api/v1/receiving/receipts/{receipt_id}/complete",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    assert response.status_code == 200
    
    # Verify lot was created
    from app.models.stock import StockLot
    lot = db_session.query(StockLot).filter(
        StockLot.product_id == test_product.id,
        StockLot.batch == "NEW-BATCH-001"
    ).one()
    
    assert lot.expiry_date.isoformat() == expiry


def test_reject_past_expiry_date(client, test_product, test_location, admin_token):
    """Test validation rejects past expiry dates"""
    past_date = (date.today() - timedelta(days=1)).isoformat()
    
    response = client.post(
        "/api/v1/receiving/receipts",
        json={
            "lines": [{
                "product_id": str(test_product.id),
                "qty": 50,
                "batch": "BATCH-001",
                "expiry_date": past_date,
                "location_id": str(test_location.id)
            }]
        },
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    assert response.status_code == 400
    assert "past" in response.json()["detail"].lower()


def test_accept_today_as_expiry(client, test_product, test_location, admin_token):
    """Test that today's date is accepted as expiry (edge case)"""
    today = date.today().isoformat()
    
    response = client.post(
        "/api/v1/receiving/receipts",
        json={
            "lines": [{
                "product_id": str(test_product.id),
                "qty": 50,
                "batch": "BATCH-TODAY",
                "expiry_date": today,
                "location_id": str(test_location.id)
            }]
        },
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    assert response.status_code == 201


def test_receiving_without_expiry_allowed(client, test_product, test_location, admin_token):
    """Test receiving without expiry date is allowed (for non-perishable items)"""
    response = client.post(
        "/api/v1/receiving/receipts",
        json={
            "lines": [{
                "product_id": str(test_product.id),
                "qty": 50,
                "batch": "BATCH-NO-EXPIRY",
                "expiry_date": None,
                "location_id": str(test_location.id)
            }]
        },
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    assert response.status_code == 201
    data = response.json()
    assert data["lines"][0]["expiry_date"] is None
