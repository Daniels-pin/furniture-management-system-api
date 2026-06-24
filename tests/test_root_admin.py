"""Tests for Root Admin role: privileges, visibility, and protection."""
from __future__ import annotations

import uuid

import pytest

from app.auth.utils import hash_password
from app import models


@pytest.fixture
def root_admin_token(client, db_session):
    email = "root@company.com"
    db_session.add(
        models.User(
            name=email,
            email=email,
            password=hash_password("root12345"),
            role="root_admin",
        )
    )
    db_session.commit()
    r = client.post("/auth/login", json={"email": email, "password": "root12345"})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def test_root_admin_inherits_admin_dashboard(client, root_admin_token):
    r = client.get("/dashboard", headers={"Authorization": f"Bearer {root_admin_token}"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "total_revenue" in body


def test_root_admin_hidden_from_regular_admin_list(client, admin_token, root_admin_token, db_session):
    r = client.get("/users", headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200, r.text
    roles = {u["role"] for u in r.json()}
    assert "root_admin" not in roles

    r_root = client.get("/users", headers={"Authorization": f"Bearer {root_admin_token}"})
    assert r_root.status_code == 200, r_root.text
    root_roles = {u["role"] for u in r_root.json()}
    assert "root_admin" in root_roles


def test_cannot_create_root_admin_via_normal_user_endpoint(client, admin_token):
    username = f"bad_root_{uuid.uuid4().hex[:8]}@mail.com"
    r = client.post(
        "/users",
        json={"username": username, "password": "secret123", "role": "root_admin"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 422


def test_root_admin_can_create_root_admin(client, root_admin_token):
    username = f"root2_{uuid.uuid4().hex[:8]}@mail.com"
    r = client.post(
        "/users/root-admins",
        json={"username": username, "password": "secret123"},
        headers={"Authorization": f"Bearer {root_admin_token}"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "root_admin"


def test_regular_admin_cannot_delete_root_admin(client, admin_token, db_session):
    email = f"protected_root_{uuid.uuid4().hex[:8]}@mail.com"
    user = models.User(
        name=email,
        email=email,
        password=hash_password("secret123"),
        role="root_admin",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    r = client.delete(
        f"/users/{user.id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 403


def test_root_admin_can_delete_root_admin(client, root_admin_token, db_session):
    email = f"deletable_root_{uuid.uuid4().hex[:8]}@mail.com"
    user = models.User(
        name=email,
        email=email,
        password=hash_password("secret123"),
        role="root_admin",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    r = client.delete(
        f"/users/{user.id}",
        headers={"Authorization": f"Bearer {root_admin_token}"},
    )
    assert r.status_code == 200, r.text


def test_admin_cannot_impersonate_root_admin(client, admin_token, db_session):
    email = f"imp_root_{uuid.uuid4().hex[:8]}@mail.com"
    user = models.User(
        name=email,
        email=email,
        password=hash_password("secret123"),
        role="root_admin",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    r = client.post(
        f"/admin/impersonate/{user.id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 403
