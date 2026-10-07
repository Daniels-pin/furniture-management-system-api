"""Contract employee profile user-account linking."""

from __future__ import annotations

from app import models


def _create_ce(client, admin_token):
    r = client.post(
        "/contract-employees",
        json={"full_name": "Jane Contract", "status": "active"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_create_user_account_links_existing_employee(client, admin_token, db_session):
    ce = _create_ce(client, admin_token)
    assert ce.get("linked_user_id") is None

    r = client.post(
        f"/contract-employees/{ce['id']}/user-account",
        json={"username": "jane.contract", "password": "password123", "role": "contract_employee"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["linked_user_id"] is not None
    assert body["linked_username"] == "jane.contract"
    assert body["linked_user_role"] == "contract_employee"
    assert body["user_account_active"] is True

    emp = db_session.query(models.ContractEmployee).filter(models.ContractEmployee.id == ce["id"]).one()
    assert emp.user_id == body["linked_user_id"]

    dup = client.post(
        f"/contract-employees/{ce['id']}/user-account",
        json={"username": "other.user", "password": "password123", "role": "factory"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert dup.status_code == 409


def test_create_user_account_rejects_duplicate_username(client, admin_token):
    ce = _create_ce(client, admin_token)
    r = client.post(
        f"/contract-employees/{ce['id']}/user-account",
        json={"username": "admin@company.com", "password": "password123", "role": "factory"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 409


def test_update_linked_user_account(client, admin_token):
    ce = _create_ce(client, admin_token)
    client.post(
        f"/contract-employees/{ce['id']}/user-account",
        json={"username": "worker.one", "password": "password123", "role": "contract_employee"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    r = client.patch(
        f"/contract-employees/{ce['id']}/user-account",
        json={"username": "worker.updated", "role": "factory"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["linked_username"] == "worker.updated"
    assert body["linked_user_role"] == "factory"
