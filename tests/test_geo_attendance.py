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
    ABSENCE_DEDUCTION_NAIRA,
    LATENESS_DEDUCTION_NAIRA,
    _GEO_VALIDATION_BUFFER_METERS,
    _effective_geo_radius_meters,
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
    on_time = datetime(2026, 5, 15, 8, 15, 0, tzinfo=tz)
    late = datetime(2026, 5, 15, 8, 16, 0, tzinfo=tz)
    assert _late_minutes(on_time) == 0
    assert _late_minutes(late) == 1


def test_sunday_detection():
    assert _is_sunday(date(2026, 5, 17))  # Sunday
    assert not _is_sunday(date(2026, 5, 16))  # Saturday


def test_lateness_deduction_500_per_count():
    b = _salary_breakdown(Decimal("100000"), lateness_count=2, penalties_total=Decimal("0"), bonuses_total=Decimal("0"))
    assert b.lateness_deduction_auto == LATENESS_DEDUCTION_NAIRA * 2
    assert b.lateness_deduction == LATENESS_DEDUCTION_NAIRA * 2
    assert b.lateness_rate_naira == Decimal("500")


def test_lateness_deduction_override_reduces_payroll_not_count():
    b = _salary_breakdown(
        Decimal("100000"),
        lateness_count=2,
        penalties_total=Decimal("0"),
        bonuses_total=Decimal("0"),
        lateness_deduction_override=Decimal("500"),
    )
    assert b.lateness_count == 2
    assert b.lateness_deduction_auto == Decimal("1000")
    assert b.lateness_deduction == Decimal("500")
    assert b.final_payable == Decimal("99500")


def test_absence_deduction_1000_per_count():
    b = _salary_breakdown(
        Decimal("100000"),
        lateness_count=0,
        penalties_total=Decimal("0"),
        bonuses_total=Decimal("0"),
        absence_count=2,
    )
    assert b.absence_deduction_auto == ABSENCE_DEDUCTION_NAIRA * 2
    assert b.absence_deduction == ABSENCE_DEDUCTION_NAIRA * 2
    assert b.absence_rate_naira == Decimal("1000")
    assert b.total_deductions == ABSENCE_DEDUCTION_NAIRA * 2


def test_absence_deduction_override():
    b = _salary_breakdown(
        Decimal("100000"),
        lateness_count=0,
        penalties_total=Decimal("0"),
        bonuses_total=Decimal("0"),
        absence_count=3,
        absence_deduction_override=Decimal("1500"),
    )
    assert b.absence_count == 3
    assert b.absence_deduction_auto == Decimal("3000")
    assert b.absence_deduction == Decimal("1500")
    assert b.final_payable == Decimal("98500")


def test_salary_breakdown_zeros_attendance_deductions_when_ineligible():
    b = _salary_breakdown(
        Decimal("100000"),
        lateness_count=2,
        penalties_total=Decimal("0"),
        bonuses_total=Decimal("0"),
        absence_count=3,
        apply_attendance_deductions=False,
    )
    assert b.lateness_deduction_auto == Decimal("1000")
    assert b.absence_deduction_auto == Decimal("3000")
    assert b.lateness_deduction == 0
    assert b.absence_deduction == 0
    assert b.attendance_deductions_eligible is False
    assert b.total_deductions == 0
    assert b.final_payable == Decimal("100000")


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
    assert "within your assigned work location" in r.json()["detail"]


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
    late_morning = datetime(2026, 5, 15, 8, 16, 0, tzinfo=LAGOS)

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


def test_delete_location_unassigns_employees_and_preserves_attendance(client, geo_employee, admin_token, db_session):
    loc_id = geo_employee["location_id"]
    emp_id = geo_employee["employee_id"]

    clock_in = _geo_clock_in(client, geo_employee["staff_token"], OFFICE_LAT, OFFICE_LON)
    assert clock_in.status_code == 200, clock_in.text
    entry_id = clock_in.json()["entry"]["id"]

    r = client.delete(f"/company-locations/{loc_id}", headers=_auth(admin_token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["message"] == "Location deleted"
    assert body["employees_unassigned"] == 1

    db_session.expire_all()
    emp = db_session.query(models.Employee).filter(models.Employee.id == emp_id).first()
    assert emp.work_location_id is None
    assert emp.work_location_assigned_at is None

    entry = db_session.query(models.EmployeeAttendanceEntry).filter(models.EmployeeAttendanceEntry.id == entry_id).first()
    assert entry is not None
    assert entry.work_location_id is None
    assert entry.employee_latitude is not None
    assert entry.distance_meters is not None

    nav = client.get("/employees/periods", headers=_auth(admin_token)).json()
    ap = nav["active_period"]
    detail = client.get(
        f"/employees/{emp_id}",
        params={"period_year": ap["year"], "period_month": ap["month"]},
        headers=_auth(admin_token),
    ).json()
    salary = detail["salary"]
    assert salary["attendance_deductions_eligible"] is False
    assert float(salary["lateness_deduction"]) == 0.0
    assert float(salary["absence_deduction"]) == 0.0


def test_effective_geo_radius_includes_gps_buffer():
    assert _effective_geo_radius_meters(100) == 100 + _GEO_VALIDATION_BUFFER_METERS


def test_geo_clock_in_uses_updated_location_coordinates(client, admin_token):
    """After admin edits a location pin, validation must use the new coordinates (same location id)."""
    staff_token, user_id = _create_staff_user(client, admin_token)
    emp_id = _create_monthly_employee(client, admin_token, user_id)
    loc_id = _create_location(client, admin_token)
    _assign_location(client, admin_token, emp_id, loc_id)

    inside_lat, inside_lon = _offset_north_meters(OFFICE_LAT, OFFICE_LON, 10)
    far_lat, far_lon = _offset_north_meters(OFFICE_LAT, OFFICE_LON, 500)

    patch = client.patch(
        f"/company-locations/{loc_id}",
        json={"latitude": far_lat, "longitude": far_lon, "allowed_radius_meters": RADIUS_M},
        headers=_auth(admin_token),
    )
    assert patch.status_code == 200, patch.text

    rejected = _geo_clock_in(client, staff_token, inside_lat, inside_lon)
    assert rejected.status_code == 403

    restore = client.patch(
        f"/company-locations/{loc_id}",
        json={"latitude": OFFICE_LAT, "longitude": OFFICE_LON},
        headers=_auth(admin_token),
    )
    assert restore.status_code == 200, restore.text

    ok = _geo_clock_in(client, staff_token, inside_lat, inside_lon)
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] in ("present", "late")


def test_geo_clock_in_after_reassign_to_second_location(client, admin_token):
    staff_token, user_id = _create_staff_user(client, admin_token)
    emp_id = _create_monthly_employee(client, admin_token, user_id)
    loc_a = _create_location(client, admin_token)
    loc_b = _create_location(client, admin_token)

    _assign_location(client, admin_token, emp_id, loc_a)
    at_a_lat, at_a_lon = _offset_north_meters(OFFICE_LAT, OFFICE_LON, 10)
    at_b_lat, at_b_lon = _offset_north_meters(OFFICE_LAT, OFFICE_LON, 10)

    r_a = _geo_clock_in(client, staff_token, at_a_lat, at_a_lon)
    assert r_a.status_code == 200, r_a.text

    _assign_location(client, admin_token, emp_id, loc_b)
    r_b = _geo_clock_in(client, staff_token, at_b_lat, at_b_lon)
    assert r_b.status_code == 200, r_b.text
    assert r_b.json()["status"] == "already_marked"


def test_geo_clock_in_factory_location_assignment_endpoint(client, admin_token, factory_token):
    """Factory role uses /location-assignment; geo validation must honor that assignment."""
    staff_token, user_id = _create_staff_user(client, admin_token)
    emp_id = _create_monthly_employee(client, admin_token, user_id)
    loc_id = _create_location(client, admin_token)

    assign = client.patch(
        f"/employees/{emp_id}/location-assignment",
        json={"location_id": loc_id},
        headers=_auth(factory_token),
    )
    assert assign.status_code == 200, assign.text
    assert assign.json()["work_location_id"] == loc_id

    lat, lon = _offset_north_meters(OFFICE_LAT, OFFICE_LON, 10)
    r = _geo_clock_in(client, staff_token, lat, lon)
    assert r.status_code == 200, r.text


def test_delete_location_with_multiple_assignees(client, admin_token):
    loc_id = _create_location(client, admin_token)
    emp_a = _create_monthly_employee(client, admin_token, _create_staff_user(client, admin_token)[1])
    emp_b = _create_monthly_employee(client, admin_token, _create_staff_user(client, admin_token)[1])
    _assign_location(client, admin_token, emp_a, loc_id)
    _assign_location(client, admin_token, emp_b, loc_id)

    r = client.delete(f"/company-locations/{loc_id}", headers=_auth(admin_token))
    assert r.status_code == 200, r.text
    assert r.json()["employees_unassigned"] == 2

    list_r = client.get("/company-locations", headers=_auth(admin_token))
    assert list_r.status_code == 200
    assert loc_id not in {row["id"] for row in list_r.json()}
