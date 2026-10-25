def test_supplier_crud_and_duplicate_code(client, world, headers):
    h = headers("buyer")
    created = client.post("/api/suppliers", json={"code": "ACME-9", "name": "Acme Fixings", "lead_time_days": 9,
                          "email": "sales@acme-fixings.com"}, headers=h)
    assert created.status_code == 201, created.text
    supplier_id = created.json()["id"]

    dup = client.post("/api/suppliers", json={"code": "ACME-9", "name": "Other"}, headers=h)
    assert dup.status_code == 409

    updated = client.patch(f"/api/suppliers/{supplier_id}", json={"is_active": False, "lead_time_days": 12}, headers=h)
    assert updated.status_code == 200
    assert updated.json()["is_active"] is False
    assert updated.json()["lead_time_days"] == 12


def test_supplier_validation_rejects_bad_input(client, world, headers):
    response = client.post("/api/suppliers", json={"code": "x y", "name": "A", "lead_time_days": -1}, headers=headers("buyer"))
    assert response.status_code == 422


def test_item_create_and_price_precision(client, world, headers):
    response = client.post("/api/items", json={"sku": "NEW-1", "name": "New item", "category": "Test",
                           "uom": "EA", "reorder_point": 2, "reorder_quantity": 4, "unit_cost": 12.345},
                           headers=headers("buyer"))
    assert response.status_code == 201, response.text
    assert response.json()["sku"] == "NEW-1"
    assert client.post("/api/items", json={"sku": "NEW-1", "name": "Dup", "category": "Test"}, headers=headers("buyer")).status_code == 409


def test_dashboard_reports_kpis(client, world, headers):
    body = client.get("/api/dashboard", headers=headers("buyer")).json()
    assert set(body) >= {"kpis", "spend_by_supplier", "recent_orders", "recent_receipts", "alerts"}
    assert body["kpis"]["low_stock_items"] == 1


def test_audit_trail_records_mutations(client, world, headers):
    client.post("/api/suppliers", json={"code": "AUD-1", "name": "Audited Supplier"}, headers=headers("buyer"))
    rows = client.get("/api/audit?entity_type=supplier", headers=headers("buyer")).json()
    assert rows
    entry = rows[0]
    assert entry["action"] == "supplier.create"
    assert entry["actor_email"] == "buyer@warehouse-tests.com"
    assert entry["after"]["code"] == "AUD-1"


def test_health_is_public(client):
    assert client.get("/api/health").json() == {"status": "ok"}
