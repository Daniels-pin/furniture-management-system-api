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
    MIN_ATTENDANCE_SESSION_MINUTES,
    _GEO_VALIDATION_BUFFER_METERS,
    _MAX_GPS_ACCURACY_CONTRIBUTION_METERS,
    _effective_geo_radius_meters,
    _haversine_meters,
    _is_sunday,
    _late_minutes,
    _resolve_attendance_status,
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


def _create_location(
    client,
    admin_token: str,
    *,
    late_attendance_time: str = "08:15",
    check_out_time: str = "17:00",
) -> int:
    r = client.post(
        "/company-locations",
        json={
            "name": f"Site-{uuid.uuid4().hex[:6]}",
            "latitude": OFFICE_LAT,
            "longitude": OFFICE_LON,
            "allowed_radius_meters": RADIUS_M,
            "late_attendance_time": late_attendance_time,
            "check_out_time": check_out_time,
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


def _geo_clock_out(client, token: str, lat: float, lon: float):
    return client.post(
        "/employees/me/attendance/clock-out-geo",
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
    assert second.json()["status"] == "already_checked_in"
    assert "already checked in" in second.json()["message"].lower()


def test_geo_clock_in_sunday_excluded(client, geo_employee):
    sunday = datetime(2026, 5, 17, 9, 0, 0, tzinfo=LAGOS)

    with patch("app.routes.employees.now_lagos", return_value=sunday):
        r = _geo_clock_in(client, geo_employee["staff_token"], OFFICE_LAT, OFFICE_LON)

    assert r.status_code == 200, r.text
    assert r.json()["status"] == "sunday"
    assert "Sundays are excluded" in r.json()["message"]
    assert r.json()["entry"] is None


def test_geo_clock_in_late_creates_lateness_entry(client, geo_employee, db_session):
    late_morning = datetime(2026, 5, 15, 8, 16, 0, tzinfo=LAGOS)

    with patch("app.routes.employees.now_lagos", return_value=late_morning):
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
    with patch("app.routes.employees.now_lagos", return_value=late_morning):
        again = _geo_clock_in(client, geo_employee["staff_token"], OFFICE_LAT, OFFICE_LON)
    assert again.json()["status"] == "already_checked_in"


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


def test_effective_geo_radius_uses_reported_accuracy():
    assert _effective_geo_radius_meters(100, 50.0) == 150.0
    assert _effective_geo_radius_meters(100, 5.0) == 100 + _GEO_VALIDATION_BUFFER_METERS
    capped = _MAX_GPS_ACCURACY_CONTRIBUTION_METERS + 100
    assert _effective_geo_radius_meters(100, 500.0) == capped


def test_geo_clock_in_inside_radius_with_high_gps_uncertainty(client, geo_employee):
    """When the device reports large horizontal accuracy, validation should allow clock-in within that envelope."""
    lat, lon = _offset_north_meters(OFFICE_LAT, OFFICE_LON, RADIUS_M + 30)
    r = client.post(
        "/employees/me/attendance/clock-in-geo",
        json={"latitude": lat, "longitude": lon, "accuracy_meters": 80},
        headers=_auth(geo_employee["staff_token"]),
    )
    assert r.status_code == 200, r.text


def test_geo_clock_in_desktop_uncertainty_without_accuracy(client, geo_employee):
    """Without reported accuracy only the 15m buffer applies; with client fallback accuracy, in-radius fixes succeed."""
    lat, lon = _offset_north_meters(OFFICE_LAT, OFFICE_LON, RADIUS_M + 25)
    no_accuracy = client.post(
        "/employees/me/attendance/clock-in-geo",
        json={"latitude": lat, "longitude": lon},
        headers=_auth(geo_employee["staff_token"]),
    )
    assert no_accuracy.status_code == 403

    with_fallback = client.post(
        "/employees/me/attendance/clock-in-geo",
        json={"latitude": lat, "longitude": lon, "accuracy_meters": 75},
        headers=_auth(geo_employee["staff_token"]),
    )
    assert with_fallback.status_code == 200, with_fallback.text


def test_geo_clock_in_tight_radius_needs_accuracy_envelope(client, admin_token):
    """Small site radius (e.g. 20m) requires GPS accuracy tolerance; buffer-only is too strict for real devices."""
    staff_token, user_id = _create_staff_user(client, admin_token)
    emp_id = _create_monthly_employee(client, admin_token, user_id)
    tight_radius = 20
    r = client.post(
        "/company-locations",
        json={
            "name": f"Tight-{uuid.uuid4().hex[:6]}",
            "latitude": OFFICE_LAT,
            "longitude": OFFICE_LON,
            "allowed_radius_meters": tight_radius,
        },
        headers=_auth(admin_token),
    )
    assert r.status_code == 200, r.text
    loc_id = r.json()["id"]
    _assign_location(client, admin_token, emp_id, loc_id)

    # 40m from center: outside buffer-only (20+15=35m) but inside accuracy envelope (20+75=95m).
    lat, lon = _offset_north_meters(OFFICE_LAT, OFFICE_LON, 40)
    buffer_only = client.post(
        "/employees/me/attendance/clock-in-geo",
        json={"latitude": lat, "longitude": lon},
        headers=_auth(staff_token),
    )
    assert buffer_only.status_code == 403

    with_accuracy = client.post(
        "/employees/me/attendance/clock-in-geo",
        json={"latitude": lat, "longitude": lon, "accuracy_meters": 75},
        headers=_auth(staff_token),
    )
    assert with_accuracy.status_code == 200, with_accuracy.text


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
    assert r_b.json()["status"] == "already_checked_in"


def test_geo_clock_in_factory_location_assignment_endpoint(client, admin_token, factory_token):
    """Only Admin may assign locations; factory role is denied."""
    staff_token, user_id = _create_staff_user(client, admin_token)
    emp_id = _create_monthly_employee(client, admin_token, user_id)
    loc_id = _create_location(client, admin_token)

    assign = client.patch(
        f"/employees/{emp_id}/location-assignment",
        json={"location_id": loc_id},
        headers=_auth(factory_token),
    )
    assert assign.status_code == 403, assign.text

    admin_assign = client.patch(
        f"/employees/{emp_id}/location-assignment",
        json={"location_id": loc_id},
        headers=_auth(admin_token),
    )
    assert admin_assign.status_code == 200, admin_assign.text
    assert admin_assign.json()["work_location_id"] == loc_id

    lat, lon = _offset_north_meters(OFFICE_LAT, OFFICE_LON, 10)
    r = _geo_clock_in(client, staff_token, lat, lon)
    assert r.status_code == 200, r.text


def test_geo_clock_in_uses_location_late_time(client, admin_token):
    """Lateness threshold follows the assigned location's configured late time."""
    staff_token, user_id = _create_staff_user(client, admin_token)
    emp_id = _create_monthly_employee(client, admin_token, user_id)
    loc_id = _create_location(client, admin_token, late_attendance_time="09:00")

    assign = client.patch(
        f"/employees/{emp_id}/location-assignment",
        json={"location_id": loc_id},
        headers=_auth(admin_token),
    )
    assert assign.status_code == 200, assign.text

    on_time = datetime(2026, 5, 15, 8, 45, 0, tzinfo=LAGOS)
    with patch("app.routes.employees.now_lagos", return_value=on_time):
        r = _geo_clock_in(client, staff_token, OFFICE_LAT, OFFICE_LON)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "present"
    assert r.json()["entry"]["is_late"] is False

    late = datetime(2026, 5, 15, 9, 1, 0, tzinfo=LAGOS)
    staff_token2, user_id2 = _create_staff_user(client, admin_token)
    emp_id2 = _create_monthly_employee(client, admin_token, user_id2)
    client.patch(
        f"/employees/{emp_id2}/location-assignment",
        json={"location_id": loc_id},
        headers=_auth(admin_token),
    )
    with patch("app.routes.employees.now_lagos", return_value=late):
        r2 = _geo_clock_in(client, staff_token2, OFFICE_LAT, OFFICE_LON)
    assert r2.status_code == 200, r2.text
    assert r2.json()["status"] == "late"
    assert r2.json()["entry"]["is_late"] is True
    assert r2.json()["entry"]["late_minutes"] == 1


def test_geo_clock_out_after_check_in(client, geo_employee):
    lat, lon = OFFICE_LAT, OFFICE_LON
    check_in = _geo_clock_in(client, geo_employee["staff_token"], lat, lon)
    assert check_in.status_code == 200, check_in.text

    check_out = _geo_clock_out(client, geo_employee["staff_token"], lat, lon)
    assert check_out.status_code == 200, check_out.text
    body = check_out.json()
    assert body["status"] == "checked_out"
    assert body["entry"]["check_out_at"] is not None
    assert body["entry"]["status"] in ("present", "late", "early_check_out", "late_early_check_out", "short_session")


def test_geo_clock_out_requires_check_in(client, geo_employee):
    r = _geo_clock_out(client, geo_employee["staff_token"], OFFICE_LAT, OFFICE_LON)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "not_checked_in"


def test_geo_clock_out_outside_radius(client, geo_employee):
    lat, lon = OFFICE_LAT, OFFICE_LON
    assert _geo_clock_in(client, geo_employee["staff_token"], lat, lon).status_code == 200

    outside_lat, outside_lon = _offset_north_meters(OFFICE_LAT, OFFICE_LON, RADIUS_M + 50)
    r = _geo_clock_out(client, geo_employee["staff_token"], outside_lat, outside_lon)
    assert r.status_code == 403
    assert "within your assigned work location" in r.json()["detail"]


def test_geo_clock_out_duplicate(client, geo_employee):
    lat, lon = OFFICE_LAT, OFFICE_LON
    assert _geo_clock_in(client, geo_employee["staff_token"], lat, lon).status_code == 200
    assert _geo_clock_out(client, geo_employee["staff_token"], lat, lon).status_code == 200

    again = _geo_clock_out(client, geo_employee["staff_token"], lat, lon)
    assert again.status_code == 200, again.text
    assert again.json()["status"] == "already_checked_out"


def test_attendance_history_incomplete_day(client, geo_employee):
    morning = datetime(2026, 5, 14, 8, 0, 0, tzinfo=LAGOS)
    with patch("app.routes.employees.now_lagos", return_value=morning):
        assert _geo_clock_in(client, geo_employee["staff_token"], OFFICE_LAT, OFFICE_LON).status_code == 200

    today = datetime(2026, 5, 15, 10, 0, 0, tzinfo=LAGOS)
    with patch("app.routes.employees.now_lagos", return_value=today):
        history = client.get("/employees/me/attendance", headers=_auth(geo_employee["staff_token"]))
    assert history.status_code == 200, history.text
    rows = history.json()
    incomplete = next((x for x in rows if x["attendance_date"] == "2026-05-14"), None)
    assert incomplete is not None
    assert incomplete["status"] == "incomplete_day"
    assert incomplete["check_in_at"] is not None
    assert incomplete["check_out_at"] is None


def test_location_check_out_time_configurable(client, admin_token):
    loc_id = _create_location(client, admin_token)
    updated = client.patch(
        f"/company-locations/{loc_id}",
        json={"check_out_time": "18:00"},
        headers=_auth(admin_token),
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["check_out_time"] == "18:00"


def test_geo_clock_out_early_records_flag(client, geo_employee):
    morning = datetime(2026, 5, 16, 8, 0, 0, tzinfo=LAGOS)
    with patch("app.routes.employees.now_lagos", return_value=morning):
        assert _geo_clock_in(client, geo_employee["staff_token"], OFFICE_LAT, OFFICE_LON).status_code == 200

    early_leave = datetime(2026, 5, 16, 16, 10, 0, tzinfo=LAGOS)
    with patch("app.routes.employees.now_lagos", return_value=early_leave):
        check_out = _geo_clock_out(client, geo_employee["staff_token"], OFFICE_LAT, OFFICE_LON)
    assert check_out.status_code == 200, check_out.text
    entry = check_out.json()["entry"]
    assert entry["is_early_check_out"] is True
    assert entry["early_check_out_minutes"] == 50
    assert entry["expected_check_out_time"] == "17:00"
    assert entry["status"] == "early_check_out"
    assert entry["attendance_duration_minutes"] == 490
    assert float(entry["deduction_naira"]) == 0.0


def test_geo_clock_out_on_time_not_early(client, geo_employee):
    morning = datetime(2026, 5, 20, 8, 0, 0, tzinfo=LAGOS)
    with patch("app.routes.employees.now_lagos", return_value=morning):
        assert _geo_clock_in(client, geo_employee["staff_token"], OFFICE_LAT, OFFICE_LON).status_code == 200

    on_time = datetime(2026, 5, 20, 17, 5, 0, tzinfo=LAGOS)
    with patch("app.routes.employees.now_lagos", return_value=on_time):
        check_out = _geo_clock_out(client, geo_employee["staff_token"], OFFICE_LAT, OFFICE_LON)
    assert check_out.status_code == 200, check_out.text
    entry = check_out.json()["entry"]
    assert entry is not None
    assert entry["is_early_check_out"] is False
    assert entry["early_check_out_minutes"] is None
    assert entry["status"] == "present"
    assert entry["attendance_duration_minutes"] == 545


def test_geo_clock_out_early_uses_location_closing_time(client, admin_token):
    staff_token, user_id = _create_staff_user(client, admin_token)
    emp_id = _create_monthly_employee(client, admin_token, user_id)
    loc_id = _create_location(client, admin_token, check_out_time="18:00")
    _assign_location(client, admin_token, emp_id, loc_id)

    morning = datetime(2026, 5, 18, 8, 0, 0, tzinfo=LAGOS)
    with patch("app.routes.employees.now_lagos", return_value=morning):
        assert _geo_clock_in(client, staff_token, OFFICE_LAT, OFFICE_LON).status_code == 200

    early_leave = datetime(2026, 5, 18, 17, 30, 0, tzinfo=LAGOS)
    with patch("app.routes.employees.now_lagos", return_value=early_leave):
        check_out = _geo_clock_out(client, staff_token, OFFICE_LAT, OFFICE_LON)
    assert check_out.status_code == 200, check_out.text
    entry = check_out.json()["entry"]
    assert entry["is_early_check_out"] is True
    assert entry["early_check_out_minutes"] == 30
    assert entry["expected_check_out_time"] == "18:00"


def test_early_check_out_history_preserves_snapshot_after_location_update(client, admin_token, db_session):
    staff_token, user_id = _create_staff_user(client, admin_token)
    emp_id = _create_monthly_employee(client, admin_token, user_id)
    loc_id = _create_location(client, admin_token, check_out_time="17:00")
    _assign_location(client, admin_token, emp_id, loc_id)

    morning = datetime(2026, 5, 19, 8, 0, 0, tzinfo=LAGOS)
    with patch("app.routes.employees.now_lagos", return_value=morning):
        assert _geo_clock_in(client, staff_token, OFFICE_LAT, OFFICE_LON).status_code == 200

    early_leave = datetime(2026, 5, 19, 16, 0, 0, tzinfo=LAGOS)
    with patch("app.routes.employees.now_lagos", return_value=early_leave):
        assert _geo_clock_out(client, staff_token, OFFICE_LAT, OFFICE_LON).status_code == 200

    updated = client.patch(
        f"/company-locations/{loc_id}",
        json={"check_out_time": "20:00"},
        headers=_auth(admin_token),
    )
    assert updated.status_code == 200, updated.text

    history_day = datetime(2026, 5, 20, 10, 0, 0, tzinfo=LAGOS)
    with patch("app.routes.employees.now_lagos", return_value=history_day):
        history = client.get(f"/employees/{emp_id}/attendance", headers=_auth(admin_token))
    assert history.status_code == 200, history.text
    row = next((x for x in history.json() if x["attendance_date"] == "2026-05-19"), None)
    assert row is not None
    assert row["is_early_check_out"] is True
    assert row["expected_check_out_time"] == "17:00"
    assert row["early_check_out_minutes"] == 60


def test_early_check_out_does_not_add_payroll_deduction(client, geo_employee, db_session):
    late = datetime(2026, 5, 21, 8, 30, 0, tzinfo=LAGOS)
    with patch("app.routes.employees.now_lagos", return_value=late):
        check_in = _geo_clock_in(client, geo_employee["staff_token"], OFFICE_LAT, OFFICE_LON)
    assert check_in.status_code == 200, check_in.text
    assert check_in.json()["status"] == "late"

    early_leave = datetime(2026, 5, 21, 16, 30, 0, tzinfo=LAGOS)
    with patch("app.routes.employees.now_lagos", return_value=early_leave):
        check_out = _geo_clock_out(client, geo_employee["staff_token"], OFFICE_LAT, OFFICE_LON)
    assert check_out.status_code == 200, check_out.text
    entry = check_out.json()["entry"]
    assert entry["is_early_check_out"] is True
    assert entry["status"] == "late_early_check_out"
    assert float(entry["deduction_naira"]) == float(LATENESS_DEDUCTION_NAIRA)

    late_rows = (
        db_session.query(models.EmployeeLatenessEntry)
        .filter(
            models.EmployeeLatenessEntry.employee_id == geo_employee["employee_id"],
            models.EmployeeLatenessEntry.attendance_id == entry["id"],
            models.EmployeeLatenessEntry.voided_at.is_(None),
        )
        .all()
    )
    assert len(late_rows) == 1
    assert db_session.query(models.EmployeePenalty).filter_by(employee_id=geo_employee["employee_id"]).count() == 0


def test_resolve_attendance_status_priority():
    day = date(2026, 5, 26)
    today = date(2026, 5, 27)

    def row(**kwargs):
        base = {
            "is_late": False,
            "check_in_at": None,
            "check_out_at": None,
            "attendance_date": day,
            "is_early_check_out": False,
            "early_check_out_minutes": None,
            "expected_check_out_time": time(17, 0),
            "work_location": None,
        }
        base.update(kwargs)
        return type("Row", (), base)()

    assert _resolve_attendance_status(row(), today=today) == "incomplete_day"
    assert _resolve_attendance_status(row(attendance_date=today), today=today) == "checked_in"

    full_day = row(
        check_in_at=datetime(2026, 5, 26, 7, 35, tzinfo=LAGOS),
        check_out_at=datetime(2026, 5, 26, 17, 5, tzinfo=LAGOS),
    )
    assert _resolve_attendance_status(full_day, today=today) == "present"

    early = row(
        check_in_at=datetime(2026, 5, 26, 8, 0, tzinfo=LAGOS),
        check_out_at=datetime(2026, 5, 26, 15, 30, tzinfo=LAGOS),
        is_early_check_out=True,
        early_check_out_minutes=90,
    )
    assert _resolve_attendance_status(early, today=today) == "early_check_out"

    late = row(
        is_late=True,
        check_in_at=datetime(2026, 5, 26, 8, 20, tzinfo=LAGOS),
        check_out_at=datetime(2026, 5, 26, 17, 5, tzinfo=LAGOS),
    )
    assert _resolve_attendance_status(late, today=today) == "late"

    late_early = row(
        is_late=True,
        is_early_check_out=True,
        check_in_at=datetime(2026, 5, 26, 8, 20, tzinfo=LAGOS),
        check_out_at=datetime(2026, 5, 26, 15, 0, tzinfo=LAGOS),
    )
    assert _resolve_attendance_status(late_early, today=today) == "late_early_check_out"

    short = row(
        check_in_at=datetime(2026, 5, 26, 16, 58, tzinfo=LAGOS),
        check_out_at=datetime(2026, 5, 26, 17, 0, tzinfo=LAGOS),
    )
    assert _resolve_attendance_status(short, today=today) == "short_session"
    assert MIN_ATTENDANCE_SESSION_MINUTES == 30


def test_immediate_check_out_not_present(client, geo_employee):
    """A 1-minute session before closing must not be labeled Present."""
    check_in = datetime(2026, 5, 22, 3, 35, 0, tzinfo=LAGOS)
    with patch("app.routes.employees.now_lagos", return_value=check_in):
        assert _geo_clock_in(client, geo_employee["staff_token"], OFFICE_LAT, OFFICE_LON).status_code == 200

    check_out = datetime(2026, 5, 22, 3, 36, 0, tzinfo=LAGOS)
    with patch("app.routes.employees.now_lagos", return_value=check_out):
        r = _geo_clock_out(client, geo_employee["staff_token"], OFFICE_LAT, OFFICE_LON)
    assert r.status_code == 200, r.text
    entry = r.json()["entry"]
    assert entry["status"] == "early_check_out"
    assert entry["is_early_check_out"] is True
    assert entry["attendance_duration_minutes"] == 1
    assert entry["status"] != "present"


def test_late_and_early_check_out_combined_status(client, geo_employee):
    late_in = datetime(2026, 5, 23, 8, 20, 0, tzinfo=LAGOS)
    with patch("app.routes.employees.now_lagos", return_value=late_in):
        check_in = _geo_clock_in(client, geo_employee["staff_token"], OFFICE_LAT, OFFICE_LON)
    assert check_in.status_code == 200, check_in.text
    assert check_in.json()["status"] == "late"

    early_out = datetime(2026, 5, 23, 15, 0, 0, tzinfo=LAGOS)
    with patch("app.routes.employees.now_lagos", return_value=early_out):
        check_out = _geo_clock_out(client, geo_employee["staff_token"], OFFICE_LAT, OFFICE_LON)
    assert check_out.status_code == 200, check_out.text
    entry = check_out.json()["entry"]
    assert entry["status"] == "late_early_check_out"
    assert entry["is_late"] is True
    assert entry["is_early_check_out"] is True


def test_attendance_check_in_api_time_is_lagos(client, geo_employee, db_session):
    """Stored/API check-in instants must round-trip to the Lagos wall time used at clock-in."""
    from app.utils.timezone import to_lagos

    morning = datetime(2026, 5, 25, 8, 35, 0, tzinfo=LAGOS)
    with patch("app.routes.employees.now_lagos", return_value=morning):
        r = _geo_clock_in(client, geo_employee["staff_token"], OFFICE_LAT, OFFICE_LON)
    assert r.status_code == 200, r.text
    entry = r.json()["entry"]
    assert entry["check_in_at"] is not None

    att = db_session.query(models.EmployeeAttendanceEntry).filter(models.EmployeeAttendanceEntry.id == entry["id"]).first()
    assert att is not None
    local = to_lagos(att.check_in_at)
    assert local.hour == 8
    assert local.minute == 35


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
