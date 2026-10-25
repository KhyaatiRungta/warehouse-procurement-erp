from tests.conftest import PASSWORD


def test_login_returns_token_and_permissions(client, world):
    response = client.post("/api/auth/login", json={"email": "buyer@warehouse-tests.com", "password": PASSWORD})
    assert response.status_code == 200
    body = response.json()
    assert body["user"]["role"] == "buyer"
    assert "purchase_orders:write" in body["user"]["permissions"]
    assert "purchase_orders:approve" not in body["user"]["permissions"]


def test_wrong_password_is_rejected(client, world):
    response = client.post("/api/auth/login", json={"email": "buyer@warehouse-tests.com", "password": "nope"})
    assert response.status_code == 401


def test_protected_routes_need_a_token(client, world):
    assert client.get("/api/suppliers").status_code == 401
    assert client.get("/api/auth/me").status_code == 401


def test_clerk_cannot_manage_suppliers(client, world, headers):
    response = client.post(
        "/api/suppliers",
        json={"code": "NEW-1", "name": "New Supplier"},
        headers=headers("warehouse_clerk"),
    )
    assert response.status_code == 403


def test_buyer_cannot_approve_purchase_orders(client, world, headers):
    created = client.post(
        "/api/purchase-orders",
        json={"supplier_id": world["supplier"], "warehouse_id": world["wh"],
              "lines": [{"item_id": world["items"]["BOLT-1"], "quantity": 5}]},
        headers=headers("buyer"),
    ).json()
    client.post(f"/api/purchase-orders/{created['id']}/submit", headers=headers("buyer"))
    response = client.post(f"/api/purchase-orders/{created['id']}/approve", headers=headers("buyer"))
    assert response.status_code == 403


def test_clerk_can_receive_but_not_read_audit(client, world, headers):
    assert client.get("/api/audit", headers=headers("warehouse_clerk")).status_code == 403
    assert client.get("/api/audit", headers=headers("buyer")).status_code == 200
