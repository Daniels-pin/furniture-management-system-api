from __future__ import annotations

import json

def _token(client, email: str, password: str) -> str:
    res = client.post("/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200
    return res.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _sample_payload() -> dict:
    return {
        "project_name": "Sunrise Estate",
        "project_location": "Lekki Phase 1",
        "project_type": "Residential",
        "estimated_units": "12 units",
        "project_stage": "Finishing",
        "developer_owner": "Sunrise Dev Ltd",
        "contractor": "BuildCo",
        "architect_designer": "Design Studio",
        "decision_maker": "Mr Ade",
        "phone_number": "08012345678",
        "whatsapp_number": "08087654321",
        "furniture_needed": ["Kitchen Cabinets", "Wardrobes"],
        "boq_available": "Yes",
        "estimated_opportunity_value": 15000000,
        "existing_supplier": "ABC Furniture",
        "visit_outcome": "Client Interested",
        "notes": "Strong opportunity",
        "latitude": 6.4474,
        "longitude": 3.4700,
        "existing_photo_urls": [],
    }


def test_showroom_can_create_and_list_own_field_visit(client):
    token = _token(client, "showroom@company.com", "showroom123")
    res = client.post(
        "/field-visits",
        data={"data_json": json.dumps(_sample_payload())},
        headers=_auth(token),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["visit_number"] == "FV-000001"
    assert body["project_name"] == "Sunrise Estate"
    assert body["can_edit"] is True

    page = client.get("/field-visits/page", headers=_auth(token))
    assert page.status_code == 200
    data = page.json()
    assert data["total"] == 1
    assert data["items"][0]["visit_number"] == "FV-000001"


def test_admin_can_view_summary_and_export(client):
    showroom_token = _token(client, "showroom@company.com", "showroom123")
    client.post(
        "/field-visits",
        data={"data_json": json.dumps(_sample_payload())},
        headers=_auth(showroom_token),
    )

    admin_token = _token(client, "admin@company.com", "admin123")
    summary = client.get("/field-visits/summary", headers=_auth(admin_token))
    assert summary.status_code == 200
    assert summary.json()["total_visits"] == 1

    export = client.get("/field-visits/export/csv", headers=_auth(admin_token))
    assert export.status_code == 200
    assert "FV-000001" in export.text


def test_deleted_visit_number_is_not_reused(client):
    showroom_token = _token(client, "showroom@company.com", "showroom123")
    created = client.post(
        "/field-visits",
        data={"data_json": json.dumps(_sample_payload())},
        headers=_auth(showroom_token),
    ).json()

    admin_token = _token(client, "admin@company.com", "admin123")
    deleted = client.delete(f"/field-visits/{created['id']}", headers=_auth(admin_token))
    assert deleted.status_code == 200

    second = client.post(
        "/field-visits",
        data={"data_json": json.dumps(_sample_payload())},
        headers=_auth(showroom_token),
    ).json()
    assert second["visit_number"] == "FV-000002"


def test_factory_cannot_access_field_visits(client):
    token = _token(client, "factory@company.com", "factory123")
    res = client.get("/field-visits/page", headers=_auth(token))
    assert res.status_code == 403
