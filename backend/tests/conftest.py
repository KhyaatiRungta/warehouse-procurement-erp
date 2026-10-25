"""Test fixtures. Every test runs against a real PostgreSQL database (never the dev one)."""

import os

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "postgresql+psycopg://localhost:5432/warehouse_erp_test")
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ["SEED_DEMO"] = "false"

from decimal import Decimal  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.db import SessionLocal, create_schema, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base, Item, MovementType, Supplier, User, Warehouse  # noqa: E402
from app.security import hash_password  # noqa: E402
from app.services.stock import post_movement  # noqa: E402

PASSWORD = "test-pass-123"
TABLES = ", ".join(t.name for t in Base.metadata.sorted_tables)


@pytest.fixture(scope="session", autouse=True)
def schema():
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    create_schema()
    yield


@pytest.fixture(autouse=True)
def clean_tables():
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {TABLES} RESTART IDENTITY CASCADE"))
    yield


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def world():
    """Users, suppliers, warehouses, items and opening stock. Returns plain ids and emails."""
    with SessionLocal() as db:
        users = {}
        for role in ("admin", "buyer", "warehouse_clerk"):
            user = User(
                email=f"{role}@warehouse-tests.com", full_name=role.title(), role=role,
                password_hash=hash_password(PASSWORD), is_active=True,
            )
            db.add(user)
            users[role] = user
        supplier = Supplier(code="SUP-1", name="Test Supplier", lead_time_days=5, is_active=True)
        closed = Supplier(code="SUP-OFF", name="Closed Supplier", lead_time_days=5, is_active=False)
        main = Warehouse(code="WH-1", name="Main", location="Test", is_active=True)
        second = Warehouse(code="WH-2", name="Second", location="Test", is_active=True)
        items = {
            "BOLT-1": Item(sku="BOLT-1", name="Bolt", category="Fasteners", uom="EA", reorder_point=10,
                           reorder_quantity=20, unit_cost=Decimal("2.50"), is_active=True),
            "CABLE-1": Item(sku="CABLE-1", name="Cable", category="Electrical", uom="RL", reorder_point=0,
                            reorder_quantity=0, unit_cost=Decimal("40.00"), is_active=True),
            "GLOVE-1": Item(sku="GLOVE-1", name="Gloves", category="PPE", uom="BOX", reorder_point=5,
                            reorder_quantity=10, unit_cost=Decimal("9.00"), is_active=True),
        }
        db.add_all([supplier, closed, main, second, *items.values()])
        db.commit()

        actor = users["admin"]
        db.refresh(actor)
        opening = {
            ("BOLT-1", "WH-1"): 50,
            ("GLOVE-1", "WH-1"): 3,
        }
        for (sku, code), qty in opening.items():
            post_movement(
                db, item=items[sku], warehouse=main if code == "WH-1" else second,
                movement_type=MovementType.ADJUSTMENT, quantity_delta=qty,
                reference_prefix="ADJ", actor=actor, note="Test opening balance",
            )
        db.commit()

        result = {
            "users": {role: {"id": u.id, "email": u.email} for role, u in users.items()},
            "supplier": supplier.id,
            "closed_supplier": closed.id,
            "wh": main.id,
            "wh2": second.id,
            "items": {sku: item.id for sku, item in items.items()},
        }
        return result


def login(client: TestClient, email: str) -> dict:
    response = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture
def headers(client, world):
    def for_role(role: str) -> dict:
        return login(client, world["users"][role]["email"])

    return for_role
