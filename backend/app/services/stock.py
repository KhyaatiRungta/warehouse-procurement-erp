from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.errors import InsufficientStock
from app.models import Item, MovementType, StockLevel, StockMovement, User, Warehouse


def lock_stock_row(db: Session, item_id: int, warehouse_id: int) -> StockLevel:
    """Return the stock row for (item, warehouse) locked FOR UPDATE, creating it at zero if missing."""
    db.execute(
        pg_insert(StockLevel)
        .values(item_id=item_id, warehouse_id=warehouse_id, on_hand=0)
        .on_conflict_do_nothing(index_elements=["item_id", "warehouse_id"])
    )
    return db.execute(
        select(StockLevel)
        .where(StockLevel.item_id == item_id, StockLevel.warehouse_id == warehouse_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one()


def post_movement(
    db: Session,
    *,
    item: Item,
    warehouse: Warehouse,
    movement_type: MovementType,
    quantity_delta: int,
    reference_prefix: str,
    actor: User | None,
    note: str | None = None,
    reference: str | None = None,
) -> StockMovement:
    """Apply a signed quantity change to on-hand stock and append the ledger row.

    Runs inside the caller's transaction; the caller owns commit/rollback.
    """
    if quantity_delta == 0:
        raise ValueError("quantity_delta must be non-zero")

    row = lock_stock_row(db, item.id, warehouse.id)
    new_balance = row.on_hand + quantity_delta
    if new_balance < 0:
        raise InsufficientStock(item.sku, warehouse.code, row.on_hand, -quantity_delta)
    row.on_hand = new_balance

    movement = StockMovement(
        item_id=item.id,
        warehouse_id=warehouse.id,
        movement_type=movement_type.value,
        quantity=quantity_delta,
        balance_after=new_balance,
        reference=reference or "PENDING",
        note=note,
        created_by_id=actor.id if actor else None,
    )
    db.add(movement)
    db.flush()
    if reference is None:
        movement.reference = f"{reference_prefix}-{movement.id:06d}"
        db.flush()
    return movement


def total_on_hand(db: Session, item_id: int) -> int:
    rows = db.execute(select(StockLevel.on_hand).where(StockLevel.item_id == item_id)).scalars().all()
    return int(sum(rows))
