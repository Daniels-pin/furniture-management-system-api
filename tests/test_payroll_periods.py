"""Payroll period auto-advance and month-level payment status."""

from __future__ import annotations

import uuid
from unittest.mock import patch

from app import models
from app.routes.employees import LATENESS_DEDUCTION_NAIRA
from app.routes.employees import (
    MONTH_PAYMENT_PAID,
    MONTH_PAYMENT_PENDING,
    ensure_payroll_periods_current,
    get_active_period,
    get_or_create_period,
    _try_auto_mark_period_month_paid,
)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_employee(client, admin_token: str) -> int:
    r = client.post(
        "/employees",
        json={
            "full_name": f"Payroll Test {uuid.uuid4().hex[:6]}",
            "base_salary": "50000",
            "phone": "08012345678",
            "address": "Lagos",
            "bank_name": "Test Bank",
            "account_number": "0123456789",
        },
        headers=_auth(admin_token),
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_periods_nav_includes_month_payment_status(client, admin_token):
    r = client.get("/employees/periods", headers=_auth(admin_token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert "active_period" in body
    if body.get("active_period"):
        ap = body["active_period"]
        assert ap["month_payment_status"] in ("paid", "pending_payment")
        assert "paid_employee_count" in ap
        assert "total_employee_count" in ap


def test_mark_month_paid_endpoint(client, admin_token, db_session):
    emp_id = _create_employee(client, admin_token)
    nav = client.get("/employees/periods", headers=_auth(admin_token)).json()
    ap = nav["active_period"]
    assert ap is not None

    r = client.post(
        "/employees/periods/mark-month-paid",
        params={"period_year": ap["year"], "period_month": ap["month"]},
        headers=_auth(admin_token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["month_payment_status"] == "paid"

    nav2 = client.get("/employees/periods", headers=_auth(admin_token)).json()
    period = next(p for p in nav2["periods"] if p["year"] == ap["year"] and p["month"] == ap["month"])
    assert period["month_payment_status"] == "paid"


def test_auto_mark_month_when_all_employees_paid(client, admin_token, db_session):
    emp_id = _create_employee(client, admin_token)
    nav = client.get("/employees/periods", headers=_auth(admin_token)).json()
    ap = nav["active_period"]

    r = client.patch(
        f"/employees/{emp_id}/payment",
        params={"period_year": ap["year"], "period_month": ap["month"]},
        json={"payment_status": "paid"},
        headers=_auth(admin_token),
    )
    assert r.status_code == 200, r.text

    nav2 = client.get("/employees/periods", headers=_auth(admin_token)).json()
    period = next(p for p in nav2["periods"] if p["year"] == ap["year"] and p["month"] == ap["month"])
    assert period["month_payment_status"] == "paid"


def test_ensure_payroll_periods_current_advances_month(db_session):
    db = db_session
    db.query(models.SalaryPeriod).delete()
    db.query(models.Employee).delete()
    db.commit()

    emp = models.Employee(
        full_name="Advance Test",
        base_salary=50000,
        phone="08012345678",
        address="Lagos",
        bank_name="Test",
        account_number="123",
        created_at=__import__("datetime").datetime(2026, 3, 1),
    )
    db.add(emp)
    db.commit()

    march = get_or_create_period(db, 2026, 3)
    db.query(models.SalaryPeriod).update({models.SalaryPeriod.is_active: False})
    march.is_active = True
    db.commit()

    fake_now = __import__("datetime").datetime(2026, 5, 15, 9, 0, tzinfo=__import__("zoneinfo").ZoneInfo("Africa/Lagos"))

    with patch("app.routes.employees.now_lagos", return_value=fake_now):
        ensure_payroll_periods_current(db)
        db.commit()

    active = get_active_period(db)
    assert active is not None
    assert active.year == 2026 and active.month == 5

    april = db.query(models.SalaryPeriod).filter_by(year=2026, month=4).first()
    assert april is not None
    assert april.is_active is False


def test_payroll_adjustment_lateness_override_preserves_count(client, admin_token):
    emp_id = _create_employee(client, admin_token)
    nav = client.get("/employees/periods", headers=_auth(admin_token)).json()
    ap = nav["active_period"]
    period = {"period_year": ap["year"], "period_month": ap["month"]}

    for _ in range(2):
        r = client.post(f"/employees/{emp_id}/lateness", json={}, params=period, headers=_auth(admin_token))
        assert r.status_code == 200, r.text

    before = client.get(f"/employees/{emp_id}", params=period, headers=_auth(admin_token)).json()
    assert before["salary"]["lateness_count"] == 2
    auto = float(before["salary"]["lateness_deduction_auto"])
    assert auto == float(LATENESS_DEDUCTION_NAIRA * 2)

    r = client.patch(
        f"/employees/{emp_id}/payroll-adjustments",
        json={"lateness_deduction": "500"},
        params=period,
        headers=_auth(admin_token),
    )
    assert r.status_code == 200, r.text
    after = r.json()
    assert after["salary"]["lateness_count"] == 2
    assert len(after["lateness_entries"]) == 2
    assert float(after["salary"]["lateness_deduction"]) == 500.0
    assert float(after["salary"]["lateness_deduction_auto"]) == auto

    summary = client.get("/employees/payroll/summary", params=period, headers=_auth(admin_token)).json()
    assert float(summary["total_lateness_deductions"]) >= 500.0


def test_periods_nav_starts_from_first_employee_month(client, admin_token, db_session):
    db = db_session
    db.query(models.EmployeePeriodPayroll).delete()
    db.query(models.EmployeeLatenessEntry).delete()
    db.query(models.EmployeeAbsenceEntry).delete()
    db.query(models.EmployeePenalty).delete()
    db.query(models.EmployeeBonus).delete()
    db.query(models.SalaryPeriod).delete()
    db.query(models.Employee).delete()
    db.commit()

    emp = models.Employee(
        full_name="First Hire",
        base_salary=100000,
        phone="08012345678",
        address="Lagos",
        bank_name="Test",
        account_number="999",
        created_at=__import__("datetime").datetime(2026, 3, 15),
    )
    db.add(emp)
    db.commit()

    r = client.get("/employees/periods", headers=_auth(admin_token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["active_period"] is not None
    labels = [p["label"] for p in body["periods"]]
    assert not any("January 2026" in x or "February 2026" in x for x in labels)


def test_archived_summary_uses_period_roster_not_future_employees(client, admin_token, db_session):
    emp_a = _create_employee(client, admin_token)
    nav = client.get("/employees/periods", headers=_auth(admin_token)).json()
    ap = nav["active_period"]
    period = {"period_year": ap["year"], "period_month": ap["month"]}

    summary_before = client.get("/employees/payroll/summary", params=period, headers=_auth(admin_token)).json()
    assert summary_before["employee_count"] == 1

    r = client.post("/employees/periods/start-next-month", headers=_auth(admin_token))
    assert r.status_code == 200, r.text

    emp_b = _create_employee(client, admin_token)
    assert emp_b != emp_a

    archived = client.get(
        "/employees/payroll/summary",
        params={"period_year": ap["year"], "period_month": ap["month"]},
        headers=_auth(admin_token),
    ).json()
    assert archived["employee_count"] == 1
    assert float(archived["total_base_salary"]) == float(summary_before["total_base_salary"])


def test_no_attendance_deductions_without_work_location(client, admin_token):
    emp_id = _create_employee(client, admin_token)
    nav = client.get("/employees/periods", headers=_auth(admin_token)).json()
    ap = nav["active_period"]
    period = {"period_year": ap["year"], "period_month": ap["month"]}

    late = client.post(
        f"/employees/{emp_id}/lateness",
        params=period,
        json={"note": "Manual late"},
        headers=_auth(admin_token),
    )
    assert late.status_code == 200, late.text

    detail = client.get(f"/employees/{emp_id}", params=period, headers=_auth(admin_token)).json()
    salary = detail["salary"]
    assert len(detail["lateness_entries"]) == 1
    assert salary["attendance_deductions_eligible"] is False
    assert float(salary["lateness_deduction"]) == 0.0
    assert float(salary["absence_deduction"]) == 0.0
    assert float(salary["final_payable"]) == float(salary["base_salary"])

    summary = client.get("/employees/payroll/summary", params=period, headers=_auth(admin_token)).json()
    assert float(summary["total_lateness_deductions"]) == 0.0
    assert float(summary["total_absence_deductions"]) == 0.0
