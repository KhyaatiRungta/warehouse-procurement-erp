import datetime as dt
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class Strict(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


# ---------- auth ----------


class LoginIn(Strict):
    # Plain string on purpose: the demo accounts use the reserved .test domain, which EmailStr rejects.
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=1, max_length=200)


class UserOut(BaseModel):
    id: int
    email: str
    full_name: str
    role: str
    permissions: list[str]


class TokenOut(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    user: UserOut


# ---------- suppliers ----------


class SupplierIn(Strict):
    code: str = Field(min_length=2, max_length=20, pattern=r"^[A-Za-z0-9-]+$")
    name: str = Field(min_length=2, max_length=160)
    contact_name: str | None = Field(default=None, max_length=120)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=40)
    address: str | None = Field(default=None, max_length=1000)
    payment_terms: str | None = Field(default=None, max_length=60)
    lead_time_days: int = Field(default=7, ge=0, le=365)
    is_active: bool = True


class SupplierUpdate(Strict):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    contact_name: str | None = Field(default=None, max_length=120)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=40)
    address: str | None = Field(default=None, max_length=1000)
    payment_terms: str | None = Field(default=None, max_length=60)
    lead_time_days: int | None = Field(default=None, ge=0, le=365)
    is_active: bool | None = None


class SupplierOut(BaseModel):
    id: int
    code: str
    name: str
    contact_name: str | None
    email: str | None
    phone: str | None
    address: str | None
    payment_terms: str | None
    lead_time_days: int
    is_active: bool
    open_po_count: int = 0
    open_po_value: float = 0


# ---------- items, warehouses, stock ----------


class ItemIn(Strict):
    sku: str = Field(min_length=2, max_length=40, pattern=r"^[A-Za-z0-9-_./]+$")
    name: str = Field(min_length=2, max_length=160)
    description: str | None = Field(default=None, max_length=1000)
    category: str = Field(min_length=2, max_length=60)
    uom: str = Field(default="EA", min_length=1, max_length=12)
    reorder_point: int = Field(default=0, ge=0)
    reorder_quantity: int = Field(default=0, ge=0)
    unit_cost: float = Field(default=0, ge=0)
    preferred_supplier_id: int | None = None
    is_active: bool = True


class ItemUpdate(Strict):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    description: str | None = Field(default=None, max_length=1000)
    category: str | None = Field(default=None, min_length=2, max_length=60)
    uom: str | None = Field(default=None, min_length=1, max_length=12)
    reorder_point: int | None = Field(default=None, ge=0)
    reorder_quantity: int | None = Field(default=None, ge=0)
    unit_cost: float | None = Field(default=None, ge=0)
    preferred_supplier_id: int | None = None
    is_active: bool | None = None


class StockByWarehouse(BaseModel):
    warehouse_id: int
    warehouse_code: str
    on_hand: int


class ItemOut(BaseModel):
    id: int
    sku: str
    name: str
    description: str | None
    category: str
    uom: str
    reorder_point: int
    reorder_quantity: int
    unit_cost: float
    preferred_supplier_id: int | None
    preferred_supplier_name: str | None
    is_active: bool
    total_on_hand: int
    on_order: int
    is_low: bool
    stock: list[StockByWarehouse] = []


class WarehouseIn(Strict):
    code: str = Field(min_length=2, max_length=20, pattern=r"^[A-Za-z0-9-]+$")
    name: str = Field(min_length=2, max_length=120)
    location: str | None = Field(default=None, max_length=160)
    is_active: bool = True


class WarehouseUpdate(Strict):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    location: str | None = Field(default=None, max_length=160)
    is_active: bool | None = None


class WarehouseOut(BaseModel):
    id: int
    code: str
    name: str
    location: str | None
    is_active: bool


class MovementIn(Strict):
    item_id: int
    warehouse_id: int
    movement_type: Literal["ADJUSTMENT", "ISSUE"]
    quantity: int = Field(description="Adjustments may be negative; issues are positive")
    note: str = Field(min_length=3, max_length=255)

    @field_validator("quantity")
    @classmethod
    def non_zero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("Quantity cannot be zero")
        return value


class MovementOut(BaseModel):
    id: int
    item_id: int
    sku: str
    item_name: str
    warehouse_id: int
    warehouse_code: str
    movement_type: str
    quantity: int
    balance_after: int
    reference: str
    note: str | None
    created_by: str | None
    created_at: dt.datetime


# ---------- requisitions ----------


class LineIn(Strict):
    item_id: int
    quantity: int = Field(gt=0, le=1_000_000)
    unit_cost: float | None = Field(default=None, ge=0)


class RequisitionIn(Strict):
    title: str = Field(min_length=3, max_length=160)
    needed_by: dt.date | None = None
    notes: str | None = Field(default=None, max_length=1000)
    lines: list[LineIn] = Field(default_factory=list)


class RequisitionUpdate(Strict):
    title: str | None = Field(default=None, min_length=3, max_length=160)
    needed_by: dt.date | None = None
    notes: str | None = Field(default=None, max_length=1000)
    lines: list[LineIn] | None = None


class DecisionIn(Strict):
    note: str | None = Field(default=None, max_length=500)


class ConvertIn(Strict):
    supplier_id: int
    warehouse_id: int
    expected_date: dt.date | None = None
    notes: str | None = Field(default=None, max_length=1000)


# ---------- purchase orders ----------


class POIn(Strict):
    supplier_id: int
    warehouse_id: int
    expected_date: dt.date | None = None
    notes: str | None = Field(default=None, max_length=1000)
    lines: list[LineIn] = Field(min_length=1)


class POUpdate(Strict):
    supplier_id: int | None = None
    warehouse_id: int | None = None
    expected_date: dt.date | None = None
    notes: str | None = Field(default=None, max_length=1000)
    lines: list[LineIn] | None = None


# ---------- goods receipts ----------


class ReceiptLineIn(Strict):
    po_line_id: int
    quantity: int = Field(gt=0, le=1_000_000)


class ReceiptIn(Strict):
    po_id: int
    notes: str | None = Field(default=None, max_length=500)
    lines: list[ReceiptLineIn] = Field(min_length=1)
