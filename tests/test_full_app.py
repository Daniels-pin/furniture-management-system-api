"""Integration tests against the FastAPI app with an isolated in-memory DB (see conftest.py)."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta


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
