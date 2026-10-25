"""Goods receipt: PO -> receipt -> inventory, as one database transaction.

Concurrency model
- The purchase order row is locked FOR UPDATE first. Every receipt against the same PO
  is serialised here, so a second receipt waits and then sees the quantities the first
  one committed.
- PO lines are locked FOR UPDATE and re-validated against ordered_qty while locked, so
  over-receipt is impossible even if the API is hit by many clients at once.
- Stock rows are locked through services.stock.post_movement in item-id order to keep
  lock acquisition deterministic across concurrent receipts.
- Any exception (validation, stock, audit, database) rolls back the whole unit of work:
  no GRN row, no line progress, no ledger entry, no stock change.
"""

from collections import defaultdict
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import BadRequest, Conflict, NotFound
from app.models import (
    POLine,
    POStatus,
    PurchaseOrder,
    GoodsReceipt,
    GoodsReceiptLine,
    Item,
    MovementType,
    User,
    temp_number,
    utcnow,
)
from app.services import audit
from app.services.stock import post_movement

RECEIVABLE = frozenset({POStatus.SENT, POStatus.PARTIALLY_RECEIVED})


@dataclass(frozen=True)
class ReceiptRequest:
    po_line_id: int
    quantity: int


def receive_goods(
    db: Session,
    actor: User,
    *,
    po_id: int,
    lines: list[ReceiptRequest],
    notes: str | None = None,
) -> GoodsReceipt:
    try:
        po = db.execute(
            select(PurchaseOrder).where(PurchaseOrder.id == po_id).with_for_update().execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if po is None:
            raise NotFound("Purchase order")
        if po.status not in RECEIVABLE:
            raise Conflict(f"{po.number} is {po.status}; goods can only be received on sent orders")

        requested = _merge_requests(lines)
        po_lines = {
            line.id: line
            for line in db.execute(
                select(POLine)
                .where(POLine.po_id == po.id, POLine.id.in_(list(requested)))
                .with_for_update()
                .execution_options(populate_existing=True)
            ).scalars()
        }
        for line_id in requested:
            if line_id not in po_lines:
                raise BadRequest(f"Line {line_id} does not belong to {po.number}")

        for line_id, qty in requested.items():
            line = po_lines[line_id]
            outstanding = line.ordered_qty - line.received_qty
            if qty > outstanding:
                raise BadRequest(
                    f"Cannot receive {qty} of {line.item.sku}: only {outstanding} still outstanding on {po.number}"
                )

        warehouse = po.warehouse
        receipt = GoodsReceipt(
            number=temp_number(),
            po_id=po.id,
            warehouse_id=warehouse.id,
            received_by_id=actor.id,
            received_at=utcnow(),
            notes=notes,
        )
        db.add(receipt)
        db.flush()
        receipt.number = f"GRN-{receipt.id:06d}"

        for line_id in sorted(requested, key=lambda lid: po_lines[lid].item_id):
            line = po_lines[line_id]
            qty = requested[line_id]
            item: Item = line.item
            line.received_qty += qty
            db.add(
                GoodsReceiptLine(receipt_id=receipt.id, po_line_id=line.id, item_id=item.id, quantity=qty)
            )
            post_movement(
                db,
                item=item,
                warehouse=warehouse,
                movement_type=MovementType.RECEIPT,
                quantity_delta=qty,
                reference_prefix="GRN",
                reference=receipt.number,
                actor=actor,
                note=f"Received against {po.number}",
            )
        db.flush()

        fully = all(line.received_qty >= line.ordered_qty for line in po.lines)
        before_status = po.status
        po.status = (POStatus.RECEIVED if fully else POStatus.PARTIALLY_RECEIVED).value

        audit.record(
            db, actor, action="goods_receipt.create", entity_type="goods_receipt", entity_id=receipt.id,
            summary=f"Posted {receipt.number} against {po.number}",
            after={
                "po": po.number,
                "lines": [{"po_line_id": l, "quantity": q} for l, q in requested.items()],
                "po_status": po.status,
            },
        )
        audit.record(
            db, actor, action="purchase_order.receive", entity_type="purchase_order", entity_id=po.id,
            summary=f"{po.number} status {before_status} to {po.status}",
            before={"status": before_status}, after={"status": po.status},
        )
        db.commit()
        return receipt
    except Exception:
        db.rollback()
        raise


def _merge_requests(lines: list[ReceiptRequest]) -> dict[int, int]:
    if not lines:
        raise BadRequest("Add at least one line to receive")
    totals: dict[int, int] = defaultdict(int)
    for line in lines:
        if line.quantity <= 0:
            raise BadRequest("Received quantities must be greater than zero")
        totals[line.po_line_id] += line.quantity
    return dict(totals)
