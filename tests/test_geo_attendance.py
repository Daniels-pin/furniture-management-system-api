"""Geo-attendance validation: haversine boundaries, clock-in rules, lateness, and API errors."""

from __future__ import annotations

import uuid
from datetime import date, datetime, time
from decimal import Decimal
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest

from app import models
from app.routes.employees import (
    LATENESS_DEDUCTION_NAIRA,
    _haversine_meters,
    _is_sunday,
    _late_minutes,
    _salary_breakdown,
)

LAGOS = ZoneInfo("Africa/Lagos")

# Lagos-ish office pin for deterministic geo tests
OFFICE_LAT = 6.5244
OFFICE_LON = 3.3792
RADIUS_M = 100


def _offset_north_meters(lat: float, lon: float, meters: float) -> tuple[float, float]:
    """Approximate coordinate north of (lat, lon) by meters (adequate for boundary tests)."""
    return lat + meters / 111_320.0, lon


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_staff_user(client, admin_token: str) -> tuple[str, int]:
    email = f"staff_{uuid.uuid4().hex[:8]}@test.com"
    r = client.post(
        "/users",
        json={"username": email, "password": "pw123456", "role": "staff"},
        headers=_auth(admin_token),
    )
    assert r.status_code == 200, r.text
    user_id = r.json()["id"]
    login = client.post("/auth/login", json={"email": email, "password": "pw123456"})
    assert login.status_code == 200, login.text
    return login.json()["access_token"], user_id


def _create_monthly_employee(client, admin_token: str, user_id: int) -> int:
    r = client.post(
        "/employees",
        json={"full_name": "Geo Test Employee", "user_id": user_id, "base_salary": "100000"},
        headers=_auth(admin_token),
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _create_location(client, admin_token: str) -> int:
    r = client.post(
        "/company-locations",
        json={
            "name": f"Site-{uuid.uuid4().hex[:6]}",
            "latitude": OFFICE_LAT,
            "longitude": OFFICE_LON,
            "allowed_radius_meters": RADIUS_M,
        },
        headers=_auth(admin_token),
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _assign_location(client, admin_token: str, employee_id: int, location_id: int) -> None:
    r = client.patch(
        f"/employees/{employee_id}/work-location",
        json={"location_id": location_id},
        headers=_auth(admin_token),
    )
    assert r.status_code == 200, r.text


def _geo_clock_in(client, token: str, lat: float, lon: float):
    return client.post(
        "/employees/me/attendance/clock-in-geo",
        json={"latitude": lat, "longitude": lon},
        headers=_auth(token),
    )


@pytest.fixture
def geo_employee(client, admin_token):
    staff_token, user_id = _create_staff_user(client, admin_token)
    emp_id = _create_monthly_employee(client, admin_token, user_id)
    loc_id = _create_location(client, admin_token)
    _assign_location(client, admin_token, emp_id, loc_id)
    return {"staff_token": staff_token, "employee_id": emp_id, "location_id": loc_id}


# --- Unit: haversine & helpers ---


def test_haversine_zero_at_same_point():
    assert _haversine_meters(OFFICE_LAT, OFFICE_LON, OFFICE_LAT, OFFICE_LON) == 0.0


def test_haversine_boundary_inclusive():
    inside_lat, inside_lon = _offset_north_meters(OFFICE_LAT, OFFICE_LON, RADIUS_M - 1)
    edge_lat, edge_lon = _offset_north_meters(OFFICE_LAT, OFFICE_LON, RADIUS_M)
    outside_lat, outside_lon = _offset_north_meters(OFFICE_LAT, OFFICE_LON, RADIUS_M + 1)

    d_inside = _haversine_meters(inside_lat, inside_lon, OFFICE_LAT, OFFICE_LON)
    d_edge = _haversine_meters(edge_lat, edge_lon, OFFICE_LAT, OFFICE_LON)
    d_outside = _haversine_meters(outside_lat, outside_lon, OFFICE_LAT, OFFICE_LON)

    assert d_inside < RADIUS_M
    assert abs(d_edge - RADIUS_M) < 2.0  # ~1m tolerance for flat-earth offset approximation
    assert d_outside > RADIUS_M


def test_late_minutes_threshold():
    tz = LAGOS
    on_time = datetime(2026, 5, 15, 8, 10, 0, tzinfo=tz)
    late = datetime(2026, 5, 15, 8, 11, 0, tzinfo=tz)
    assert _late_minutes(on_time) == 0
    assert _late_minutes(late) == 1


def test_sunday_detection():
    assert _is_sunday(date(2026, 5, 17))  # Sunday
    assert not _is_sunday(date(2026, 5, 16))  # Saturday


def test_lateness_deduction_500_per_count():
    b = _salary_breakdown(Decimal("100000"), lateness_count=2, penalties_total=Decimal("0"), bonuses_total=Decimal("0"))
    assert b.lateness_deduction == LATENESS_DEDUCTION_NAIRA * 2
    assert b.lateness_rate_naira == Decimal("500")


# --- Integration: geo clock-in API ---


def test_geo_clock_in_success_inside_radius(client, geo_employee):
    lat, lon = _offset_north_meters(OFFICE_LAT, OFFICE_LON, 10)
    r = _geo_clock_in(client, geo_employee["staff_token"], lat, lon)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] in ("present", "late")
    assert body["entry"] is not None
    assert body["entry"]["distance_meters"] is not None
    assert body["entry"]["distance_meters"] <= RADIUS_M


def test_geo_clock_in_outside_radius(client, geo_employee):
    lat, lon = _offset_north_meters(OFFICE_LAT, OFFICE_LON, RADIUS_M + 50)
    r = _geo_clock_in(client, geo_employee["staff_token"], lat, lon)
    assert r.status_code == 403
    assert r.json()["detail"] == "You must be within your assigned work location to mark attendance."


def test_geo_clock_in_no_work_location(client, admin_token):
    staff_token, user_id = _create_staff_user(client, admin_token)
    _create_monthly_employee(client, admin_token, user_id)
    r = _geo_clock_in(client, staff_token, OFFICE_LAT, OFFICE_LON)
    assert r.status_code == 409
    assert r.json()["detail"] == "No work location assigned. Contact an administrator."


def test_geo_clock_in_duplicate_same_day(client, geo_employee):
    lat, lon = OFFICE_LAT, OFFICE_LON
    first = _geo_clock_in(client, geo_employee["staff_token"], lat, lon)
    assert first.status_code == 200, first.text
    second = _geo_clock_in(client, geo_employee["staff_token"], lat, lon)
    assert second.status_code == 200, second.text
    assert second.json()["status"] == "already_marked"
    assert "already marked" in second.json()["message"].lower()


def test_geo_clock_in_sunday_excluded(client, geo_employee):
    sunday = datetime(2026, 5, 17, 9, 0, 0, tzinfo=LAGOS)

    with patch("app.routes.employees._now_local", return_value=sunday):
        r = _geo_clock_in(client, geo_employee["staff_token"], OFFICE_LAT, OFFICE_LON)

    assert r.status_code == 200, r.text
    assert r.json()["status"] == "sunday"
    assert "Sundays are excluded" in r.json()["message"]
    assert r.json()["entry"] is None


def test_geo_clock_in_late_creates_lateness_entry(client, geo_employee, db_session):
    late_morning = datetime(2026, 5, 15, 8, 15, 0, tzinfo=LAGOS)

    with patch("app.routes.employees._now_local", return_value=late_morning):
        r = _geo_clock_in(client, geo_employee["staff_token"], OFFICE_LAT, OFFICE_LON)

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "late"
    assert body["entry"]["is_late"] is True
    entry_id = body["entry"]["id"]

    late_rows = (
        db_session.query(models.EmployeeLatenessEntry)
        .filter(
            models.EmployeeLatenessEntry.employee_id == geo_employee["employee_id"],
            models.EmployeeLatenessEntry.attendance_id == entry_id,
            models.EmployeeLatenessEntry.voided_at.is_(None),
        )
        .all()
    )
    assert len(late_rows) == 1

    # Second clock-in same day must not duplicate lateness
    with patch("app.routes.employees._now_local", return_value=late_morning):
        again = _geo_clock_in(client, geo_employee["staff_token"], OFFICE_LAT, OFFICE_LON)
    assert again.json()["status"] == "already_marked"


def test_geo_clock_in_unconfigured_radius(client, geo_employee, db_session):
    row = db_session.query(models.CompanyLocation).filter(models.CompanyLocation.id == geo_employee["location_id"]).first()
    row.allowed_radius_meters = 0
    db_session.commit()

    r = _geo_clock_in(client, geo_employee["staff_token"], OFFICE_LAT, OFFICE_LON)
    assert r.status_code == 409
    assert "radius is not configured" in r.json()["detail"]
