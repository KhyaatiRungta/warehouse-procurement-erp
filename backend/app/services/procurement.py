"""Purchase requisition and purchase order workflows.

Every function stages its changes and audit rows in the caller's session and
commits once at the end, so a failed step never leaves a half-applied workflow.
"""

import datetime as dt
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import BadRequest, Conflict, NotFound
from app.models import (
    POLine,
    POStatus,
    PurchaseOrder,
    Requisition,
    RequisitionLine,
    RequisitionStatus,
    Supplier,
    User,
    Warehouse,
    temp_number,
    utcnow,
)
from app.services import audit

# action -> (allowed from-statuses, to-status, permission)
PO_ACTIONS: dict[str, tuple[frozenset[POStatus], POStatus, str]] = {
    "submit": (frozenset({POStatus.DRAFT}), POStatus.SUBMITTED, "purchase_orders:write"),
    "recall": (frozenset({POStatus.SUBMITTED}), POStatus.DRAFT, "purchase_orders:write"),
    "approve": (frozenset({POStatus.SUBMITTED}), POStatus.APPROVED, "purchase_orders:approve"),
    "send": (frozenset({POStatus.APPROVED}), POStatus.SENT, "purchase_orders:write"),
    "cancel": (
        frozenset({POStatus.DRAFT, POStatus.SUBMITTED, POStatus.APPROVED, POStatus.SENT}),
        POStatus.CANCELLED,
        "purchase_orders:write",
    ),
}

REQ_EDITABLE = frozenset({RequisitionStatus.DRAFT})


def _assign_number(db: Session, obj, prefix: str, field: str = "number") -> None:
    db.flush()
    setattr(obj, field, f"{prefix}-{obj.id:06d}")
    db.flush()


# ---------- requisitions ----------


def create_requisition(
    db: Session, actor: User, *, title: str, needed_by: dt.date | None, notes: str | None, lines: list[dict]
) -> Requisition:
    req = Requisition(
        number=temp_number(),
        title=title,
        needed_by=needed_by,
        notes=notes,
        status=RequisitionStatus.DRAFT.value,
        requester_id=actor.id,
    )
    db.add(req)
    req.lines = [_req_line(item_id, qty, cost) for item_id, qty, cost in _line_tuples(lines)]
    _assign_number(db, req, "PR")
    audit.record(
        db, actor, action="requisition.create", entity_type="requisition", entity_id=req.id,
        summary=f"Created {req.number}: {title}", after=_req_snapshot(req),
    )
    db.commit()
    return req


def update_requisition(db: Session, actor: User, req: Requisition, changes: dict) -> Requisition:
    if req.status not in REQ_EDITABLE:
        raise Conflict(f"{req.number} is {req.status} and can no longer be edited")
    before = _req_snapshot(req)
    for field in ("title", "needed_by", "notes"):
        if field in changes:
            setattr(req, field, changes[field])
    if "lines" in changes and changes["lines"] is not None:
        req.lines = [_req_line(i, q, c) for i, q, c in _line_tuples(changes["lines"])]
    db.flush()
    audit.record(
        db, actor, action="requisition.update", entity_type="requisition", entity_id=req.id,
        summary=f"Edited {req.number}", before=before, after=_req_snapshot(req),
    )
    db.commit()
    return req


def submit_requisition(db: Session, actor: User, req: Requisition) -> Requisition:
    if req.status != RequisitionStatus.DRAFT:
        raise Conflict(f"Only draft requisitions can be submitted; {req.number} is {req.status}")
    if not req.lines:
        raise BadRequest("Add at least one line before submitting")
    req.status = RequisitionStatus.SUBMITTED.value
    audit.record(
        db, actor, action="requisition.submit", entity_type="requisition", entity_id=req.id,
        summary=f"Submitted {req.number} for approval", after={"status": req.status},
    )
    db.commit()
    return req


def decide_requisition(db: Session, actor: User, req: Requisition, approve: bool, note: str | None) -> Requisition:
    if req.status != RequisitionStatus.SUBMITTED:
        raise Conflict(f"{req.number} is {req.status}; only submitted requisitions can be decided")
    req.status = (RequisitionStatus.APPROVED if approve else RequisitionStatus.REJECTED).value
    req.decided_by_id = actor.id
    req.decided_at = utcnow()
    req.decision_note = note
    verb = "Approved" if approve else "Rejected"
    audit.record(
        db, actor, action="requisition.approve" if approve else "requisition.reject",
        entity_type="requisition", entity_id=req.id, summary=f"{verb} {req.number}",
        after={"status": req.status, "note": note},
    )
    db.commit()
    return req


def convert_requisition(
    db: Session,
    actor: User,
    req: Requisition,
    *,
    supplier_id: int,
    warehouse_id: int,
    expected_date: dt.date | None,
    notes: str | None,
) -> PurchaseOrder:
    if req.status != RequisitionStatus.APPROVED:
        raise Conflict(f"Only approved requisitions can be converted; {req.number} is {req.status}")
    supplier = db.get(Supplier, supplier_id)
    if supplier is None or not supplier.is_active:
        raise BadRequest("Choose an active supplier")
    warehouse = db.get(Warehouse, warehouse_id)
    if warehouse is None or not warehouse.is_active:
        raise BadRequest("Choose an active warehouse")

    po = PurchaseOrder(
        number=temp_number(),
        status=POStatus.DRAFT.value,
        supplier_id=supplier.id,
        warehouse_id=warehouse.id,
        requisition_id=req.id,
        expected_date=expected_date,
        notes=notes or f"Raised from {req.number}",
        created_by_id=actor.id,
    )
    db.add(po)
    po.lines = [
        POLine(item_id=line.item_id, ordered_qty=line.quantity, received_qty=0,
               unit_cost=_unit_cost_for(line.estimated_unit_cost, line.item.unit_cost))
        for line in req.lines
    ]
    _assign_number(db, po, "PO")
    req.status = RequisitionStatus.CONVERTED.value
    audit.record(
        db, actor, action="requisition.convert", entity_type="requisition", entity_id=req.id,
        summary=f"Converted {req.number} to {po.number}", after={"purchase_order": po.number},
    )
    audit.record(
        db, actor, action="purchase_order.create", entity_type="purchase_order", entity_id=po.id,
        summary=f"Created {po.number} from {req.number}", after=po_snapshot(po),
    )
    db.commit()
    return po


# ---------- purchase orders ----------


def create_purchase_order(
    db: Session, actor: User, *, supplier_id: int, warehouse_id: int, expected_date: dt.date | None,
    notes: str | None, lines: list[dict],
) -> PurchaseOrder:
    supplier = db.get(Supplier, supplier_id)
    if supplier is None or not supplier.is_active:
        raise BadRequest("Choose an active supplier")
    warehouse = db.get(Warehouse, warehouse_id)
    if warehouse is None or not warehouse.is_active:
        raise BadRequest("Choose an active warehouse")
    po = PurchaseOrder(
        number=temp_number(), status=POStatus.DRAFT.value, supplier_id=supplier.id,
        warehouse_id=warehouse.id, expected_date=expected_date, notes=notes, created_by_id=actor.id,
    )
    db.add(po)
    po.lines = _po_lines(db, lines)
    _assign_number(db, po, "PO")
    audit.record(
        db, actor, action="purchase_order.create", entity_type="purchase_order", entity_id=po.id,
        summary=f"Created {po.number} for {supplier.name}", after=po_snapshot(po),
    )
    db.commit()
    return po


def update_purchase_order(db: Session, actor: User, po: PurchaseOrder, changes: dict) -> PurchaseOrder:
    if po.status != POStatus.DRAFT:
        raise Conflict(f"{po.number} is {po.status}; only draft orders can be edited")
    before = po_snapshot(po)
    if "supplier_id" in changes and changes["supplier_id"] is not None:
        supplier = db.get(Supplier, changes["supplier_id"])
        if supplier is None or not supplier.is_active:
            raise BadRequest("Choose an active supplier")
        po.supplier_id = supplier.id
    if "warehouse_id" in changes and changes["warehouse_id"] is not None:
        warehouse = db.get(Warehouse, changes["warehouse_id"])
        if warehouse is None or not warehouse.is_active:
            raise BadRequest("Choose an active warehouse")
        po.warehouse_id = warehouse.id
    for field in ("expected_date", "notes"):
        if field in changes:
            setattr(po, field, changes[field])
    if changes.get("lines") is not None:
        po.lines = _po_lines(db, changes["lines"])
    db.flush()
    audit.record(
        db, actor, action="purchase_order.update", entity_type="purchase_order", entity_id=po.id,
        summary=f"Edited {po.number}", before=before, after=po_snapshot(po),
    )
    db.commit()
    return po


def transition_purchase_order(db: Session, actor: User, po: PurchaseOrder, action: str) -> PurchaseOrder:
    allowed_from, target, _perm = PO_ACTIONS[action]
    if po.status not in allowed_from:
        raise Conflict(f"Cannot {action} {po.number} while it is {po.status}")
    if action == "cancel" and any(line.received_qty > 0 for line in po.lines):
        raise Conflict(f"{po.number} has goods already received and cannot be cancelled")
    before = {"status": po.status}
    po.status = target.value
    now = utcnow()
    if action == "approve":
        po.approved_by_id = actor.id
        po.approved_at = now
    if action == "send":
        po.sent_at = now
    audit.record(
        db, actor, action=f"purchase_order.{action}", entity_type="purchase_order", entity_id=po.id,
        summary=f"{action.capitalize()} {po.number}", before=before, after={"status": po.status},
    )
    db.commit()
    return po


def po_snapshot(po: PurchaseOrder) -> dict:
    return {
        "number": po.number,
        "status": po.status,
        "supplier_id": po.supplier_id,
        "warehouse_id": po.warehouse_id,
        "expected_date": po.expected_date,
        "lines": [
            {"item_id": l.item_id, "ordered_qty": l.ordered_qty, "unit_cost": l.unit_cost}
            for l in po.lines
        ],
    }


def _req_snapshot(req: Requisition) -> dict:
    return {
        "number": req.number,
        "title": req.title,
        "status": req.status,
        "lines": [{"item_id": l.item_id, "quantity": l.quantity} for l in req.lines],
    }


def _line_tuples(lines: list[dict]) -> list[tuple[int, int, Decimal | None]]:
    seen: set[int] = set()
    out = []
    for line in lines:
        if line["item_id"] in seen:
            raise BadRequest("Each item can only appear once per document; merge the quantities")
        seen.add(line["item_id"])
        out.append((line["item_id"], line["quantity"], line.get("unit_cost", line.get("estimated_unit_cost"))))
    return out


def _req_line(item_id: int, quantity: int, cost) -> RequisitionLine:
    return RequisitionLine(
        item_id=item_id,
        quantity=quantity,
        estimated_unit_cost=Decimal(str(cost)) if cost is not None else None,
    )


def _po_lines(db: Session, lines: list[dict]) -> list[POLine]:
    from app.models import Item

    built = []
    for item_id, qty, cost in _line_tuples(lines):
        item = db.get(Item, item_id)
        if item is None or not item.is_active:
            raise BadRequest(f"Item {item_id} is not available")
        built.append(
            POLine(item_id=item.id, ordered_qty=qty, received_qty=0,
                   unit_cost=_unit_cost_for(Decimal(str(cost)) if cost is not None else None, item.unit_cost))
        )
    if not built:
        raise BadRequest("Add at least one line")
    return built


def _unit_cost_for(preferred, fallback) -> Decimal:
    if preferred is not None:
        return Decimal(str(preferred))
    return Decimal(str(fallback or 0))


def get_requisition_or_404(db: Session, req_id: int) -> Requisition:
    req = db.execute(select(Requisition).where(Requisition.id == req_id)).scalar_one_or_none()
    if req is None:
        raise NotFound("Requisition")
    return req


def get_po_or_404(db: Session, po_id: int) -> PurchaseOrder:
    po = db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id)).scalar_one_or_none()
    if po is None:
        raise NotFound("Purchase order")
    return po
