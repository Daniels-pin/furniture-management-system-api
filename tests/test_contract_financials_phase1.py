"""Phase 1 contract financial fixes: atomic manual adjust, chronological running_balance."""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

from app import models
from app.utils.contract_employee_ledger import build_contract_employee_ledger
from app.utils.contract_financials import recalculate_contract_employee_financials


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_ce(db_session, *, name: str = "Phase1 Worker") -> models.ContractEmployee:
    ce = models.ContractEmployee(
        full_name=name,
        status="active",
        balance=Decimal("0"),
        total_owed=Decimal("0"),
        total_paid=Decimal("0"),
    )
    db_session.add(ce)
    db_session.flush()
    return ce


def test_recalculate_sets_chronological_running_balance(db_session):
    ce = _make_ce(db_session)
    base = datetime(2026, 7, 1, 10, 0, 0)

    t1 = models.EmployeeTransaction(
        contract_employee_id=ce.id,
        txn_type="owed_increase",
        amount=Decimal("100000"),
        status="paid",
        created_at=base,
        paid_at=base,
    )
    t2 = models.EmployeeTransaction(
        contract_employee_id=ce.id,
        txn_type="payment",
        amount=Decimal("40000"),
        status="paid",
        created_at=base + timedelta(hours=1),
        paid_at=base + timedelta(hours=1),
        processed_by_role="finance",
    )
    db_session.add_all([t1, t2])
    db_session.commit()

    recalculate_contract_employee_financials(db_session, ce.id, commit=True)
    db_session.refresh(t1)
    db_session.refresh(t2)

    assert t1.running_balance == Decimal("100000")
    assert t2.running_balance == Decimal("60000")
    assert t1.running_balance != t2.running_balance


def test_manual_increase_atomic_updates_balance(client, admin_token, db_session):
    ce = _make_ce(db_session, name="Increase Worker")
    db_session.commit()

    res = client.post(
        f"/contract-employees/{ce.id}/owed/increase",
        json={"amount": "25000", "note": "Bonus adjustment"},
        headers=_auth(admin_token),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert Decimal(str(body["balance"])) == Decimal("25000")

    db_session.refresh(ce)
    assert ce.balance == Decimal("25000")
    assert ce.total_owed == Decimal("25000")


def test_manual_decrease_atomic_with_prior_payment(client, admin_token, db_session):
    ce = _make_ce(db_session, name="Decrease Worker")
    base = datetime(2026, 7, 2, 10, 0, 0)
    db_session.add(
        models.EmployeeTransaction(
            contract_employee_id=ce.id,
            txn_type="owed_increase",
            amount=Decimal("80000"),
            status="paid",
            created_at=base,
            paid_at=base,
        )
    )
    db_session.commit()
    recalculate_contract_employee_financials(db_session, ce.id, commit=True)

    res = client.post(
        f"/contract-employees/{ce.id}/owed/decrease",
        json={"amount": "15000", "note": "Equipment deduction"},
        headers=_auth(admin_token),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert Decimal(str(body["balance"])) == Decimal("65000")

    db_session.refresh(ce)
    assert ce.balance == Decimal("65000")
    assert ce.total_owed == Decimal("65000")


def test_reversed_original_shows_credit_but_flat_balance(db_session):
    """Reversed pair nets to zero (Option A symmetric); original still shows credit for UI."""
    ce = _make_ce(db_session)
    base = datetime(2026, 7, 3, 10, 0, 0)

    orig = models.EmployeeTransaction(
        contract_employee_id=ce.id,
        txn_type="owed_increase",
        amount=Decimal("50000"),
        status="paid",
        created_at=base,
        paid_at=base,
        note="Job #1 accepted",
        contract_job_id=None,
    )
    db_session.add(orig)
    db_session.flush()

    rev = models.EmployeeTransaction(
        contract_employee_id=ce.id,
        txn_type="reversal",
        amount=Decimal("50000"),
        status="paid",
        created_at=base + timedelta(hours=1),
        paid_at=base + timedelta(hours=1),
        reversal_of_id=orig.id,
    )
    db_session.add(rev)
    db_session.commit()

    entries = build_contract_employee_ledger(db_session, ce.id)
    assert len(entries) == 2

    orig_entry = entries[0]
    rev_entry = entries[1]

    assert orig_entry.credit == Decimal("50000")
    assert orig_entry.balance_before == Decimal("0")
    assert orig_entry.balance_after == Decimal("50000")

    assert int(rev_entry.transaction.reversal_of_id) == int(orig.id)
    assert rev_entry.debit == Decimal("50000")
    assert rev_entry.balance_before == Decimal("50000")
    assert rev_entry.balance_after == Decimal("0")

    recalculate_contract_employee_financials(db_session, ce.id, commit=True)
    db_session.refresh(ce)
    assert ce.balance == Decimal("0")
