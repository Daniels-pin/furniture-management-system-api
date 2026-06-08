"""Transaction-based payroll adjustments (bonus, deduction, increment)."""

from __future__ import annotations

import uuid

from decimal import Decimal


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_employee(client, admin_token: str, base_salary: str = "100000") -> int:
    r = client.post(
        "/employees",
        json={
            "full_name": f"Adj Test {uuid.uuid4().hex[:6]}",
            "base_salary": base_salary,
            "phone": "08012345678",
            "address": "Lagos",
            "bank_name": "Test Bank",
            "account_number": "0123456789",
        },
        headers=_auth(admin_token),
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _active_period(client, admin_token: str) -> tuple[int, int]:
    nav = client.get("/employees/periods", headers=_auth(admin_token)).json()
    ap = nav["active_period"]
    assert ap is not None
    return ap["year"], ap["month"]


def test_payroll_adjustment_transactions_accumulate(client, admin_token):
    emp_id = _create_employee(client, admin_token)
    year, month = _active_period(client, admin_token)
    params = {"period_year": year, "period_month": month}

    r1 = client.post(
        f"/employees/{emp_id}/payroll-adjustment-transactions",
        json={"adjustment_type": "bonus", "amount": "2000", "reason": "Performance"},
        headers=_auth(admin_token),
        params=params,
    )
    assert r1.status_code == 200, r1.text
    body1 = r1.json()
    assert len(body1["payroll_adjustments"]) == 1
    assert Decimal(str(body1["salary"]["bonuses_total"])) == Decimal("2000")
    assert Decimal(str(body1["salary"]["final_payable"])) == Decimal("102000")

    r2 = client.post(
        f"/employees/{emp_id}/payroll-adjustment-transactions",
        json={"adjustment_type": "bonus", "amount": "1000", "reason": "Overtime"},
        headers=_auth(admin_token),
        params=params,
    )
    assert r2.status_code == 200, r2.text
    body2 = r2.json()
    assert len(body2["payroll_adjustments"]) == 2
    assert Decimal(str(body2["salary"]["bonuses_total"])) == Decimal("3000")
    assert Decimal(str(body2["salary"]["final_payable"])) == Decimal("103000")

    r3 = client.post(
        f"/employees/{emp_id}/payroll-adjustment-transactions",
        json={"adjustment_type": "deduction", "amount": "500", "reason": "Uniform"},
        headers=_auth(admin_token),
        params=params,
    )
    assert r3.status_code == 200, r3.text
    body3 = r3.json()
    assert Decimal(str(body3["salary"]["penalties_total"])) == Decimal("500")
    assert Decimal(str(body3["salary"]["final_payable"])) == Decimal("102500")


def test_payroll_adjustment_edit_and_delete_recalculates(client, admin_token):
    emp_id = _create_employee(client, admin_token)
    year, month = _active_period(client, admin_token)
    params = {"period_year": year, "period_month": month}

    created = client.post(
        f"/employees/{emp_id}/payroll-adjustment-transactions",
        json={"adjustment_type": "increment", "amount": "1500", "reason": "Salary review"},
        headers=_auth(admin_token),
        params=params,
    )
    assert created.status_code == 200, created.text
    adj_id = created.json()["payroll_adjustments"][0]["id"]
    assert Decimal(str(created.json()["salary"]["increments_total"])) == Decimal("1500")
    assert Decimal(str(created.json()["salary"]["final_payable"])) == Decimal("101500")

    updated = client.patch(
        f"/employees/{emp_id}/payroll-adjustment-transactions/{adj_id}",
        json={"amount": "2000"},
        headers=_auth(admin_token),
        params=params,
    )
    assert updated.status_code == 200, updated.text
    assert Decimal(str(updated.json()["salary"]["increments_total"])) == Decimal("2000")
    assert Decimal(str(updated.json()["salary"]["final_payable"])) == Decimal("102000")

    deleted = client.delete(
        f"/employees/{emp_id}/payroll-adjustment-transactions/{adj_id}",
        headers=_auth(admin_token),
        params=params,
    )
    assert deleted.status_code == 200, deleted.text
    assert len(deleted.json()["payroll_adjustments"]) == 0
    assert Decimal(str(deleted.json()["salary"]["final_payable"])) == Decimal("100000")
