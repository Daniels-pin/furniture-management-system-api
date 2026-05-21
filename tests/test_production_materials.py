"""Integration tests for production material tracking."""

from __future__ import annotations

from datetime import datetime


def _create_contract_employee(client, admin_token: str, name: str = "John Painter") -> int:
    res = client.post(
        "/contract-employees",
        json={"full_name": name, "status": "active"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    return int(res.json()["id"])


def _material_type_id(client, admin_token: str, section: str, name: str) -> int:
    res = client.get(
        f"/production-materials/sections/{section}/material-types",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    for row in res.json():
        if row["name"] == name:
            return int(row["id"])
    created = client.post(
        f"/production-materials/sections/{section}/material-types",
        json={"name": name},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert created.status_code == 200, created.text
    return int(created.json()["id"])


def test_production_material_tracking_flow(client, admin_token, factory_token):
    section = "painters_dept"
    employee_id = _create_contract_employee(client, admin_token)
    paint_id = _material_type_id(client, admin_token, section, "White Paint")

    assign = client.post(
        f"/production-materials/sections/{section}/assignments",
        json={"contract_employee_id": employee_id},
        headers={"Authorization": f"Bearer {factory_token}"},
    )
    assert assign.status_code == 200, assign.text

    dup = client.post(
        f"/production-materials/sections/{section}/assignments",
        json={"contract_employee_id": employee_id},
        headers={"Authorization": f"Bearer {factory_token}"},
    )
    assert dup.status_code == 409

    txn_at = datetime.utcnow().isoformat()
    alloc = client.post(
        f"/production-materials/sections/{section}/employees/{employee_id}/transactions",
        json={
            "material_type_id": paint_id,
            "quantity": "5",
            "transaction_at": txn_at,
            "notes": "Kitchen project",
        },
        headers={"Authorization": f"Bearer {factory_token}"},
    )
    assert alloc.status_code == 200, alloc.text
    txn_id = int(alloc.json()["id"])

    overview = client.get(
        f"/production-materials/sections/{section}/overview",
        headers={"Authorization": f"Bearer {factory_token}"},
    )
    assert overview.status_code == 200, overview.text
    body = overview.json()
    assert body["employees"][0]["material_totals"][0]["total_quantity"] in ("5", "5.0000", 5, 5.0)

    edit = client.put(
        f"/production-materials/transactions/{txn_id}",
        json={"quantity": "3", "notes": "Corrected qty"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert edit.status_code == 200, edit.text
    new_txn_id = int(edit.json()["id"])
    assert new_txn_id != txn_id

    overview2 = client.get(
        f"/production-materials/sections/{section}/overview",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert overview2.status_code == 200
    totals = overview2.json()["employees"][0]["material_totals"]
    assert totals[0]["total_quantity"] in ("3", "3.0000", 3, 3.0)

    reverse = client.post(
        f"/production-materials/transactions/{new_txn_id}/reverse",
        json={"quantity": "1", "notes": "Returned unused"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert reverse.status_code == 200, reverse.text

    overview3 = client.get(
        f"/production-materials/sections/{section}/overview",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert overview3.status_code == 200
    totals3 = overview3.json()["employees"][0]["material_totals"]
    assert totals3[0]["total_quantity"] in ("2", "2.0000", 2, 2.0)

    history = client.get(
        f"/production-materials/sections/{section}/employees/{employee_id}/transactions",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert history.status_code == 200
    assert len(history.json()) >= 3


def test_production_material_tracking_forbidden_for_showroom(client, showroom_token):
    res = client.get(
        "/production-materials/sections/painters_dept/overview",
        headers={"Authorization": f"Bearer {showroom_token}"},
    )
    assert res.status_code == 403


def test_delete_material_type_preserves_history_and_totals(client, admin_token, factory_token):
    section = "painters_dept"
    employee_id = _create_contract_employee(client, admin_token, name="Archive Painter")
    paint_id = _material_type_id(client, admin_token, section, "White Paint")

    client.post(
        f"/production-materials/sections/{section}/assignments",
        json={"contract_employee_id": employee_id},
        headers={"Authorization": f"Bearer {factory_token}"},
    )
    txn_at = datetime.utcnow().isoformat()
    alloc = client.post(
        f"/production-materials/sections/{section}/employees/{employee_id}/transactions",
        json={
            "material_type_id": paint_id,
            "quantity": "5",
            "transaction_at": txn_at,
            "notes": "Before archive",
        },
        headers={"Authorization": f"Bearer {factory_token}"},
    )
    assert alloc.status_code == 200, alloc.text

    deleted = client.delete(
        f"/production-materials/material-types/{paint_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert deleted.status_code == 200, deleted.text

    active_types = client.get(
        f"/production-materials/sections/{section}/material-types",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert active_types.status_code == 200
    assert all(row["name"] != "White Paint" for row in active_types.json())

    overview = client.get(
        f"/production-materials/sections/{section}/overview",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert overview.status_code == 200, overview.text
    body = overview.json()
    assert body["employees"][0]["material_totals"][0]["total_quantity"] in ("5", "5.0000", 5, 5.0)
    assert any(col["material_name"] == "White Paint" and col["is_selectable"] is False for col in body["display_columns"])

    history = client.get(
        f"/production-materials/sections/{section}/employees/{employee_id}/transactions",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert history.status_code == 200
    assert history.json()[0]["material_name"] == "White Paint"

    blocked = client.post(
        f"/production-materials/sections/{section}/employees/{employee_id}/transactions",
        json={
            "material_type_id": paint_id,
            "quantity": "1",
            "transaction_at": txn_at,
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert blocked.status_code == 404
