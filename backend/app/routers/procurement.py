from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.db import get_db
from app.deps import get_current_user, require
from app.errors import NotFound
from app.models import PurchaseOrder, Requisition, User
from app.schemas import ConvertIn, DecisionIn, POIn, POUpdate, RequisitionIn, RequisitionUpdate
from app.security import ROLE_PERMISSIONS
from app.services import procurement as svc
from app.views import po_out, po_summary, requisition_out

router = APIRouter(prefix="/api", tags=["procurement"])

REQ_LOAD = (joinedload(Requisition.lines), joinedload(Requisition.requester), joinedload(Requisition.decided_by))
PO_LOAD = (
    joinedload(PurchaseOrder.lines),
    joinedload(PurchaseOrder.supplier),
    joinedload(PurchaseOrder.warehouse),
    joinedload(PurchaseOrder.requisition),
    joinedload(PurchaseOrder.created_by),
    joinedload(PurchaseOrder.approved_by),
)


def _req_full(db: Session, req_id: int) -> dict:
    req = db.execute(select(Requisition).where(Requisition.id == req_id).options(*REQ_LOAD).execution_options(populate_existing=True)).unique().scalar_one()
    po_number = db.execute(select(PurchaseOrder.number).where(PurchaseOrder.requisition_id == req.id)).scalar_one_or_none()
    return requisition_out(req, po_number)


# ---------- requisitions ----------


@router.get("/requisitions")
def list_requisitions(
    status: str | None = None,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> list[dict]:
    stmt = select(Requisition).options(*REQ_LOAD).order_by(Requisition.created_at.desc(), Requisition.id.desc())
    if status:
        stmt = stmt.where(Requisition.status == status)
    reqs = db.execute(stmt).unique().scalars().all()
    po_numbers = dict(db.execute(select(PurchaseOrder.requisition_id, PurchaseOrder.number).where(PurchaseOrder.requisition_id.is_not(None))).all())
    return [requisition_out(r, po_numbers.get(r.id)) for r in reqs]


@router.get("/requisitions/{req_id}")
def get_requisition(req_id: int, db: Session = Depends(get_db), _user: User = Depends(get_current_user)) -> dict:
    return _req_full(db, svc.get_requisition_or_404(db, req_id).id)


@router.post("/requisitions", status_code=201)
def create_requisition(
    body: RequisitionIn,
    db: Session = Depends(get_db),
    user: User = Depends(require("requisitions:write")),
) -> dict:
    req = svc.create_requisition(
        db, user, title=body.title, needed_by=body.needed_by, notes=body.notes,
        lines=[l.model_dump() for l in body.lines],
    )
    return _req_full(db, req.id)


@router.patch("/requisitions/{req_id}")
def update_requisition(
    req_id: int,
    body: RequisitionUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require("requisitions:write")),
) -> dict:
    req = svc.get_requisition_or_404(db, req_id)
    changes = body.model_dump(exclude_unset=True)
    if "lines" in changes and changes["lines"] is not None:
        changes["lines"] = [l.model_dump() if hasattr(l, "model_dump") else l for l in body.lines or []]
    svc.update_requisition(db, user, req, changes)
    return _req_full(db, req_id)


@router.post("/requisitions/{req_id}/submit")
def submit_requisition(req_id: int, db: Session = Depends(get_db), user: User = Depends(require("requisitions:write"))) -> dict:
    req = svc.get_requisition_or_404(db, req_id)
    svc.submit_requisition(db, user, req)
    return _req_full(db, req_id)


@router.post("/requisitions/{req_id}/approve")
def approve_requisition(req_id: int, body: DecisionIn | None = None, db: Session = Depends(get_db), user: User = Depends(require("requisitions:decide"))) -> dict:
    req = svc.get_requisition_or_404(db, req_id)
    svc.decide_requisition(db, user, req, approve=True, note=body.note if body else None)
    return _req_full(db, req_id)


@router.post("/requisitions/{req_id}/reject")
def reject_requisition(req_id: int, body: DecisionIn | None = None, db: Session = Depends(get_db), user: User = Depends(require("requisitions:decide"))) -> dict:
    req = svc.get_requisition_or_404(db, req_id)
    svc.decide_requisition(db, user, req, approve=False, note=body.note if body else None)
    return _req_full(db, req_id)


@router.post("/requisitions/{req_id}/convert")
def convert_requisition(
    req_id: int,
    body: ConvertIn,
    db: Session = Depends(get_db),
    user: User = Depends(require("requisitions:decide")),
) -> dict:
    req = svc.get_requisition_or_404(db, req_id)
    po = svc.convert_requisition(
        db, user, req, supplier_id=body.supplier_id, warehouse_id=body.warehouse_id,
        expected_date=body.expected_date, notes=body.notes,
    )
    return {"requisition": _req_full(db, req_id), "purchase_order_id": po.id}


# ---------- purchase orders ----------


def _po_full(db: Session, po_id: int) -> dict:
    po = db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id).options(*PO_LOAD).execution_options(populate_existing=True)).unique().scalar_one()
    return po_out(po)


@router.get("/purchase-orders")
def list_purchase_orders(
    status: str | None = None,
    supplier_id: int | None = None,
    q: str | None = None,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> list[dict]:
    stmt = select(PurchaseOrder).options(*PO_LOAD).order_by(PurchaseOrder.created_at.desc(), PurchaseOrder.id.desc())
    if status:
        stmt = stmt.where(PurchaseOrder.status == status)
    if supplier_id is not None:
        stmt = stmt.where(PurchaseOrder.supplier_id == supplier_id)
    orders = db.execute(stmt).unique().scalars().all()
    if q:
        needle = q.lower()
        orders = [o for o in orders if needle in o.number.lower() or needle in o.supplier.name.lower()]
    return [po_summary(o) for o in orders]


@router.get("/purchase-orders/{po_id}")
def get_purchase_order(po_id: int, db: Session = Depends(get_db), _user: User = Depends(get_current_user)) -> dict:
    svc.get_po_or_404(db, po_id)
    return _po_full(db, po_id)


@router.post("/purchase-orders", status_code=201)
def create_purchase_order(body: POIn, db: Session = Depends(get_db), user: User = Depends(require("purchase_orders:write"))) -> dict:
    po = svc.create_purchase_order(
        db, user, supplier_id=body.supplier_id, warehouse_id=body.warehouse_id,
        expected_date=body.expected_date, notes=body.notes, lines=[l.model_dump() for l in body.lines],
    )
    return _po_full(db, po.id)


@router.patch("/purchase-orders/{po_id}")
def update_purchase_order(po_id: int, body: POUpdate, db: Session = Depends(get_db), user: User = Depends(require("purchase_orders:write"))) -> dict:
    po = svc.get_po_or_404(db, po_id)
    changes = body.model_dump(exclude_unset=True)
    if changes.get("lines") is not None:
        changes["lines"] = [l.model_dump() for l in body.lines or []]
    svc.update_purchase_order(db, user, po, changes)
    return _po_full(db, po_id)


@router.post("/purchase-orders/{po_id}/{action}")
def purchase_order_action(
    po_id: int,
    action: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    if action not in svc.PO_ACTIONS:
        raise NotFound(f"Action {action}")
    _, _, permission = svc.PO_ACTIONS[action]
    if permission not in ROLE_PERMISSIONS.get(user.role, frozenset()):
        raise HTTPException(status_code=403, detail=f"Your role ({user.role}) cannot {action} purchase orders")
    po = svc.get_po_or_404(db, po_id)
    svc.transition_purchase_order(db, user, po, action)
    return _po_full(db, po_id)
