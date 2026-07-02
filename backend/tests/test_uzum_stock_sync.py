"""Uzum stock sync: masking, balans yig'ish va diff logikasi testlari."""
from app.integrations.uzum import stock_sync
from app.integrations.uzum.stock_sync import (
    _aggregate_by_product_code,
    masked_amount,
    run_uzum_stock_sync,
)


def test_masked_amount_hides_real_stock():
    cap = 30
    assert masked_amount(500, cap) == 30
    assert masked_amount(31, cap) == 30
    assert masked_amount(30, cap) == 30  # teng bo'lsa ham 30
    assert masked_amount(29, cap) == 0
    assert masked_amount(1, cap) == 0
    assert masked_amount(0, cap) == 0


def test_aggregate_sums_batches_per_product_code():
    rows = [
        {"product_code": "L0022", "quantity": 10},
        {"product_code": "L0022", "quantity": 25.0, "batch_number": "B2"},
        {"product_code": "A100", "quantity": "7"},
        {"code": "B200", "quantity": 3},  # ba'zi javoblarda 'code' kaliti
        {"product_code": "", "quantity": 99},  # kodsiz qator tashlab yuboriladi
        {"product_code": "A100", "quantity": None},  # noto'g'ri qiymat = 0
    ]
    totals = _aggregate_by_product_code(rows)
    assert totals == {"L0022": 35.0, "A100": 7.0, "B200": 3.0}


class _FakeUzumClient:
    """get_fbs_sku_stocks natijasini qaytaradi, yuborilgan update larni yozib boradi."""

    sent: list[dict] = []
    uzum_skus: list[dict] = []

    def __init__(self) -> None:
        pass

    def get_fbs_sku_stocks(self):
        return list(type(self).uzum_skus)

    def update_fbs_sku_stocks(self, items):
        type(self).sent.extend(items)
        return items


class _FakeSession:
    def close(self) -> None:
        pass


def _setup_sync(monkeypatch, *, stock, reserved, barcodes, uzum_skus):
    def fake_fetch(warehouse_code):
        return stock if warehouse_code == stock_sync.WAREHOUSE_STOCK else reserved

    _FakeUzumClient.sent = []
    _FakeUzumClient.uzum_skus = uzum_skus
    monkeypatch.setattr(stock_sync, "_fetch_balance_rows", fake_fetch)
    monkeypatch.setattr(stock_sync, "_barcodes_by_product_code", lambda db, codes: barcodes)
    monkeypatch.setattr(stock_sync, "SessionLocal", _FakeSession)
    monkeypatch.setattr(stock_sync, "UzumSellerClient", _FakeUzumClient)


def test_sync_sends_only_changed_and_masked(monkeypatch):
    _setup_sync(
        monkeypatch,
        # A: 100 − 10 = 90 → 30; B: 40 − 15 = 25 → 0; C: 50 → 30 (Uzumda allaqachon 30)
        stock=[
            {"product_code": "A", "quantity": 100},
            {"product_code": "B", "quantity": 40},
            {"product_code": "C", "quantity": 50},
        ],
        reserved=[
            {"product_code": "A", "quantity": 10},
            {"product_code": "B", "quantity": 15},
        ],
        barcodes={"A": ["111"], "B": ["222"], "C": ["333"]},
        uzum_skus=[
            {"barcode": "111", "amount": 27},   # buyurtmalar bilan kamaygan → 30 ga to'ldiriladi
            {"barcode": "222", "amount": 30},   # 25 < 30 → 0 ga tushiriladi
            {"barcode": "333", "amount": 30},   # o'zgarish yo'q → yuborilmaydi
            {"barcode": "999", "amount": 12},   # Smartupda yo'q → 0 ga tushiriladi
        ],
    )
    summary = run_uzum_stock_sync(dry_run=False)
    sent = {u["barcode"]: u["amount"] for u in _FakeUzumClient.sent}
    assert sent == {"111": 30, "222": 0, "999": 0}
    assert summary["sent"] == 3
    assert summary["unmatched_uzum_count"] == 1


def test_sync_dry_run_sends_nothing(monkeypatch):
    _setup_sync(
        monkeypatch,
        stock=[{"product_code": "A", "quantity": 100}],
        reserved=[],
        barcodes={"A": ["111"]},
        uzum_skus=[{"barcode": "111", "amount": 5}],
    )
    summary = run_uzum_stock_sync(dry_run=True)
    assert _FakeUzumClient.sent == []
    assert summary["sent"] == 0
    assert summary["updates_needed"] == 1


def test_sync_aborts_when_smartup_balance_empty(monkeypatch):
    _setup_sync(monkeypatch, stock=[], reserved=[], barcodes={}, uzum_skus=[])
    import pytest

    with pytest.raises(RuntimeError):
        run_uzum_stock_sync(dry_run=False)
    assert _FakeUzumClient.sent == []
