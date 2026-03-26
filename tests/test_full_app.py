import sys
import os

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from fastapi.testclient import TestClient
from app.main import app
from datetime import datetime, timedelta

client = TestClient(app)


# 🔹 Helper: login as admin
def get_admin_token():
    response = client.post("/auth/login", json={
        "email": "admin@company.com",
        "password": "admin123"
    })
    return response.json()["access_token"]


# 🔹 Test home
def test_home():
    response = client.get("/")
    assert response.status_code == 200


# 🔹 Test login
def test_login():
    response = client.post("/auth/login", json={
        "email": "admin@company.com",
        "password": "admin123"
    })
    assert response.status_code == 200
    assert "access_token" in response.json()


# 🔹 Test create user (admin only)
def test_create_user():
    token = get_admin_token()

    response = client.post(
        "/users",
        json={
            "name": "Test User",
            "email": "testuser@mail.com",
            "password": "123456",
            "role": "showroom"
        },
        headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 200
    assert response.json()["email"] == "testuser@mail.com"


# 🔹 Test create customer
def test_create_customer():
    token = get_admin_token()

    response = client.post(
        "/customers",
        params={
            "name": "John Doe",
            "phone": "08012345678",
            "address": "Abuja"
        },
        headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 200
    assert response.json()["name"] == "John Doe"


# 🔹 Test create product
def test_create_product():
    token = get_admin_token()

    response = client.post(
        "/products",
        params={
            "name": "Chair",
            "price": 15000
        },
        headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Chair"


# 🔹 Test create order
def test_create_order():
    token = get_admin_token()

    response = client.post(
        "/orders",
        json={
            "customer_id": 1,
            "items": [
                {"product_id": 1, "quantity": 2}
            ],
            "due_date": "2026-04-10T00:00:00"
        },
        headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 200
    assert "order_id" in response.json()


# 🔹 Test get orders
def test_get_orders():
    token = get_admin_token()

    response = client.get(
        "/orders",
        headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 200
    assert isinstance(response.json(), list)


# 🔹 Test update status
def test_update_status():
    token = get_admin_token()

    # ✅ Create order first
    order_res = client.post(
        "/orders",
        json={
            "customer_id": 1,
            "items": [
                {"product_id": 1, "quantity": 2}
            ],
            "due_date": "2026-04-10T00:00:00"
        },
        headers={"Authorization": f"Bearer {token}"}
    )

    order_id = order_res.json()["order_id"]

    # ✅ Update that order
    response = client.put(
        f"/orders/{order_id}",
        params={"status": "in_progress"},
        headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 200


# 🔹 Test reminders


def test_reminders():
    token = get_admin_token()

    # ✅ Create order within 14 days
    due_date = (datetime.utcnow() + timedelta(days=5)).isoformat()

    client.post(
        "/orders",
        json={
            "customer_id": 1,
            "items": [
                {"product_id": 1, "quantity": 1}
            ],
            "due_date": due_date
        },
        headers={"Authorization": f"Bearer {token}"}
    )

    # ✅ Call reminders
    response = client.get(
        "/orders/reminders",
        headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 200
    assert isinstance(response.json(), list)