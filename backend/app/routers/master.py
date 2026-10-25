"""Suppliers, items and warehouses: the master data the procurement flow depends on."""

from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, require
from app.errors import Conflict, NotFound
from app.models import OPEN_PO_STATUSES, Item, POLine, PurchaseOrder, Supplier, User, Warehouse
from app.schemas import ItemIn, ItemUpdate, SupplierIn, SupplierUpdate, WarehouseIn, WarehouseOut, WarehouseUpdate
from app.services import audit
from app.views import item_out, on_order_map, stock_map, supplier_out, money

router = APIRouter(prefix="/api", tags=["master data"])


def _supplier_or_404(db: Session, supplier_id: int) -> Supplier:
    supplier = db.get(Supplier, supplier_id)
    if supplier is None:
        raise NotFound("Supplier")
    return supplier


def _open_po_totals(db: Session) -> dict[int, tuple[int, Decimal]]:
    rows = db.execute(
        select(
            PurchaseOrder.supplier_id,
            func.count(func.distinct(PurchaseOrder.id)),
            func.coalesce(func.sum(POLine.ordered_qty * POLine.unit_cost), 0),
        )
        .join(POLine, POLine.po_id == PurchaseOrder.id)
        .where(PurchaseOrder.status.in_([s.value for s in OPEN_PO_STATUSES]))
        .group_by(PurchaseOrder.supplier_id)
    ).all()
    return {sid: (int(count), Decimal(value)) for sid, count, value in rows}


# ---------- suppliers ----------


@router.get("/suppliers")
def list_suppliers(
    q: str | None = None,
    active: bool | None = None,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> list[dict]:
    stmt = select(Supplier).order_by(Supplier.name)
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(or_(Supplier.name.ilike(pattern), Supplier.code.ilike(pattern), Supplier.contact_name.ilike(pattern)))
    if active is not None:
        stmt = stmt.where(Supplier.is_active == active)
    totals = _open_po_totals(db)
    return [
        supplier_out(s, *totals.get(s.id, (0, Decimal("0"))))
        for s in db.execute(stmt).scalars()
    ]


@router.get("/suppliers/{supplier_id}")
def get_supplier(supplier_id: int, db: Session = Depends(get_db), _user: User = Depends(get_current_user)) -> dict:
    supplier = _supplier_or_404(db, supplier_id)
    count, value = _open_po_totals(db).get(supplier.id, (0, Decimal("0")))
    return supplier_out(supplier, count, value)


@router.post("/suppliers", status_code=201)
def create_supplier(
    body: SupplierIn,
    db: Session = Depends(get_db),
    user: User = Depends(require("suppliers:write")),
) -> dict:
    if db.execute(select(Supplier.id).where(Supplier.code == body.code)).first():
        raise Conflict(f"Supplier code {body.code} is already in use")
    supplier = Supplier(**body.model_dump(exclude={"email"}), email=str(body.email) if body.email else None)
    db.add(supplier)
    db.flush()
    audit.record(db, user, action="supplier.create", entity_type="supplier", entity_id=supplier.id,
                 summary=f"Created supplier {supplier.name}", after=_supplier_snapshot(supplier))
    db.commit()
    return supplier_out(supplier)


@router.patch("/suppliers/{supplier_id}")
def update_supplier(
    supplier_id: int,
    body: SupplierUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require("suppliers:write")),
) -> dict:
    supplier = _supplier_or_404(db, supplier_id)
    before = _supplier_snapshot(supplier)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(supplier, field, str(value) if field == "email" and value else value)
    db.flush()
    audit.record(db, user, action="supplier.update", entity_type="supplier", entity_id=supplier.id,
                 summary=f"Updated supplier {supplier.name}", before=before, after=_supplier_snapshot(supplier))
    db.commit()
    count, value = _open_po_totals(db).get(supplier.id, (0, Decimal("0")))
    return supplier_out(supplier, count, value)


def _supplier_snapshot(s: Supplier) -> dict:
    return {"code": s.code, "name": s.name, "contact_name": s.contact_name, "email": s.email,
            "lead_time_days": s.lead_time_days, "payment_terms": s.payment_terms, "is_active": s.is_active}


# ---------- warehouses ----------


@router.get("/warehouses", response_model=list[WarehouseOut])
def list_warehouses(db: Session = Depends(get_db), _user: User = Depends(get_current_user)) -> list[Warehouse]:
    return list(db.execute(select(Warehouse).order_by(Warehouse.code)).scalars())


@router.post("/warehouses", response_model=WarehouseOut, status_code=201)
def create_warehouse(
    body: WarehouseIn,
    db: Session = Depends(get_db),
    user: User = Depends(require("warehouses:write")),
) -> Warehouse:
    if db.execute(select(Warehouse.id).where(Warehouse.code == body.code)).first():
        raise Conflict(f"Warehouse code {body.code} is already in use")
    warehouse = Warehouse(**body.model_dump())
    db.add(warehouse)
    db.flush()
    audit.record(db, user, action="warehouse.create", entity_type="warehouse", entity_id=warehouse.id,
                 summary=f"Created warehouse {warehouse.code}", after={"code": warehouse.code, "name": warehouse.name})
    db.commit()
    return warehouse


@router.patch("/warehouses/{warehouse_id}", response_model=WarehouseOut)
def update_warehouse(
    warehouse_id: int,
    body: WarehouseUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require("warehouses:write")),
) -> Warehouse:
    warehouse = db.get(Warehouse, warehouse_id)
    if warehouse is None:
        raise NotFound("Warehouse")
    before = {"name": warehouse.name, "location": warehouse.location, "is_active": warehouse.is_active}
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(warehouse, field, value)
    audit.record(db, user, action="warehouse.update", entity_type="warehouse", entity_id=warehouse.id,
                 summary=f"Updated warehouse {warehouse.code}", before=before,
                 after={"name": warehouse.name, "location": warehouse.location, "is_active": warehouse.is_active})
    db.commit()
    return warehouse


# ---------- items ----------


@router.get("/items")
def list_items(
    q: str | None = None,
    category: str | None = None,
    status: str | None = Query(default=None, pattern="^(low|ok|inactive)$"),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> list[dict]:
    stmt = select(Item).order_by(Item.sku)
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(or_(Item.sku.ilike(pattern), Item.name.ilike(pattern), Item.description.ilike(pattern)))
    if category:
        stmt = stmt.where(Item.category == category)
    if status == "inactive":
        stmt = stmt.where(Item.is_active.is_(False))
    items = list(db.execute(stmt).scalars())
    stocks = stock_map(db)
    on_order = on_order_map(db)
    codes = {w.id: w.code for w in db.execute(select(Warehouse)).scalars()}
    rows = [item_out(i, stocks.get(i.id, []), on_order.get(i.id, 0), codes) for i in items]
    if status == "low":
        rows = [r for r in rows if r["is_low"]]
    elif status == "ok":
        rows = [r for r in rows if not r["is_low"] and r["is_active"]]
    return rows


@router.get("/items/categories")
def item_categories(db: Session = Depends(get_db), _user: User = Depends(get_current_user)) -> list[str]:
    return list(db.execute(select(Item.category).distinct().order_by(Item.category)).scalars())


@router.get("/items/{item_id}")
def get_item(item_id: int, db: Session = Depends(get_db), _user: User = Depends(get_current_user)) -> dict:
    item = db.get(Item, item_id)
    if item is None:
        raise NotFound("Item")
    codes = {w.id: w.code for w in db.execute(select(Warehouse)).scalars()}
    return item_out(item, stock_map(db).get(item.id, []), on_order_map(db).get(item.id, 0), codes)


@router.post("/items", status_code=201)
def create_item(body: ItemIn, db: Session = Depends(get_db), user: User = Depends(require("items:write"))) -> dict:
    if db.execute(select(Item.id).where(Item.sku == body.sku)).first():
        raise Conflict(f"SKU {body.sku} already exists")
    if body.preferred_supplier_id is not None:
        _supplier_or_404(db, body.preferred_supplier_id)
    data = body.model_dump()
    data["unit_cost"] = Decimal(str(body.unit_cost))
    item = Item(**data)
    db.add(item)
    db.flush()
    audit.record(db, user, action="item.create", entity_type="item", entity_id=item.id,
                 summary=f"Created item {item.sku}", after={"sku": item.sku, "reorder_point": item.reorder_point})
    db.commit()
    return get_item(item.id, db, user)


@router.patch("/items/{item_id}")
def update_item(item_id: int, body: ItemUpdate, db: Session = Depends(get_db), user: User = Depends(require("items:write"))) -> dict:
    item = db.get(Item, item_id)
    if item is None:
        raise NotFound("Item")
    before = {"reorder_point": item.reorder_point, "reorder_quantity": item.reorder_quantity,
              "unit_cost": money(item.unit_cost), "is_active": item.is_active}
    changes = body.model_dump(exclude_unset=True)
    if changes.get("preferred_supplier_id") is not None:
        _supplier_or_404(db, changes["preferred_supplier_id"])
    if "unit_cost" in changes and changes["unit_cost"] is not None:
        changes["unit_cost"] = Decimal(str(changes["unit_cost"]))
    for field, value in changes.items():
        setattr(item, field, value)
    db.flush()
    audit.record(db, user, action="item.update", entity_type="item", entity_id=item.id,
                 summary=f"Updated item {item.sku}", before=before,
                 after={"reorder_point": item.reorder_point, "reorder_quantity": item.reorder_quantity,
                        "unit_cost": money(item.unit_cost), "is_active": item.is_active})
    db.commit()
    return get_item(item.id, db, user)
