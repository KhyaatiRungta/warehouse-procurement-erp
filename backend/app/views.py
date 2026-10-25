"""ORM -> response dictionaries. Money is returned as float for the UI; math happens in Decimal."""

from collections import defaultdict
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    OPEN_PO_STATUSES,
    GoodsReceipt,
    Item,
    POLine,
    PurchaseOrder,
    Requisition,
    StockLevel,
    StockMovement,
    User,
)
from app.security import permissions_for


def money(value) -> float:
    return float(Decimal(value or 0))


def user_out(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "permissions": permissions_for(user.role),
    }


def supplier_out(s, open_count: int = 0, open_value: Decimal = Decimal("0")) -> dict:
    return {
        "id": s.id,
        "code": s.code,
        "name": s.name,
        "contact_name": s.contact_name,
        "email": s.email,
        "phone": s.phone,
        "address": s.address,
        "payment_terms": s.payment_terms,
        "lead_time_days": s.lead_time_days,
        "is_active": s.is_active,
        "open_po_count": open_count,
        "open_po_value": money(open_value),
    }


def stock_map(db: Session) -> dict[int, list[StockLevel]]:
    rows = db.execute(select(StockLevel).order_by(StockLevel.warehouse_id)).scalars().all()
    grouped: dict[int, list[StockLevel]] = defaultdict(list)
    for row in rows:
        grouped[row.item_id].append(row)
    return grouped


def on_order_map(db: Session) -> dict[int, int]:
    rows = db.execute(
        select(POLine.item_id, func.sum(POLine.ordered_qty - POLine.received_qty))
        .join(PurchaseOrder, PurchaseOrder.id == POLine.po_id)
        .where(PurchaseOrder.status.in_([s.value for s in OPEN_PO_STATUSES]))
        .group_by(POLine.item_id)
    ).all()
    return {item_id: int(qty or 0) for item_id, qty in rows}


def item_out(item: Item, stocks: list[StockLevel], on_order: int, warehouse_codes: dict[int, str]) -> dict:
    total = sum(s.on_hand for s in stocks)
    return {
        "id": item.id,
        "sku": item.sku,
        "name": item.name,
        "description": item.description,
        "category": item.category,
        "uom": item.uom,
        "reorder_point": item.reorder_point,
        "reorder_quantity": item.reorder_quantity,
        "unit_cost": money(item.unit_cost),
        "preferred_supplier_id": item.preferred_supplier_id,
        "preferred_supplier_name": item.preferred_supplier.name if item.preferred_supplier else None,
        "is_active": item.is_active,
        "total_on_hand": total,
        "on_order": on_order,
        "is_low": item.reorder_point > 0 and total <= item.reorder_point,
        "stock": [
            {"warehouse_id": s.warehouse_id, "warehouse_code": warehouse_codes.get(s.warehouse_id, ""), "on_hand": s.on_hand}
            for s in stocks
        ],
    }


def movement_out(m: StockMovement) -> dict:
    return {
        "id": m.id,
        "item_id": m.item_id,
        "sku": m.item.sku,
        "item_name": m.item.name,
        "warehouse_id": m.warehouse_id,
        "warehouse_code": m.warehouse.code,
        "movement_type": m.movement_type,
        "quantity": m.quantity,
        "balance_after": m.balance_after,
        "reference": m.reference,
        "note": m.note,
        "created_by": m.created_by.email if m.created_by else None,
        "created_at": m.created_at,
    }


def requisition_out(req: Requisition, purchase_order_number: str | None = None) -> dict:
    lines = []
    total = Decimal("0")
    for l in req.lines:
        cost = l.estimated_unit_cost if l.estimated_unit_cost is not None else l.item.unit_cost
        line_total = Decimal(l.quantity) * Decimal(cost or 0)
        total += line_total
        lines.append(
            {
                "id": l.id,
                "item_id": l.item_id,
                "sku": l.item.sku,
                "item_name": l.item.name,
                "uom": l.item.uom,
                "quantity": l.quantity,
                "estimated_unit_cost": money(cost),
                "line_total": money(line_total),
            }
        )
    return {
        "id": req.id,
        "number": req.number,
        "title": req.title,
        "status": req.status,
        "needed_by": req.needed_by,
        "notes": req.notes,
        "requester": req.requester.full_name,
        "decided_by": req.decided_by.full_name if req.decided_by else None,
        "decided_at": req.decided_at,
        "decision_note": req.decision_note,
        "created_at": req.created_at,
        "total_estimate": money(total),
        "purchase_order_number": purchase_order_number,
        "lines": lines,
    }


def po_line_out(l: POLine) -> dict:
    line_total = Decimal(l.ordered_qty) * Decimal(l.unit_cost)
    return {
        "id": l.id,
        "item_id": l.item_id,
        "sku": l.item.sku,
        "item_name": l.item.name,
        "uom": l.item.uom,
        "ordered_qty": l.ordered_qty,
        "received_qty": l.received_qty,
        "open_qty": l.ordered_qty - l.received_qty,
        "unit_cost": money(l.unit_cost),
        "line_total": money(line_total),
    }


def po_summary(po: PurchaseOrder) -> dict:
    total = sum((Decimal(l.ordered_qty) * Decimal(l.unit_cost) for l in po.lines), Decimal("0"))
    ordered = sum(l.ordered_qty for l in po.lines)
    received = sum(l.received_qty for l in po.lines)
    return {
        "id": po.id,
        "number": po.number,
        "status": po.status,
        "supplier_id": po.supplier_id,
        "supplier_name": po.supplier.name,
        "warehouse_id": po.warehouse_id,
        "warehouse_code": po.warehouse.code,
        "order_date": po.order_date,
        "expected_date": po.expected_date,
        "line_count": len(po.lines),
        "units_ordered": ordered,
        "units_received": received,
        "total_amount": money(total),
        "created_at": po.created_at,
    }


def po_out(po: PurchaseOrder) -> dict:
    base = po_summary(po)
    base.update(
        {
            "supplier": {
                "id": po.supplier.id,
                "code": po.supplier.code,
                "name": po.supplier.name,
                "email": po.supplier.email,
                "phone": po.supplier.phone,
                "address": po.supplier.address,
                "payment_terms": po.supplier.payment_terms,
                "lead_time_days": po.supplier.lead_time_days,
            },
            "warehouse_name": po.warehouse.name,
            "warehouse_location": po.warehouse.location,
            "requisition_id": po.requisition_id,
            "requisition_number": po.requisition.number if po.requisition else None,
            "notes": po.notes,
            "created_by": po.created_by.full_name,
            "approved_by": po.approved_by.full_name if po.approved_by else None,
            "approved_at": po.approved_at,
            "sent_at": po.sent_at,
            "lines": [po_line_out(l) for l in po.lines],
        }
    )
    return base


def receipt_out(r: GoodsReceipt) -> dict:
    return {
        "id": r.id,
        "number": r.number,
        "po_id": r.po_id,
        "po_number": r.purchase_order.number,
        "supplier_name": r.purchase_order.supplier.name,
        "warehouse_id": r.warehouse_id,
        "warehouse_code": r.warehouse.code,
        "received_by": r.received_by.full_name,
        "received_at": r.received_at,
        "notes": r.notes,
        "total_units": sum(l.quantity for l in r.lines),
        "lines": [
            {
                "id": l.id,
                "po_line_id": l.po_line_id,
                "item_id": l.item_id,
                "sku": l.item.sku,
                "item_name": l.item.name,
                "quantity": l.quantity,
            }
            for l in r.lines
        ],
    }
