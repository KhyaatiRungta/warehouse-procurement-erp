import threading
from decimal import Decimal

import pytest

from app.db import SessionLocal
from app.errors import ApiError
from app.models import GoodsReceipt, MovementType, POLine, POStatus, PurchaseOrder, StockLevel, StockMovement, User
from app.services import procurement
from app.services.receiving import ReceiptRequest, receive_goods
from tests.conftest import PASSWORD  # noqa: F401  (keeps fixture module import explicit)


def _sent_po(world, qty: int) -> dict:
    """Create a PO through the service layer and move it to SENT."""
    with SessionLocal() as db:
        buyer = db.get(User, world["users"]["buyer"]["id"])
        admin = db.get(User, world["users"]["admin"]["id"])
        po = procurement.create_purchase_order(
            db, buyer, supplier_id=world["supplier"], warehouse_id=world["wh"], expected_date=None, notes=None,
            lines=[{"item_id": world["items"]["BOLT-1"], "quantity": qty, "unit_cost": 2.5}],
        )
        for action, actor in (("submit", buyer), ("approve", admin), ("send", buyer)):
            procurement.transition_purchase_order(db, actor, po, action)
        return {"po_id": po.id, "line_id": po.lines[0].id}


def _on_hand(world, sku_key="BOLT-1", wh_key="wh") -> int:
    with SessionLocal() as db:
        row = db.query(StockLevel).filter_by(item_id=world["items"][sku_key], warehouse_id=world[wh_key]).first()
        return row.on_hand if row else 0


def _receipt_count() -> int:
    with SessionLocal() as db:
        return db.query(GoodsReceipt).count()


def _clerk(world) -> User:
    with SessionLocal() as db:
        return db.get(User, world["users"]["warehouse_clerk"]["id"])


def test_partial_then_full_receipt_updates_po_and_stock(world):
    po = _sent_po(world, qty=10)
    before = _on_hand(world)
    with SessionLocal() as db:
        actor = db.get(User, world["users"]["warehouse_clerk"]["id"])
        receipt = receive_goods(db, actor, po_id=po["po_id"], lines=[ReceiptRequest(po["line_id"], 4)])
        assert receipt.number.startswith("GRN-")
    assert _on_hand(world) == before + 4

    with SessionLocal() as db:
        order = db.get(PurchaseOrder, po["po_id"])
        assert order.status == POStatus.PARTIALLY_RECEIVED.value
        actor = db.get(User, world["users"]["warehouse_clerk"]["id"])
        receive_goods(db, actor, po_id=po["po_id"], lines=[ReceiptRequest(po["line_id"], 6)])

    with SessionLocal() as db:
        assert db.get(PurchaseOrder, po["po_id"]).status == POStatus.RECEIVED.value
        assert db.get(POLine, po["line_id"]).received_qty == 10
        movements = db.query(StockMovement).filter_by(movement_type=MovementType.RECEIPT.value).all()
        assert sorted(m.quantity for m in movements) == [4, 6]
    assert _on_hand(world) == before + 10


def test_over_receipt_is_rejected_and_nothing_changes(world):
    po = _sent_po(world, qty=5)
    before = _on_hand(world)
    with SessionLocal() as db:
        actor = db.get(User, world["users"]["warehouse_clerk"]["id"])
        with pytest.raises(ApiError) as exc:
            receive_goods(db, actor, po_id=po["po_id"], lines=[ReceiptRequest(po["line_id"], 6)])
        assert exc.value.status_code == 422
        assert "outstanding" in exc.value.detail
    assert _on_hand(world) == before
    assert _receipt_count() == 0


def test_receipt_on_unsent_order_is_refused(world):
    with SessionLocal() as db:
        buyer = db.get(User, world["users"]["buyer"]["id"])
        po = procurement.create_purchase_order(
            db, buyer, supplier_id=world["supplier"], warehouse_id=world["wh"], expected_date=None, notes=None,
            lines=[{"item_id": world["items"]["BOLT-1"], "quantity": 3}],
        )
        line_id = po.lines[0].id
        po_id = po.id
    with SessionLocal() as db:
        actor = db.get(User, world["users"]["warehouse_clerk"]["id"])
        with pytest.raises(ApiError) as exc:
            receive_goods(db, actor, po_id=po_id, lines=[ReceiptRequest(line_id, 1)])
        assert exc.value.status_code == 409


def test_forced_failure_mid_receipt_leaves_no_partial_state(world, monkeypatch):
    """Stock, line progress, the GRN and ledger must roll back together when a late step fails."""
    po = _sent_po(world, qty=10)
    before_stock = _on_hand(world)

    def explode(*args, **kwargs):
        raise RuntimeError("simulated crash after stock was written")

    monkeypatch.setattr("app.services.audit.record", explode)
    with SessionLocal() as db:
        actor = db.get(User, world["users"]["warehouse_clerk"]["id"])
        with pytest.raises(RuntimeError):
            receive_goods(db, actor, po_id=po["po_id"], lines=[ReceiptRequest(po["line_id"], 7)])

    assert _on_hand(world) == before_stock
    assert _receipt_count() == 0
    with SessionLocal() as db:
        assert db.get(POLine, po["line_id"]).received_qty == 0
        assert db.get(PurchaseOrder, po["po_id"]).status == POStatus.SENT.value
        assert db.query(StockMovement).filter_by(movement_type=MovementType.RECEIPT.value).count() == 0


def test_concurrent_receipts_cannot_exceed_ordered_quantity(world):
    """Eight clients race to receive 2 units each against a line ordered for 10."""
    po = _sent_po(world, qty=10)
    before = _on_hand(world)
    workers = 8
    barrier = threading.Barrier(workers)
    outcomes: list[object] = []
    lock = threading.Lock()

    def attempt():
        with SessionLocal() as db:
            actor = db.get(User, world["users"]["warehouse_clerk"]["id"])
            barrier.wait()
            try:
                receive_goods(db, actor, po_id=po["po_id"], lines=[ReceiptRequest(po["line_id"], 2)])
                result: object = "ok"
            except ApiError as exc:
                result = exc.status_code
        with lock:
            outcomes.append(result)

    threads = [threading.Thread(target=attempt) for _ in range(workers)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)

    # Five receipts fit exactly. Once the PO is fully received, the rest are refused by the status
    # check (409) before quantity is even considered; a quantity refusal (422) is also acceptable.
    assert outcomes.count("ok") == 5, outcomes
    assert sorted(o for o in outcomes if o != "ok") == [409, 409, 409], outcomes
    with SessionLocal() as db:
        line = db.get(POLine, po["line_id"])
        assert line.received_qty == 10
        assert db.get(PurchaseOrder, po["po_id"]).status == POStatus.RECEIVED.value
    assert _on_hand(world) == before + 10
    assert _receipt_count() == 5


def test_cancel_is_refused_once_goods_have_arrived(client, world, headers):
    po = _sent_po(world, qty=4)
    with SessionLocal() as db:
        actor = db.get(User, world["users"]["warehouse_clerk"]["id"])
        receive_goods(db, actor, po_id=po["po_id"], lines=[ReceiptRequest(po["line_id"], 1)])
    response = client.post(f"/api/purchase-orders/{po['po_id']}/cancel", headers=headers("buyer"))
    assert response.status_code == 409


def test_receipt_endpoint_end_to_end(client, world, headers):
    po = _sent_po(world, qty=6)
    response = client.post(
        "/api/goods-receipts",
        json={"po_id": po["po_id"], "lines": [{"po_line_id": po["line_id"], "quantity": 6}], "notes": "Dock 2"},
        headers=headers("warehouse_clerk"),
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["number"].startswith("GRN-")
    assert body["total_units"] == 6
    assert client.get(f"/api/purchase-orders/{po['po_id']}", headers=headers("buyer")).json()["status"] == "received"
    assert client.post("/api/goods-receipts", json={"po_id": po["po_id"], "lines": [{"po_line_id": po["line_id"], "quantity": 1}]}, headers=headers("warehouse_clerk")).status_code == 409


def test_decimal_costs_are_exact(world):
    po = _sent_po(world, qty=3)
    with SessionLocal() as db:
        order = db.get(PurchaseOrder, po["po_id"])
        assert sum(l.ordered_qty * l.unit_cost for l in order.lines) == Decimal("7.50")
