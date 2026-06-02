"""Attendance cutoff: per-location cutoff enforcement + auto-absence processing."""

from __future__ import annotations

import uuid
from datetime import datetime, time
from decimal import Decimal
from unittest.mock import patch

from zoneinfo import ZoneInfo

from app import models
from app.utils.attendance_cutoff import process_due_attendance_cutoffs

LAGOS = ZoneInfo("Africa/Lagos")


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_staff_user(client, admin_token: str) -> tuple[str, int]:
    email = f"staff_cutoff_{uuid.uuid4().hex[:8]}@test.com"
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
        json={"full_name": "Cutoff Test Employee", "user_id": user_id, "base_salary": "100000"},
        headers=_auth(admin_token),
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _create_location(client, admin_token: str, *, cutoff: str = "13:00", absence_fee: str = "1000") -> int:
    r = client.post(
        "/company-locations",
        json={
            "name": f"Cutoff Site-{uuid.uuid4().hex[:6]}",
            "latitude": 6.5244,
            "longitude": 3.3792,
            "allowed_radius_meters": 100,
            "late_attendance_time": "08:15",
            "attendance_cutoff_time": cutoff,
            "check_out_time": "17:00",
            "absence_fee_naira": absence_fee,
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


def _backdate_employee_hire(db, emp_id: int, *, year: int = 2026, month: int = 4) -> None:
    emp = db.query(models.Employee).filter_by(id=emp_id).one()
    emp.created_at = datetime(year, month, 1, 8, 0, 0)
    db.flush()
    from app.routes.employees import ensure_payroll_periods_current

    ensure_payroll_periods_current(db)
    db.commit()


def test_clock_in_blocked_after_location_cutoff(client, admin_token, db_session):
    staff_token, user_id = _create_staff_user(client, admin_token)
    emp_id = _create_monthly_employee(client, admin_token, user_id)
    loc_id = _create_location(client, admin_token, cutoff="13:00")
    _assign_location(client, admin_token, emp_id, loc_id)
    _backdate_employee_hire(db_session, emp_id)

    fake_now = datetime(2026, 5, 20, 13, 0, 0, tzinfo=LAGOS)
    with patch("app.routes.employees.now_lagos", return_value=fake_now):
        r = client.post(
            "/employees/me/attendance/clock-in-geo",
            json={"latitude": 6.5244, "longitude": 3.3792},
            headers=_auth(staff_token),
        )
    assert r.status_code == 409
    assert "Attendance cannot be marked" in r.text


def test_cutoff_processor_creates_absence_and_updates_payroll(client, admin_token, db_session):
    staff_token, user_id = _create_staff_user(client, admin_token)
    emp_id = _create_monthly_employee(client, admin_token, user_id)
    loc_id = _create_location(client, admin_token, cutoff="13:00", absence_fee="1000")
    _assign_location(client, admin_token, emp_id, loc_id)
    _backdate_employee_hire(db_session, emp_id)

    fake_now = datetime(2026, 5, 20, 13, 0, 0, tzinfo=LAGOS)
    res = process_due_attendance_cutoffs(db_session, at=fake_now)
    db_session.commit()
    assert res.locations_processed >= 1
    assert res.employees_marked_absent == 1

    # Employee salary breakdown should reflect absence deduction immediately.
    with patch("app.routes.employees.now_lagos", return_value=fake_now):
        detail = client.get(f"/employees/{emp_id}", headers=_auth(admin_token)).json()
    salary = detail["salary"]
    assert Decimal(str(salary["base_salary"])) == Decimal("100000")
    assert Decimal(str(salary["absence_deduction"])) == Decimal("1000")
    assert Decimal(str(salary["total_deductions"])) >= Decimal("1000")
    assert Decimal(str(salary["final_payable"])) == Decimal("99000")

