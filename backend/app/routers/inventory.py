from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.db import get_db
from app.deps import get_current_user, require
from app.errors import BadRequest, NotFound
from app.models import Item, MovementType, StockMovement, User, Warehouse
from app.schemas import MovementIn, MovementOut
from app.services import audit
from app.services.stock import post_movement
from app.views import movement_out

router = APIRouter(prefix="/api/inventory", tags=["inventory"])


@router.get("/movements", response_model=list[MovementOut])
def list_movements(
    item_id: int | None = None,
    warehouse_id: int | None = None,
    movement_type: str | None = Query(default=None, pattern="^(RECEIPT|ADJUSTMENT|ISSUE)$"),
    limit: int = Query(default=200, ge=1, le=1000),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> list[dict]:
    stmt = (
        select(StockMovement)
        .options(joinedload(StockMovement.item), joinedload(StockMovement.warehouse), joinedload(StockMovement.created_by))
        .order_by(StockMovement.created_at.desc(), StockMovement.id.desc())
        .limit(limit)
    )
    if item_id is not None:
        stmt = stmt.where(StockMovement.item_id == item_id)
    if warehouse_id is not None:
        stmt = stmt.where(StockMovement.warehouse_id == warehouse_id)
    if movement_type:
        stmt = stmt.where(StockMovement.movement_type == movement_type)
    return [movement_out(m) for m in db.execute(stmt).scalars().unique()]


@router.post("/movements", response_model=MovementOut, status_code=201)
def post_manual_movement(
    body: MovementIn,
    db: Session = Depends(get_db),
    user: User = Depends(require("inventory:write")),
) -> dict:
    item = db.get(Item, body.item_id)
    if item is None:
        raise NotFound("Item")
    warehouse = db.get(Warehouse, body.warehouse_id)
    if warehouse is None:
        raise NotFound("Warehouse")

    if body.movement_type == MovementType.ISSUE.value:
        if body.quantity < 0:
            raise BadRequest("Issues remove stock, so enter a positive quantity")
        delta = -body.quantity
        prefix = "ISS"
        movement_type = MovementType.ISSUE
    else:
        delta = body.quantity
        prefix = "ADJ"
        movement_type = MovementType.ADJUSTMENT

    try:
        movement = post_movement(
            db, item=item, warehouse=warehouse, movement_type=movement_type, quantity_delta=delta,
            reference_prefix=prefix, actor=user, note=body.note,
        )
        audit.record(
            db, user, action=f"inventory.{movement_type.value.lower()}", entity_type="item", entity_id=item.id,
            summary=f"{movement.reference}: {delta:+d} {item.sku} at {warehouse.code}",
            after={"reference": movement.reference, "quantity": delta, "balance_after": movement.balance_after},
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(movement)
    movement = db.execute(
        select(StockMovement)
        .where(StockMovement.id == movement.id)
        .options(joinedload(StockMovement.item), joinedload(StockMovement.warehouse), joinedload(StockMovement.created_by))
    ).scalar_one()
    return movement_out(movement)

