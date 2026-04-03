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
