import datetime as dt

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.db import get_db
from app.deps import get_current_user, require
from app.errors import NotFound
from app.models import GoodsReceipt, PurchaseOrder, User
from app.schemas import ReceiptIn
from app.services.receiving import ReceiptRequest, receive_goods
from app.views import receipt_out

router = APIRouter(prefix="/api/goods-receipts", tags=["goods receipts"])

RECEIPT_LOAD = (
    joinedload(GoodsReceipt.lines),
    joinedload(GoodsReceipt.purchase_order).joinedload(PurchaseOrder.supplier),
    joinedload(GoodsReceipt.warehouse),
    joinedload(GoodsReceipt.received_by),
)


def _load(db: Session, receipt_id: int) -> GoodsReceipt:
    receipt = db.execute(
        select(GoodsReceipt).where(GoodsReceipt.id == receipt_id).options(*RECEIPT_LOAD)
    ).unique().scalar_one_or_none()
    if receipt is None:
        raise NotFound("Goods receipt")
    return receipt


@router.get("")
def list_receipts(
    po_id: int | None = None,
    days: int | None = Query(default=None, ge=1, le=3650),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> list[dict]:
    stmt = select(GoodsReceipt).options(*RECEIPT_LOAD).order_by(GoodsReceipt.received_at.desc(), GoodsReceipt.id.desc())
    if po_id is not None:
        stmt = stmt.where(GoodsReceipt.po_id == po_id)
    if days is not None:
        since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)
        stmt = stmt.where(GoodsReceipt.received_at >= since)
    return [receipt_out(r) for r in db.execute(stmt).unique().scalars()]


@router.get("/{receipt_id}")
def get_receipt(receipt_id: int, db: Session = Depends(get_db), _user: User = Depends(get_current_user)) -> dict:
    return receipt_out(_load(db, receipt_id))


@router.post("", status_code=201)
def create_receipt(body: ReceiptIn, db: Session = Depends(get_db), user: User = Depends(require("receipts:write"))) -> dict:
    receipt = receive_goods(
        db,
        user,
        po_id=body.po_id,
        lines=[ReceiptRequest(l.po_line_id, l.quantity) for l in body.lines],
        notes=body.notes,
    )
    return receipt_out(_load(db, receipt.id))
