import datetime as dt
from collections import defaultdict
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.db import get_db
from app.deps import get_current_user, require
from app.models import AuditLog, GoodsReceipt, Item, POStatus, PurchaseOrder, Requisition, RequisitionStatus, User
from app.views import money, on_order_map, po_summary, receipt_out, stock_map

router = APIRouter(prefix="/api", tags=["reports"])

SPEND_STATUSES = {
    POStatus.APPROVED.value,
    POStatus.SENT.value,
    POStatus.PARTIALLY_RECEIVED.value,
    POStatus.RECEIVED.value,
}


def _alerts(db: Session) -> list[dict]:
    stocks = stock_map(db)
    on_order = on_order_map(db)
    rows = []
    for item in db.execute(select(Item).where(Item.is_active.is_(True), Item.reorder_point > 0).order_by(Item.sku)).scalars():
        total = sum(s.on_hand for s in stocks.get(item.id, []))
        if total > item.reorder_point:
            continue
        incoming = on_order.get(item.id, 0)
        suggested = max(0, item.reorder_point + item.reorder_quantity - total - incoming)
        rows.append(
            {
                "item_id": item.id,
                "sku": item.sku,
                "name": item.name,
                "category": item.category,
                "uom": item.uom,
                "total_on_hand": total,
                "reorder_point": item.reorder_point,
                "reorder_quantity": item.reorder_quantity,
                "on_order": incoming,
                "suggested_qty": suggested,
                "covered_by_open_po": incoming > 0,
            }
        )
    rows.sort(key=lambda r: (r["total_on_hand"] - r["reorder_point"], r["sku"]))
    return rows


@router.get("/alerts/reorder")
def reorder_alerts(db: Session = Depends(get_db), _user: User = Depends(get_current_user)) -> list[dict]:
    return _alerts(db)


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db), _user: User = Depends(get_current_user)) -> dict:
    orders = (
        db.execute(
            select(PurchaseOrder)
            .options(joinedload(PurchaseOrder.lines), joinedload(PurchaseOrder.supplier), joinedload(PurchaseOrder.warehouse), joinedload(PurchaseOrder.requisition), joinedload(PurchaseOrder.created_by), joinedload(PurchaseOrder.approved_by))
            .order_by(PurchaseOrder.created_at.desc(), PurchaseOrder.id.desc())
        )
        .unique()
        .scalars()
        .all()
    )
    summaries = [po_summary(o) for o in orders]
    open_statuses = {s.value for s in (POStatus.SUBMITTED, POStatus.APPROVED, POStatus.SENT, POStatus.PARTIALLY_RECEIVED)}
    open_orders = [s for s in summaries if s["status"] in open_statuses]

    spend: dict[str, Decimal] = defaultdict(Decimal)
    for order in orders:
        if order.status in SPEND_STATUSES:
            spend[order.supplier.name] += sum((Decimal(l.ordered_qty) * Decimal(l.unit_cost) for l in order.lines), Decimal("0"))
    spend_rows = sorted(
        ({"supplier": name, "total": money(total)} for name, total in spend.items()),
        key=lambda r: r["total"],
        reverse=True,
    )[:6]

    week_ago = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=7)
    receipts = (
        db.execute(
            select(GoodsReceipt)
            .options(joinedload(GoodsReceipt.lines), joinedload(GoodsReceipt.purchase_order).joinedload(PurchaseOrder.supplier), joinedload(GoodsReceipt.warehouse), joinedload(GoodsReceipt.received_by))
            .order_by(GoodsReceipt.received_at.desc())
        )
        .unique()
        .scalars()
        .all()
    )
    receipts_week = [r for r in receipts if r.received_at >= week_ago]
    alerts = _alerts(db)

    return {
        "kpis": {
            "open_po_count": len(open_orders),
            "open_po_value": money(sum((Decimal(str(o["total_amount"])) for o in open_orders), Decimal("0"))),
            "pending_po_approvals": sum(1 for s in summaries if s["status"] == POStatus.SUBMITTED.value),
            "pending_requisitions": len(
                db.execute(select(Requisition.id).where(Requisition.status == RequisitionStatus.SUBMITTED.value)).all()
            ),
            "low_stock_items": len(alerts),
            "receipts_this_week": len(receipts_week),
            "units_received_this_week": sum(sum(l.quantity for l in r.lines) for r in receipts_week),
        },
        "spend_by_supplier": spend_rows,
        "recent_orders": summaries[:6],
        "recent_receipts": [receipt_out(r) for r in receipts[:5]],
        "alerts": alerts[:6],
    }


@router.get("/audit")
def audit_log(
    entity_type: str | None = None,
    entity_id: str | None = None,
    limit: int = Query(default=200, ge=1, le=1000),
    db: Session = Depends(get_db),
    _user: User = Depends(require("audit:read")),
) -> list[dict]:
    stmt = select(AuditLog).order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(limit)
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if entity_id:
        stmt = stmt.where(AuditLog.entity_id == entity_id)
    return [
        {
            "id": a.id,
            "actor_email": a.actor_email,
            "action": a.action,
            "entity_type": a.entity_type,
            "entity_id": a.entity_id,
            "summary": a.summary,
            "before": a.before,
            "after": a.after,
            "created_at": a.created_at,
        }
        for a in db.execute(stmt).scalars()
    ]
