"""Finance pending payments queue (GET /employee-payments/pending)."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

import pytest

from app import models


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _contract_pending_txn(db_session, *, status: str = "sent_to_finance") -> models.EmployeeTransaction:
    ce = models.ContractEmployee(
        full_name="Pending CE",
        status="active",
        balance=Decimal("0"),
        total_paid=Decimal("0"),
    )
    db_session.add(ce)
    db_session.flush()
    txn = models.EmployeeTransaction(
        contract_employee_id=ce.id,
        txn_type="payment",
        amount=Decimal("25000"),
        status=status,
        created_at=datetime.utcnow(),
    )
    db_session.add(txn)
    db_session.commit()
    db_session.refresh(txn)
    return txn


def test_pending_queue_contract_finance_user(client, db_session, admin_token):
    txn = _contract_pending_txn(db_session)
    r = client.get(
        "/employee-payments/pending",
        params={"kind": "contract", "queue_only": True, "sort": "oldest", "limit": 20, "offset": 0},
        headers=_auth(admin_token),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] >= 1
    ids = {it["transaction"]["id"] for it in body["items"]}
    assert txn.id in ids
    match = next(it for it in body["items"] if it["transaction"]["id"] == txn.id)
    assert match["employee_kind"] == "contract"
    assert match["employee_name"] == "Pending CE"


def test_pending_empty_search_returns_200(client, admin_token, db_session):
    _contract_pending_txn(db_session)
    r = client.get(
        "/employee-payments/pending",
        params={"kind": "contract", "queue_only": True, "search": "No Such Employee Name"},
        headers=_auth(admin_token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["total"] == 0
    assert r.json()["items"] == []


def test_pending_missing_monthly_employee_shows_deleted_label(client, admin_token, db_session):
    emp = models.Employee(
        full_name="Gone Soon",
        base_salary=Decimal("100000"),
        deleted_at=datetime.utcnow(),
    )
    db_session.add(emp)
    db_session.flush()
    txn = models.EmployeeTransaction(
        employee_id=emp.id,
        txn_type="payment",
        amount=Decimal("100"),
        status="sent_to_finance",
        created_at=datetime.utcnow(),
    )
    db_session.add(txn)
    db_session.commit()
    txn_id = txn.id

    r = client.get(
        "/employee-payments/pending",
        params={"kind": "monthly", "queue_only": True},
        headers=_auth(admin_token),
    )
    assert r.status_code == 200, r.text
    row = next((it for it in r.json()["items"] if it["transaction"]["id"] == txn_id), None)
    assert row is not None
    assert row["employee_name"] == "Deleted User"


def test_pending_sum_query_compiles_without_order_by(db_session):
    """Regression: PostgreSQL rejects SUM() when ORDER BY is on the same query."""
    from sqlalchemy import func
    from sqlalchemy.dialects import postgresql

    q = db_session.query(models.EmployeeTransaction).filter(
        models.EmployeeTransaction.txn_type == "payment",
        models.EmployeeTransaction.status.in_(["sent_to_finance", "pending"]),
        models.EmployeeTransaction.contract_employee_id.isnot(None),
    )
    sum_stmt = q.with_entities(func.coalesce(func.sum(models.EmployeeTransaction.amount), 0)).statement
    compiled = str(sum_stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
    assert "order by" not in compiled.lower()

    ordered = q.order_by(models.EmployeeTransaction.created_at.asc()).statement
    ordered_sql = str(ordered.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
    assert "order by" in ordered_sql.lower()
