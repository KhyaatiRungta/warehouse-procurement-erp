from app.models import POStatus, RequisitionStatus


def _new_requisition(client, headers, world, lines=None):
    body = {
        "title": "Restock bolts",
        "notes": "Test",
        "lines": lines
        if lines is not None
        else [{"item_id": world["items"]["BOLT-1"], "quantity": 40, "unit_cost": 2.0}],
    }
    response = client.post("/api/requisitions", json=body, headers=headers("warehouse_clerk"))
    assert response.status_code == 201, response.text
    return response.json()


def test_requisition_flows_to_purchase_order(client, world, headers):
    req = _new_requisition(client, headers, world)
    assert req["status"] == "draft"
    assert req["number"].startswith("PR-")

    assert client.post(f"/api/requisitions/{req['id']}/submit", headers=headers("warehouse_clerk")).json()["status"] == "submitted"
    approved = client.post(f"/api/requisitions/{req['id']}/approve", json={"note": "ok"}, headers=headers("buyer"))
    assert approved.json()["status"] == "approved"

    converted = client.post(
        f"/api/requisitions/{req['id']}/convert",
        json={"supplier_id": world["supplier"], "warehouse_id": world["wh"]},
        headers=headers("buyer"),
    )
    assert converted.status_code == 200, converted.text
    body = converted.json()
    assert body["requisition"]["status"] == RequisitionStatus.CONVERTED.value
    assert body["requisition"]["purchase_order_number"].startswith("PO-")

    po = client.get(f"/api/purchase-orders/{body['purchase_order_id']}", headers=headers("buyer")).json()
    assert po["status"] == POStatus.DRAFT.value
    assert po["lines"][0]["ordered_qty"] == 40
    assert po["lines"][0]["unit_cost"] == 2.0
    assert po["total_amount"] == 80.0


def test_submitted_requisition_is_locked_for_editing(client, world, headers):
    req = _new_requisition(client, headers, world)
    client.post(f"/api/requisitions/{req['id']}/submit", headers=headers("warehouse_clerk"))
    response = client.patch(
        f"/api/requisitions/{req['id']}", json={"title": "Changed title"}, headers=headers("warehouse_clerk")
    )
    assert response.status_code == 409


def test_requisition_needs_a_line_to_submit(client, world, headers):
    req = _new_requisition(client, headers, world, lines=[])
    response = client.post(f"/api/requisitions/{req['id']}/submit", headers=headers("warehouse_clerk"))
    assert response.status_code == 422


def test_rejected_requisition_cannot_be_converted(client, world, headers):
    req = _new_requisition(client, headers, world)
    client.post(f"/api/requisitions/{req['id']}/submit", headers=headers("warehouse_clerk"))
    client.post(f"/api/requisitions/{req['id']}/reject", json={"note": "No"}, headers=headers("buyer"))
    response = client.post(
        f"/api/requisitions/{req['id']}/convert",
        json={"supplier_id": world["supplier"], "warehouse_id": world["wh"]},
        headers=headers("buyer"),
    )
    assert response.status_code == 409


def _draft_po(client, headers, world, qty=10):
    response = client.post(
        "/api/purchase-orders",
        json={"supplier_id": world["supplier"], "warehouse_id": world["wh"],
              "lines": [{"item_id": world["items"]["BOLT-1"], "quantity": qty}]},
        headers=headers("buyer"),
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_purchase_order_state_machine(client, world, headers):
    po = _draft_po(client, headers, world)
    assert po["number"].startswith("PO-")

    # Sending a draft skips approval, so it must be refused.
    assert client.post(f"/api/purchase-orders/{po['id']}/send", headers=headers("buyer")).status_code == 409

    assert client.post(f"/api/purchase-orders/{po['id']}/submit", headers=headers("buyer")).json()["status"] == "submitted"
    assert client.post(f"/api/purchase-orders/{po['id']}/approve", headers=headers("admin")).json()["status"] == "approved"
    sent = client.post(f"/api/purchase-orders/{po['id']}/send", headers=headers("buyer")).json()
    assert sent["status"] == "sent"
    assert sent["sent_at"] is not None


def test_draft_order_is_editable_but_sent_order_is_not(client, world, headers):
    po = _draft_po(client, headers, world)
    edited = client.patch(
        f"/api/purchase-orders/{po['id']}",
        json={"notes": "Expedite", "lines": [{"item_id": world["items"]["BOLT-1"], "quantity": 25}]},
        headers=headers("buyer"),
    )
    assert edited.status_code == 200
    assert edited.json()["lines"][0]["ordered_qty"] == 25

    client.post(f"/api/purchase-orders/{po['id']}/submit", headers=headers("buyer"))
    blocked = client.patch(f"/api/purchase-orders/{po['id']}", json={"notes": "late"}, headers=headers("buyer"))
    assert blocked.status_code == 409


def test_inactive_supplier_is_refused(client, world, headers):
    response = client.post(
        "/api/purchase-orders",
        json={"supplier_id": world["closed_supplier"], "warehouse_id": world["wh"],
              "lines": [{"item_id": world["items"]["BOLT-1"], "quantity": 1}]},
        headers=headers("buyer"),
    )
    assert response.status_code == 422
