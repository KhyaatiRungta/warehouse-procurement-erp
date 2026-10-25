from app.db import SessionLocal
from app.models import StockLevel, StockMovement


def test_adjustment_and_issue_keep_ledger_consistent(client, world, headers):
    item = world["items"]["BOLT-1"]
    wh = world["wh"]
    h = headers("warehouse_clerk")

    up = client.post("/api/inventory/movements", json={"item_id": item, "warehouse_id": wh,
                     "movement_type": "ADJUSTMENT", "quantity": 5, "note": "Found in cage"}, headers=h)
    assert up.status_code == 201, up.text
    assert up.json()["balance_after"] == 55
    assert up.json()["reference"].startswith("ADJ-")

    issue = client.post("/api/inventory/movements", json={"item_id": item, "warehouse_id": wh,
                        "movement_type": "ISSUE", "quantity": 12, "note": "Line 3 build"}, headers=h)
    assert issue.status_code == 201
    assert issue.json()["quantity"] == -12
    assert issue.json()["balance_after"] == 43

    with SessionLocal() as db:
        row = db.query(StockLevel).filter_by(item_id=item, warehouse_id=wh).one()
        last = db.query(StockMovement).filter_by(item_id=item, warehouse_id=wh).order_by(StockMovement.id.desc()).first()
        assert row.on_hand == 43 == last.balance_after


def test_issue_beyond_stock_is_refused_and_leaves_balance(client, world, headers):
    item = world["items"]["GLOVE-1"]
    response = client.post("/api/inventory/movements", json={"item_id": item, "warehouse_id": world["wh"],
                           "movement_type": "ISSUE", "quantity": 10, "note": "Too many"}, headers=headers("warehouse_clerk"))
    assert response.status_code == 409
    assert "3 on hand" in response.json()["detail"]
    items = client.get("/api/items/%d" % item, headers=headers("buyer")).json()
    assert items["total_on_hand"] == 3


def test_buyer_cannot_post_stock_movements(client, world, headers):
    response = client.post("/api/inventory/movements", json={"item_id": world["items"]["BOLT-1"],
                           "warehouse_id": world["wh"], "movement_type": "ADJUSTMENT", "quantity": 1,
                           "note": "Should not"}, headers=headers("buyer"))
    assert response.status_code == 403


def test_reorder_alerts_list_items_at_or_below_point(client, world, headers):
    alerts = client.get("/api/alerts/reorder", headers=headers("buyer")).json()
    skus = {a["sku"]: a for a in alerts}
    assert "GLOVE-1" in skus
    assert "BOLT-1" not in skus
    glove = skus["GLOVE-1"]
    assert glove["total_on_hand"] == 3
    assert glove["suggested_qty"] == 5 + 10 - 3
    assert "CABLE-1" not in skus  # reorder point 0 never alerts


def test_items_list_low_filter(client, world, headers):
    low = client.get("/api/items?status=low", headers=headers("buyer")).json()
    assert [i["sku"] for i in low] == ["GLOVE-1"]
    assert low[0]["is_low"] is True


def test_inventory_movements_endpoint_filters(client, world, headers):
    rows = client.get(f"/api/inventory/movements?item_id={world['items']['BOLT-1']}", headers=headers("buyer")).json()
    assert rows and all(r["sku"] == "BOLT-1" for r in rows)
