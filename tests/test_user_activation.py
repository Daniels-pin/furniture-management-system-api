"""Tests for user account activation and deactivation."""
from __future__ import annotations

import uuid

import pytest

from app.auth.utils import hash_password
from app import models
from app.utils.activity_log import USER_ACTIVATED, USER_DEACTIVATED


@pytest.fixture
def inactive_user(db_session):
    email = f"inactive_{uuid.uuid4().hex[:8]}@mail.com"
    user = models.User(
        name=email,
        email=email,
        password=hash_password("secret123"),
        role="showroom",
        is_active=False,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def test_inactive_user_cannot_login(client, inactive_user):
    r = client.post("/auth/login", json={"email": inactive_user.email, "password": "secret123"})
    assert r.status_code == 403, r.text
    assert r.json()["detail"] == "Your account has been deactivated. Please contact your administrator."


def test_deactivate_user(client, admin_token, db_session):
    email = f"deact_{uuid.uuid4().hex[:8]}@mail.com"
    user = models.User(
        name=email,
        email=email,
        password=hash_password("secret123"),
        role="factory",
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    r = client.post(
        f"/users/{user.id}/deactivate",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["is_active"] is False

    logs = (
        db_session.query(models.ActionLog)
        .filter(models.ActionLog.action == USER_DEACTIVATED, models.ActionLog.entity_id == user.id)
        .all()
    )
    assert len(logs) == 1

    login = client.post("/auth/login", json={"email": email, "password": "secret123"})
    assert login.status_code == 403


def test_activate_user(client, admin_token, inactive_user):
    r = client.post(
        f"/users/{inactive_user.id}/activate",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["is_active"] is True

    login = client.post("/auth/login", json={"email": inactive_user.email, "password": "secret123"})
    assert login.status_code == 200, login.text


def test_list_users_status_filter(client, admin_token, inactive_user, db_session):
    active_email = f"active_{uuid.uuid4().hex[:8]}@mail.com"
    db_session.add(
        models.User(
            name=active_email,
            email=active_email,
            password=hash_password("secret123"),
            role="staff",
            is_active=True,
        )
    )
    db_session.commit()

    r_active = client.get("/users", headers={"Authorization": f"Bearer {admin_token}"})
    assert r_active.status_code == 200
    active_ids = {u["id"] for u in r_active.json()}
    assert inactive_user.id not in active_ids

    r_inactive = client.get(
        "/users?status=inactive",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r_inactive.status_code == 200
    inactive_ids = {u["id"] for u in r_inactive.json()}
    assert inactive_user.id in inactive_ids

    r_all = client.get(
        "/users?status=all",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r_all.status_code == 200
    all_ids = {u["id"] for u in r_all.json()}
    assert inactive_user.id in all_ids


def test_inactive_user_blocked_from_attendance(client, db_session, inactive_user):
    emp = models.Employee(
        full_name="Inactive Attendance Test",
        bank_name="Test Bank",
        base_salary=100000,
        user_id=inactive_user.id,
    )
    db_session.add(emp)
    db_session.commit()

    login = client.post("/auth/login", json={"email": inactive_user.email, "password": "secret123"})
    assert login.status_code == 403


def test_create_user_defaults_to_active(client, admin_token):
    username = f"new_user_{uuid.uuid4().hex[:8]}@mail.com"
    r = client.post(
        "/users",
        json={"username": username, "password": "secret123", "role": "staff"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["is_active"] is True


def test_cannot_deactivate_self(client, admin_token, db_session):
    admin = db_session.query(models.User).filter(models.User.email == "admin@company.com").first()
    r = client.post(
        f"/users/{admin.id}/deactivate",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 400


def test_notifications_skip_inactive_recipients(client, admin_token, db_session, inactive_user):
    from app.utils.notifications import create_notifications

    db = db_session
    create_notifications(
        db,
        recipient_user_ids=[inactive_user.id],
        kind="system",
        title="Test",
        message="Hello",
    )
    db.commit()
    count = db.query(models.Notification).filter(models.Notification.recipient_user_id == inactive_user.id).count()
    assert count == 0
