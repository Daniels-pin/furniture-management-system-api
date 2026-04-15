"""Integration tests against the FastAPI app with an isolated in-memory DB (see conftest.py)."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from decimal import Decimal


def test_home(client):
    response = client.get("/")
    assert response.status_code == 200


def test_login(client):
    response = client.post(
        "/auth/login",
        json={"email": "admin@company.com", "password": "admin123"},
    )
    assert response.status_code == 200
    body = response.json()
    assert "access_token" in body
    assert body.get("token_type") == "bearer"


def test_create_user(client, admin_token):
    username = f"testuser_{uuid.uuid4().hex[:8]}@mail.com"
    response = client.post(
        "/users",
        json={"username": username, "password": "123456", "role": "showroom"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["username"] == username
    assert response.json()["role"] == "showroom"


def test_create_customer(client, admin_token):
    response = client.post(
        "/customers",
        json={
            "name": "John Doe",
            "phone": "08012345678",
            "address": "Abuja",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["name"] == "John Doe"


def test_create_product(client, admin_token):
    response = client.post(
        "/products",
        json={"name": "Chair", "price": 15000},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["name"] == "Chair"


def test_create_order(client, admin_token):
    response = client.post(
        "/orders/json",
        json={
            "customer": {
                "name": "Order Customer",
                "phone": "08011112222",
                "address": "Lagos",
            },
            "items": [
                {
                    "item_name": "Sofa",
                    "description": "Fabric",
                    "quantity": 1,
                    "amount": "500.00",
                }
            ],
            "due_date": "2026-04-10T00:00:00",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert "id" in data
    assert data.get("status") == "pending"


def test_get_orders(client, admin_token):
    response = client.get(
        "/orders",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert "data" in body
    assert isinstance(body["data"], list)
    assert "total" in body


def test_update_status(client, admin_token):
    order_res = client.post(
        "/orders/json",
        json={
            "customer": {
                "name": "Status Customer",
                "phone": "08033334444",
                "address": "Enugu",
            },
            "items": [
                {
                    "item_name": "Table",
                    "description": "Oak",
                    "quantity": 2,
                    "amount": "50.00",
                }
            ],
            "due_date": "2026-04-10T00:00:00",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert order_res.status_code == 200, order_res.text
    order_id = order_res.json()["id"]

    response = client.patch(
        f"/orders/{order_id}/status",
        data={"status": "in_progress"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert response.status_code == 200, response.text


def test_reminders(client, admin_token):
    due_date = (datetime.utcnow() + timedelta(days=5)).isoformat()
    create = client.post(
        "/orders/json",
        json={
            "customer": {
                "name": "Reminder Customer",
                "phone": "08055556666",
                "address": "Port Harcourt",
            },
            "items": [
                {
                    "item_name": "Bed",
                    "description": "Queen",
                    "quantity": 1,
                    "amount": "200.00",
                }
            ],
            "due_date": due_date,
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert create.status_code == 200, create.text

    response = client.get(
        "/orders/reminders",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert response.status_code == 200, response.text
    assert isinstance(response.json(), list)


def test_impersonation_flow(client, admin_token):
    username = f"imp_target_{uuid.uuid4().hex[:8]}@mail.com"
    r = client.post(
        "/users",
        json={"username": username, "password": "secret123", "role": "showroom"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200, r.text
    uid = r.json()["id"]

    r_imp = client.post(
        f"/admin/impersonate/{uid}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r_imp.status_code == 200, r_imp.text
    body = r_imp.json()
    assert body.get("token_type") == "bearer"
    assert "access_token" in body and "restore_token" in body

    r_stop = client.post(
        "/admin/stop-impersonation",
        json={"restore_token": body["restore_token"]},
        headers={"Authorization": f"Bearer {body['access_token']}"},
    )
    assert r_stop.status_code == 200, r_stop.text
    admin_back = r_stop.json()["access_token"]

    r_users = client.get("/users", headers={"Authorization": f"Bearer {admin_back}"})
    assert r_users.status_code == 200, r_users.text


def test_inventory_crud_and_movements(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    create = client.post(
        "/inventory",
        json={
            "material_name": "Oak veneer",
            "category": "Wood",
            "tracking_mode": "numeric",
            "quantity": "10",
            "unit": "sheets",
            "stock_level": "low",
            "supplier_name": "Lumber Co",
            "cost": "120.50",
        },
        headers=headers,
    )
    assert create.status_code == 200, create.text
    mid = create.json()["id"]
    assert create.json()["stock_level"] == "low"
    assert create.json()["tracking_mode"] == "numeric"

    mov = client.post(
        f"/inventory/{mid}/movements",
        json={"action": "used", "quantity_delta": "-1"},
        headers=headers,
    )
    assert mov.status_code == 200, mov.text

    low = client.get("/inventory/low-stock-count", headers=headers)
    assert low.status_code == 200
    assert low.json()["count"] >= 1

    mlist = client.get("/inventory/movements", headers=headers)
    assert mlist.status_code == 200
    assert len(mlist.json()) >= 2

    upd = client.put(
        f"/inventory/{mid}",
        json={"stock_level": "full"},
        headers=headers,
    )
    assert upd.status_code == 200, upd.text
    assert upd.json()["stock_level"] == "full"


def test_inventory_payments_and_financial_summary(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    create = client.post(
        "/inventory",
        json={
            "material_name": "Plywood",
            "tracking_mode": "numeric",
            "quantity": "5",
            "unit": "sheets",
            "stock_level": "medium",
            "supplier_name": "BuildMart",
            "cost": "200.00",
        },
        headers=headers,
    )
    assert create.status_code == 200, create.text
    mid = create.json()["id"]
    assert create.json()["amount_paid"] in ("0", "0.00", 0)
    assert create.json()["payment_status"] == "unpaid"

    pay = client.post(
        f"/inventory/{mid}/payments",
        json={"amount": "80.00", "paid_at": "2026-04-01T12:00:00"},
        headers=headers,
    )
    assert pay.status_code == 200, pay.text

    detail = client.get(f"/inventory/{mid}/payments", headers=headers)
    assert detail.status_code == 200
    assert len(detail.json()) == 1

    lst = client.get("/inventory", headers=headers)
    assert lst.status_code == 200
    row = next(x for x in lst.json() if x["id"] == mid)
    assert row["payment_status"] == "partial"
    assert row["balance"] in ("120.00", 120, "120")

    summ = client.get("/inventory/financial-summary", headers=headers)
    assert summ.status_code == 200
    body = summ.json()
    assert body["total_cost"] in ("200.00", 200, "200")
    assert body["total_paid"] in ("80.00", 80, "80")

    sup = client.get("/inventory/supplier-financials", headers=headers)
    assert sup.status_code == 200
    assert any(s["supplier_name"] == "BuildMart" for s in sup.json())


def test_inventory_financial_summary_factory_forbidden(client, admin_token):
    username = f"fc_inv_{uuid.uuid4().hex[:8]}@mail.com"
    client.post(
        "/users",
        json={"username": username, "password": "pw123456", "role": "factory"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    lr = client.post("/auth/login", json={"email": username, "password": "pw123456"})
    assert lr.status_code == 200
    tok = lr.json()["access_token"]
    denied = client.get("/inventory/financial-summary", headers={"Authorization": f"Bearer {tok}"})
    assert denied.status_code == 403


def test_inventory_showroom_forbidden(client, admin_token):
    username = f"sw_inv_{uuid.uuid4().hex[:8]}@mail.com"
    client.post(
        "/users",
        json={"username": username, "password": "pw123456", "role": "showroom"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    lr = client.post("/auth/login", json={"email": username, "password": "pw123456"})
    assert lr.status_code == 200
    tok = lr.json()["access_token"]
    denied = client.get("/inventory", headers={"Authorization": f"Bearer {tok}"})
    assert denied.status_code == 403


def test_impersonation_forbidden_for_non_admin(client, admin_token):
    username = f"sw_{uuid.uuid4().hex[:8]}@mail.com"
    r = client.post(
        "/users",
        json={"username": username, "password": "pw", "role": "showroom"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200, r.text
    uid = r.json()["id"]
    lr = client.post("/auth/login", json={"email": username, "password": "pw"})
    assert lr.status_code == 200, lr.text
    showroom_token = lr.json()["access_token"]

    denied = client.post(
        f"/admin/impersonate/{uid}",
        headers={"Authorization": f"Bearer {showroom_token}"},
    )
    assert denied.status_code == 403


def test_create_order_json_sets_customer_birthday(client, admin_token):
    phone = f"081{uuid.uuid4().hex[:8]}"
    response = client.post(
        "/orders/json",
        json={
            "customer": {
                "name": "Birth Customer",
                "phone": phone,
                "address": "City",
                "birth_day": 15,
                "birth_month": 3,
            },
            "items": [
                {
                    "item_name": "Sofa",
                    "description": "Fabric",
                    "quantity": 1,
                    "amount": "500.00",
                }
            ],
            "due_date": "2026-04-10T00:00:00",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    cust = data.get("customer") or {}
    assert cust.get("birth_day") == 15
    assert cust.get("birth_month") == 3


def test_create_order_json_rejects_partial_birthday(client, admin_token):
    phone = f"082{uuid.uuid4().hex[:8]}"
    response = client.post(
        "/orders/json",
        json={
            "customer": {
                "name": "Partial Birth",
                "phone": phone,
                "address": "City",
                "birth_day": 5,
            },
            "items": [
                {
                    "item_name": "Sofa",
                    "description": "Fabric",
                    "quantity": 1,
                    "amount": "100.00",
                }
            ],
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert response.status_code == 422


def test_convert_quotation_to_proforma_subheading_totals(client, admin_token):
    """Subheading lines must keep line_type so totals are not wiped (regression)."""
    headers = {"Authorization": f"Bearer {admin_token}"}
    phone = f"085{uuid.uuid4().hex[:8]}"
    q = client.post(
        "/quotations",
        json={
            "customer_name": "Subhead Quote",
            "phone": phone,
            "address": "Street",
            "items": [
                {"line_type": "subheading", "item_name": "SECTION A", "description": "", "quantity": 0},
                {"item_name": "Chair", "description": "Wood", "quantity": 2, "amount": "150.00"},
            ],
            "save_as_draft": False,
            "tax": "10",
        },
        headers=headers,
    )
    assert q.status_code == 200, q.text
    qbody = q.json()
    assert qbody.get("grand_total") is not None

    qid = qbody["id"]
    conv = client.post(f"/quotations/{qid}/convert-to-proforma", headers=headers)
    assert conv.status_code == 200, conv.text
    pid = conv.json()["proforma_id"]

    pf = client.get(f"/proforma/{pid}", headers=headers)
    assert pf.status_code == 200, pf.text
    body = pf.json()
    assert body.get("subtotal") is not None
    assert body.get("grand_total") is not None
    assert Decimal(str(body["subtotal"])) == Decimal("300.00")
    assert Decimal(str(body["grand_total"])) == Decimal("330.00")


def test_delete_converted_quotation(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    phone = f"083{uuid.uuid4().hex[:8]}"
    q = client.post(
        "/quotations",
        json={
            "customer_name": "Quote Delete",
            "phone": phone,
            "address": "Street",
            "items": [{"item_name": "Item", "description": "Desc", "quantity": 1, "amount": "100.00"}],
            "save_as_draft": False,
        },
        headers=headers,
    )
    assert q.status_code == 200, q.text
    qid = q.json()["id"]

    conv = client.post(f"/quotations/{qid}/convert-to-invoice", json={"amount_paid": "0"}, headers=headers)
    assert conv.status_code == 200, conv.text

    dele = client.delete(f"/quotations/{qid}", headers=headers)
    assert dele.status_code == 200, dele.text

    missing = client.get(f"/quotations/{qid}", headers=headers)
    assert missing.status_code == 404


def test_showroom_can_delete_converted_proforma(client, showroom_token):
    headers = {"Authorization": f"Bearer {showroom_token}"}
    phone = f"084{uuid.uuid4().hex[:8]}"
    p = client.post(
        "/proforma",
        json={
            "customer_name": "PF Delete",
            "phone": phone,
            "address": "Lane",
            "items": [{"item_name": "Item", "description": "Desc", "quantity": 1, "amount": "200.00"}],
            "save_as_draft": False,
        },
        headers=headers,
    )
    assert p.status_code == 200, p.text
    pid = p.json()["id"]

    conv = client.post(f"/proforma/{pid}/convert-to-invoice", json={"amount_paid": "0"}, headers=headers)
    assert conv.status_code == 200, conv.text

    dele = client.delete(f"/proforma/{pid}", headers=headers)
    assert dele.status_code == 200, dele.text

    missing = client.get(f"/proforma/{pid}", headers=headers)
    assert missing.status_code == 404


def test_inventory_material_detail_and_purchase(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    create = client.post(
        "/inventory",
        json={
            "material_name": "Copper sheet",
            "category": "Metal",
            "tracking_mode": "numeric",
            "quantity": "10",
            "unit": "kg",
            "stock_level": "medium",
            "supplier_name": "MetalCo",
            "cost": "100.00",
        },
        headers=headers,
    )
    assert create.status_code == 200, create.text
    mid = create.json()["id"]

    detail = client.get(f"/inventory/{mid}", headers=headers)
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert Decimal(str(body["stats"]["total_quantity_purchased"])) == Decimal("10")
    assert Decimal(str(body["stats"]["total_quantity_used"])) == Decimal("0")
    assert Decimal(str(body["material"]["quantity"])) == Decimal("10")

    pur = client.post(
        f"/inventory/{mid}/purchase",
        json={"quantity": "5", "purchase_amount": "40.00", "note": "restock"},
        headers=headers,
    )
    assert pur.status_code == 200, pur.text
    b2 = pur.json()
    assert Decimal(str(b2["stats"]["total_quantity_purchased"])) == Decimal("15")
    assert Decimal(str(b2["material"]["quantity"])) == Decimal("15")
    assert Decimal(str(b2["material"]["cost"])) == Decimal("140")

    used = client.post(
        f"/inventory/{mid}/movements",
        json={"action": "used", "quantity_delta": "-3", "note": "line cut"},
        headers=headers,
    )
    assert used.status_code == 200, used.text

    d3 = client.get(f"/inventory/{mid}", headers=headers).json()
    assert Decimal(str(d3["stats"]["total_quantity_used"])) == Decimal("3")
    assert Decimal(str(d3["stats"]["total_quantity_purchased"])) == Decimal("15")
    assert Decimal(str(d3["material"]["quantity"])) == Decimal("12")


def test_tools_tracking_grouping_filters_and_return(client, admin_token, showroom_token):
    ah = {"Authorization": f"Bearer {admin_token}"}
    sh = {"Authorization": f"Bearer {showroom_token}"}

    denied = client.get("/tools", headers=sh)
    assert denied.status_code == 403

    t = client.post("/tools", json={"name": "Torque wrench A"}, headers=ah)
    assert t.status_code == 200, t.text
    tid = t.json()["id"]
    assert t.json()["in_use"] is False

    co = client.post("/tools/tracking/checkout", json={"tool_id": tid, "borrower_name": "Alex"}, headers=ah)
    assert co.status_code == 200, co.text
    rid = co.json()["id"]
    assert co.json()["returned_at"] is None

    listed = client.get("/tools", headers=ah)
    assert listed.status_code == 200
    assert any(x["id"] == tid and x["in_use"] is True for x in listed.json())

    days = client.get("/tools/tracking/days", headers=ah)
    assert days.status_code == 200, days.text
    dbody = days.json()
    assert dbody["total_days"] >= 1
    day_str = dbody["items"][0]["date"]

    by_day = client.get(f"/tools/tracking/by-day?date={day_str}&status=in_use", headers=ah)
    assert by_day.status_code == 200, by_day.text
    bj = by_day.json()
    assert bj["status_filter"] == "in_use"
    assert len(bj["items"]) >= 1
    assert bj["items"][0]["id"] == rid

    ret = client.post(f"/tools/tracking/{rid}/return", json={}, headers=ah)
    assert ret.status_code == 200, ret.text
    assert ret.json()["returned_at"] is not None

    returned_only = client.get(f"/tools/tracking/by-day?date={day_str}&status=returned", headers=ah)
    assert returned_only.status_code == 200
    assert any(x["id"] == rid for x in returned_only.json()["items"])

    dup = client.post("/tools/tracking/checkout", json={"tool_id": tid}, headers=ah)
    assert dup.status_code == 200
    blocked = client.post("/tools/tracking/checkout", json={"tool_id": tid}, headers=ah)
    assert blocked.status_code == 400


def test_tool_detail_and_trash_restore_factory_tool(client, admin_token):
    ah = {"Authorization": f"Bearer {admin_token}"}
    t = client.post("/tools", json={"name": "Detail tool"}, headers=ah)
    assert t.status_code == 200, t.text
    tid = t.json()["id"]

    d = client.get(f"/tools/{tid}", headers=ah)
    assert d.status_code == 200, d.text
    body = d.json()
    assert body["tool"]["name"] == "Detail tool"
    assert body["current_record_id"] is None

    delr = client.delete(f"/tools/{tid}", headers=ah)
    assert delr.status_code == 200, delr.text

    tr = client.get("/trash", headers=ah)
    assert tr.status_code == 200, tr.text
    items = tr.json()["items"]
    assert any(x["entity_type"] == "factory_tool" and x["entity_id"] == tid for x in items)

    rest = client.post("/trash/restore", json={"entity_type": "factory_tool", "entity_id": tid}, headers=ah)
    assert rest.status_code == 200, rest.text

    d2 = client.get(f"/tools/{tid}", headers=ah)
    assert d2.status_code == 200, d2.text
    assert d2.json()["tool"]["name"] == "Detail tool"


def test_trash_purge_post_bulk_and_purge_all(client, admin_token):
    ah = {"Authorization": f"Bearer {admin_token}"}

    t = client.post("/tools", json={"name": "Purge post tool"}, headers=ah)
    assert t.status_code == 200, t.text
    tid = t.json()["id"]
    assert client.delete(f"/tools/{tid}", headers=ah).status_code == 200

    pr = client.post("/trash/purge", json={"entity_type": "factory_tool", "entity_id": tid}, headers=ah)
    assert pr.status_code == 200, pr.text
    assert pr.json()["message"] == "Permanently deleted"

    tr = client.get("/trash", headers=ah)
    assert tr.status_code == 200
    assert not any(x["entity_type"] == "factory_tool" and x["entity_id"] == tid for x in tr.json()["items"])

    t2 = client.post("/tools", json={"name": "Bulk purge tool"}, headers=ah)
    tid2 = t2.json()["id"]
    assert client.delete(f"/tools/{tid2}", headers=ah).status_code == 200

    bulk = client.post(
        "/trash/purge-bulk",
        json={"items": [{"entity_type": "factory_tool", "entity_id": tid2}]},
        headers=ah,
    )
    assert bulk.status_code == 200, bulk.text
    assert bulk.json()["purged"] == 1
    assert bulk.json()["failed"] == []

    pa = client.post("/trash/purge-all", json={"confirm": "PERMANENTLY_DELETE_ALL_TRASH"}, headers=ah)
    assert pa.status_code == 200, pa.text
    assert isinstance(pa.json().get("purged"), int)


def test_machines_detail_and_activities(client, factory_token):
    fh = {"Authorization": f"Bearer {factory_token}"}

    c = client.post(
        "/machines",
        json={
            "machine_name": "Edge bander 1",
            "category": "Finishing",
            "location": "Hall B",
            "status": "available",
        },
        headers=fh,
    )
    assert c.status_code == 200, c.text
    mid = c.json()["id"]

    det = client.get(f"/machines/{mid}", headers=fh)
    assert det.status_code == 200, det.text
    assert det.json()["machine"]["status"] == "available"
    assert len(det.json()["activities"]) >= 1

    u = client.post(f"/machines/{mid}/activities", json={"kind": "usage_start"}, headers=fh)
    assert u.status_code == 200, u.text
    assert client.get(f"/machines/{mid}", headers=fh).json()["machine"]["status"] == "in_use"

    e = client.post(f"/machines/{mid}/activities", json={"kind": "usage_end"}, headers=fh)
    assert e.status_code == 200
    assert client.get(f"/machines/{mid}", headers=fh).json()["machine"]["status"] == "available"

    sc = client.post(
        f"/machines/{mid}/activities",
        json={"kind": "status_change", "new_status": "maintenance", "message": "Scheduled service"},
        headers=fh,
    )
    assert sc.status_code == 200
    assert client.get(f"/machines/{mid}", headers=fh).json()["machine"]["status"] == "maintenance"
