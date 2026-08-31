"""Tests for attendance deduction waiver system."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from app import models
from app.routes.employees import _lateness_deduction_sum_for_payroll
from app.utils.timezone import lagos_today


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_location(client, admin_token: str) -> int:
    r = client.post(
        "/company-locations",
        json={
            "name": f"Loc-{uuid.uuid4().hex[:6]}",
            "latitude": 6.5244,
            "longitude": 3.3792,
            "allowed_radius_meters": 100,
            "late_attendance_time": "08:15",
            "check_out_time": "17:00",
            "late_coming_fee_naira": "500",
            "early_sign_out_fee_naira": "500",
            "absence_fee_naira": "1000",
        },
        headers=_auth(admin_token),
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _create_employee(client, admin_token: str, location_id: int) -> int:
    r = client.post(
        "/employees",
        json={
            "full_name": "Waiver Test Employee",
            "base_salary": "100000",
            "phone": "08012345678",
            "address": "Test Address",
            "bank_name": "Test Bank",
            "account_number": "0123456789",
        },
        headers=_auth(admin_token),
    )
    assert r.status_code == 200, r.text
    emp_id = r.json()["id"]
    r2 = client.patch(
        f"/employees/{emp_id}/work-location",
        json={"location_id": location_id},
        headers=_auth(admin_token),
    )
    assert r2.status_code == 200, r2.text
    return emp_id


def _get_or_create_period(db_session, year: int, month: int) -> models.SalaryPeriod:
    period = (
        db_session.query(models.SalaryPeriod)
        .filter(models.SalaryPeriod.year == year, models.SalaryPeriod.month == month)
        .first()
    )
    if period is not None:
        return period
    period = models.SalaryPeriod(year=year, month=month, label=f"{month}/{year}", is_active=True)
    db_session.add(period)
    db_session.flush()
    return period


def _seed_lateness(db_session, emp_id: int, att_date: date) -> models.SalaryPeriod:
    period = _get_or_create_period(db_session, att_date.year, att_date.month)
    att = models.EmployeeAttendanceEntry(
        employee_id=emp_id,
        period_id=period.id,
        attendance_date=att_date,
        check_in_at=att_date,
        is_late=True,
        late_minutes=10,
    )
    db_session.add(att)
    db_session.flush()
    db_session.add(
        models.EmployeeLatenessEntry(
            employee_id=emp_id,
            period_id=period.id,
            attendance_id=att.id,
            deduction_amount_naira=Decimal("500"),
        )
    )
    db_session.commit()
    return period


def test_individual_waiver_credits_payroll_and_creates_transaction(client, admin_token, db_session):
    loc_id = _create_location(client, admin_token)
    emp_id = _create_employee(client, admin_token, loc_id)
    att_date = lagos_today()
    period = _seed_lateness(db_session, emp_id, att_date)

    emp = db_session.query(models.Employee).filter(models.Employee.id == emp_id).first()
    assert _lateness_deduction_sum_for_payroll(db_session, emp, period.id) == Decimal("500")

    r = client.post(
        "/employees/attendance/waiver",
        json={
            "employee_id": emp_id,
            "attendance_date": str(att_date),
            "waive_late": True,
            "reason_code": "heavy_rain",
        },
        headers=_auth(admin_token),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["waivers"]) == 1
    assert body["waivers"][0]["deduction_type"] == "late"

    db_session.expire_all()
    assert _lateness_deduction_sum_for_payroll(db_session, emp, period.id) == Decimal("0")

    txns = (
        db_session.query(models.EmployeeTransaction)
        .filter(models.EmployeeTransaction.employee_id == emp_id)
        .all()
    )
    assert len(txns) == 1
    assert txns[0].txn_type == "owed_increase"
    assert Decimal(str(txns[0].amount)) == Decimal("500")
    assert "Attendance Deduction Waived" in (txns[0].note or "")


def test_waiver_blocked_when_month_paid(client, admin_token, db_session):
    loc_id = _create_location(client, admin_token)
    emp_id = _create_employee(client, admin_token, loc_id)
    att_date = lagos_today()
    period = _seed_lateness(db_session, emp_id, att_date)
    period.month_payment_status = "paid"
    db_session.commit()

    r = client.post(
        "/employees/attendance/waiver",
        json={
            "employee_id": emp_id,
            "attendance_date": str(att_date),
            "waive_late": True,
            "reason_code": "public_holiday",
        },
        headers=_auth(admin_token),
    )
    assert r.status_code == 409, r.text


def test_waiver_reversal_reapplies_deduction(client, admin_token, db_session):
    loc_id = _create_location(client, admin_token)
    emp_id = _create_employee(client, admin_token, loc_id)
    att_date = lagos_today()
    period = _seed_lateness(db_session, emp_id, att_date)

    create = client.post(
        "/employees/attendance/waiver",
        json={
            "employee_id": emp_id,
            "attendance_date": str(att_date),
            "waive_late": True,
            "reason_code": "management_approval",
        },
        headers=_auth(admin_token),
    )
    assert create.status_code == 200, create.text
    waiver_id = create.json()["waivers"][0]["id"]

    emp = db_session.query(models.Employee).filter(models.Employee.id == emp_id).first()
    assert _lateness_deduction_sum_for_payroll(db_session, emp, period.id) == Decimal("0")

    rev = client.post(
        f"/employees/attendance/waivers/{waiver_id}/reverse",
        json={"reversal_reason": "Applied in error"},
        headers=_auth(admin_token),
    )
    assert rev.status_code == 200, rev.text

    db_session.expire_all()
    assert _lateness_deduction_sum_for_payroll(db_session, emp, period.id) == Decimal("500")


def test_factory_role_cannot_waive(client, factory_token, admin_token, db_session):
    loc_id = _create_location(client, admin_token)
    emp_id = _create_employee(client, admin_token, loc_id)
    att_date = lagos_today()
    _seed_lateness(db_session, emp_id, att_date)

    r = client.post(
        "/employees/attendance/waiver",
        json={
            "employee_id": emp_id,
            "attendance_date": str(att_date),
            "waive_late": True,
            "reason_code": "heavy_rain",
        },
        headers=_auth(factory_token),
    )
    assert r.status_code == 403, r.text
