"""Admin cancellation of unpaid payment transfers awaiting Finance."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from app import models


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _monthly_payment_txn(db_session, status: str) -> models.EmployeeTransaction:
    emp = models.Employee(full_name="Pay Test", base_salary=Decimal("100000"), deleted_at=None)
    db_session.add(emp)
    db_session.flush()
    period = models.SalaryPeriod(year=2026, month=5, label="May 2026", is_active=True)
    db_session.add(period)
    db_session.flush()
    txn = models.EmployeeTransaction(
        employee_id=emp.id,
        period_id=period.id,
        txn_type="payment",
        amount=Decimal("50000"),
        status=status,
        created_at=datetime.utcnow(),
    )
    db_session.add(txn)
    db_session.commit()
    db_session.refresh(txn)
    return txn


def test_cancel_pending_monthly_payment(client, admin_token, db_session):
    txn = _monthly_payment_txn(db_session, "pending")
    r = client.post(f"/employee-payments/{txn.id}/cancel-pending", headers=_auth(admin_token))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "cancelled"

    db_session.expire_all()
    row = db_session.query(models.EmployeeTransaction).filter(models.EmployeeTransaction.id == txn.id).first()
    assert row is not None
    assert row.status == "cancelled"
    assert row.cancelled_at is not None


def test_cancel_sent_to_finance_payment(client, admin_token, db_session):
    txn = _monthly_payment_txn(db_session, "sent_to_finance")
    r = client.post(f"/employee-payments/{txn.id}/cancel-pending", headers=_auth(admin_token))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "cancelled"


def test_cannot_cancel_paid_payment(client, admin_token, db_session):
    txn = _monthly_payment_txn(db_session, "paid")
    txn.paid_at = datetime.utcnow()
    db_session.commit()
    r = client.post(f"/employee-payments/{txn.id}/cancel-pending", headers=_auth(admin_token))
    assert r.status_code == 409
    assert "cannot be cancelled" in r.json()["detail"].lower()


def test_cancelled_payment_not_in_finance_queue(client, admin_token, db_session):
    txn = _monthly_payment_txn(db_session, "sent_to_finance")
    cancel = client.post(f"/employee-payments/{txn.id}/cancel-pending", headers=_auth(admin_token))
    assert cancel.status_code == 200, cancel.text

    pending = client.get(
        "/employee-payments/pending",
        params={"queue_only": True, "kind": "monthly"},
        headers=_auth(admin_token),
    )
    assert pending.status_code == 200, pending.text
    ids = {item["transaction"]["id"] for item in pending.json()["items"]}
    assert txn.id not in ids
