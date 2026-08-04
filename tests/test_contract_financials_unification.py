"""Regression tests for unified contract employee accounting rules."""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

import pytest

from app import models
from app.utils.contract_employee_ledger import build_contract_employee_ledger
from app.utils.contract_financials import (
    compute_contract_employee_financials,
    recalculate_contract_employee_financials,
)


def _make_ce(db_session, *, name: str = "Unify Worker") -> models.ContractEmployee:
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


def _make_job(
    db_session,
    ce: models.ContractEmployee,
    *,
    final_price: Decimal,
    status: str = "pending",
    accepted: bool = False,
) -> models.ContractJob:
    job = models.ContractJob(
        contract_employee_id=ce.id,
        description="Test job",
        final_price=final_price,
        price_accepted_at=datetime.utcnow() if accepted else None,
        status=status,
    )
    db_session.add(job)
    db_session.flush()
    return job


def _assert_invariant(db_session, ce_id: int) -> None:
    derived, _ = compute_contract_employee_financials(db_session, ce_id)
    entries = build_contract_employee_ledger(db_session, ce_id)
    ledger_final = entries[-1].balance_after if entries else Decimal("0")

    emp = db_session.query(models.ContractEmployee).filter(models.ContractEmployee.id == ce_id).one()
    assert emp.balance == derived.balance == ledger_final
    assert emp.balance == derived.total_owed - derived.total_paid


def test_manual_increase_then_reversal_nets_zero(db_session):
    ce = _make_ce(db_session)
    base = datetime(2026, 8, 1, 10, 0, 0)

    orig = models.EmployeeTransaction(
        contract_employee_id=ce.id,
        txn_type="owed_increase",
        amount=Decimal("30000"),
        status="paid",
        created_at=base,
        paid_at=base,
    )
    db_session.add(orig)
    db_session.flush()
    db_session.add(
        models.EmployeeTransaction(
            contract_employee_id=ce.id,
            txn_type="reversal",
            amount=Decimal("30000"),
            status="paid",
            created_at=base + timedelta(hours=1),
            paid_at=base + timedelta(hours=1),
            reversal_of_id=orig.id,
        )
    )
    db_session.commit()

    recalculate_contract_employee_financials(db_session, ce.id, commit=True)
    _assert_invariant(db_session, ce.id)


def test_manual_deduction_then_reversal_nets_zero(db_session):
    ce = _make_ce(db_session)
    base = datetime(2026, 8, 1, 11, 0, 0)

    db_session.add(
        models.EmployeeTransaction(
            contract_employee_id=ce.id,
            txn_type="owed_increase",
            amount=Decimal("50000"),
            status="paid",
            created_at=base,
            paid_at=base,
        )
    )
    db_session.flush()

    dec = models.EmployeeTransaction(
        contract_employee_id=ce.id,
        txn_type="owed_decrease",
        amount=Decimal("10000"),
        status="paid",
        created_at=base + timedelta(hours=1),
        paid_at=base + timedelta(hours=1),
    )
    db_session.add(dec)
    db_session.flush()
    db_session.add(
        models.EmployeeTransaction(
            contract_employee_id=ce.id,
            txn_type="reversal",
            amount=Decimal("10000"),
            status="paid",
            created_at=base + timedelta(hours=2),
            paid_at=base + timedelta(hours=2),
            reversal_of_id=dec.id,
        )
    )
    db_session.commit()

    recalculate_contract_employee_financials(db_session, ce.id, commit=True)
    derived, _ = compute_contract_employee_financials(db_session, ce.id)
    assert derived.balance == Decimal("50000")
    _assert_invariant(db_session, ce.id)


def test_job_accept_then_admin_reversal_without_cancel_nets_zero(db_session):
    ce = _make_ce(db_session)
    job = _make_job(db_session, ce, final_price=Decimal("80000"), accepted=True, status="pending")
    base = datetime(2026, 8, 2, 10, 0, 0)

    orig = models.EmployeeTransaction(
        contract_employee_id=ce.id,
        contract_job_id=job.id,
        txn_type="owed_increase",
        amount=Decimal("80000"),
        status="paid",
        created_at=base,
        paid_at=base,
        note=f"Job #{job.id} accepted",
    )
    db_session.add(orig)
    db_session.flush()
    db_session.add(
        models.EmployeeTransaction(
            contract_employee_id=ce.id,
            contract_job_id=job.id,
            txn_type="reversal",
            amount=Decimal("80000"),
            status="paid",
            created_at=base + timedelta(hours=1),
            paid_at=base + timedelta(hours=1),
            reversal_of_id=orig.id,
        )
    )
    db_session.commit()

    recalculate_contract_employee_financials(db_session, ce.id, commit=True)
    derived, _ = compute_contract_employee_financials(db_session, ce.id)
    assert derived.balance == Decimal("0")
    _assert_invariant(db_session, ce.id)


def test_job_accept_then_cancel_nets_zero(db_session):
    ce = _make_ce(db_session)
    job = _make_job(db_session, ce, final_price=Decimal("120000"), accepted=True, status="pending")
    base = datetime(2026, 8, 2, 12, 0, 0)

    orig = models.EmployeeTransaction(
        contract_employee_id=ce.id,
        contract_job_id=job.id,
        txn_type="owed_increase",
        amount=Decimal("120000"),
        status="paid",
        created_at=base,
        paid_at=base,
    )
    db_session.add(orig)
    db_session.flush()
    db_session.add(
        models.EmployeeTransaction(
            contract_employee_id=ce.id,
            contract_job_id=job.id,
            txn_type="reversal",
            amount=Decimal("120000"),
            status="paid",
            created_at=base + timedelta(hours=1),
            paid_at=base + timedelta(hours=1),
            reversal_of_id=orig.id,
        )
    )
    job.status = "cancelled"
    job.cancelled_at = base + timedelta(hours=1)
    db_session.commit()

    recalculate_contract_employee_financials(db_session, ce.id, commit=True)
    derived, _ = compute_contract_employee_financials(db_session, ce.id)
    assert derived.balance == Decimal("0")
    _assert_invariant(db_session, ce.id)


def test_payment_then_reversal_nets_zero(db_session):
    ce = _make_ce(db_session)
    job = _make_job(db_session, ce, final_price=Decimal("100000"), accepted=True, status="in_progress")
    base = datetime(2026, 8, 3, 10, 0, 0)

    db_session.add(
        models.EmployeeTransaction(
            contract_employee_id=ce.id,
            contract_job_id=job.id,
            txn_type="owed_increase",
            amount=Decimal("100000"),
            status="paid",
            created_at=base,
            paid_at=base,
        )
    )
    db_session.flush()

    payment = models.EmployeeTransaction(
        contract_employee_id=ce.id,
        txn_type="payment",
        amount=Decimal("40000"),
        status="paid",
        created_at=base + timedelta(hours=1),
        paid_at=base + timedelta(hours=1),
        processed_by_role="finance",
    )
    db_session.add(payment)
    db_session.flush()
    db_session.add(
        models.EmployeePaymentAllocation(
            transaction_id=payment.id,
            contract_job_id=job.id,
            amount=Decimal("40000"),
        )
    )
    db_session.flush()
    db_session.add(
        models.EmployeeTransaction(
            contract_employee_id=ce.id,
            txn_type="reversal",
            amount=Decimal("40000"),
            status="paid",
            created_at=base + timedelta(hours=2),
            paid_at=base + timedelta(hours=2),
            reversal_of_id=payment.id,
        )
    )
    db_session.commit()

    recalculate_contract_employee_financials(db_session, ce.id, commit=True)
    derived, _ = compute_contract_employee_financials(db_session, ce.id)
    assert derived.balance == Decimal("100000")
    assert derived.total_paid == Decimal("0")
    _assert_invariant(db_session, ce.id)


def test_pending_payment_does_not_change_balance(db_session):
    ce = _make_ce(db_session)
    base = datetime(2026, 8, 4, 10, 0, 0)

    db_session.add(
        models.EmployeeTransaction(
            contract_employee_id=ce.id,
            txn_type="owed_increase",
            amount=Decimal("60000"),
            status="paid",
            created_at=base,
            paid_at=base,
        )
    )
    for status in ("requested", "approved_by_admin", "sent_to_finance", "pending", "resolved"):
        db_session.add(
            models.EmployeeTransaction(
                contract_employee_id=ce.id,
                txn_type="payment",
                amount=Decimal("20000"),
                status=status,
                created_at=base + timedelta(hours=1),
            )
        )
    db_session.commit()

    recalculate_contract_employee_financials(db_session, ce.id, commit=True)
    derived, _ = compute_contract_employee_financials(db_session, ce.id)
    assert derived.balance == Decimal("60000")
    assert derived.total_paid == Decimal("0")
    _assert_invariant(db_session, ce.id)


def test_partial_payment_and_multiple_jobs(db_session):
    ce = _make_ce(db_session)
    job1 = _make_job(db_session, ce, final_price=Decimal("50000"), accepted=True)
    job2 = _make_job(db_session, ce, final_price=Decimal("70000"), accepted=True)
    base = datetime(2026, 8, 5, 10, 0, 0)

    for job, amt in ((job1, Decimal("50000")), (job2, Decimal("70000"))):
        db_session.add(
            models.EmployeeTransaction(
                contract_employee_id=ce.id,
                contract_job_id=job.id,
                txn_type="owed_increase",
                amount=amt,
                status="paid",
                created_at=base,
                paid_at=base,
            )
        )
    db_session.flush()

    payment = models.EmployeeTransaction(
        contract_employee_id=ce.id,
        txn_type="payment",
        amount=Decimal("45000"),
        status="paid",
        created_at=base + timedelta(hours=1),
        paid_at=base + timedelta(hours=1),
        processed_by_role="finance",
    )
    db_session.add(payment)
    db_session.flush()
    db_session.add_all(
        [
            models.EmployeePaymentAllocation(
                transaction_id=payment.id,
                contract_job_id=job1.id,
                amount=Decimal("30000"),
            ),
            models.EmployeePaymentAllocation(
                transaction_id=payment.id,
                contract_job_id=job2.id,
                amount=Decimal("15000"),
            ),
        ]
    )
    db_session.commit()

    recalculate_contract_employee_financials(db_session, ce.id, commit=True)
    derived, _ = compute_contract_employee_financials(db_session, ce.id)
    assert derived.total_owed == Decimal("120000")
    assert derived.total_paid == Decimal("45000")
    assert derived.balance == Decimal("75000")
    _assert_invariant(db_session, ce.id)


def test_multiple_manual_adjustments_and_reversals(db_session):
    ce = _make_ce(db_session)
    base = datetime(2026, 8, 6, 10, 0, 0)

    t1 = models.EmployeeTransaction(
        contract_employee_id=ce.id,
        txn_type="owed_increase",
        amount=Decimal("20000"),
        status="paid",
        created_at=base,
        paid_at=base,
    )
    t2 = models.EmployeeTransaction(
        contract_employee_id=ce.id,
        txn_type="owed_increase",
        amount=Decimal("15000"),
        status="paid",
        created_at=base + timedelta(hours=1),
        paid_at=base + timedelta(hours=1),
    )
    db_session.add_all([t1, t2])
    db_session.flush()
    db_session.add(
        models.EmployeeTransaction(
            contract_employee_id=ce.id,
            txn_type="reversal",
            amount=Decimal("15000"),
            status="paid",
            created_at=base + timedelta(hours=2),
            paid_at=base + timedelta(hours=2),
            reversal_of_id=t2.id,
        )
    )
    db_session.add(
        models.EmployeeTransaction(
            contract_employee_id=ce.id,
            txn_type="owed_decrease",
            amount=Decimal("5000"),
            status="paid",
            created_at=base + timedelta(hours=3),
            paid_at=base + timedelta(hours=3),
        )
    )
    db_session.commit()

    recalculate_contract_employee_financials(db_session, ce.id, commit=True)
    derived, _ = compute_contract_employee_financials(db_session, ce.id)
    assert derived.balance == Decimal("15000")
    _assert_invariant(db_session, ce.id)


def test_running_balance_chronological_after_recalculate(db_session):
    ce = _make_ce(db_session)
    base = datetime(2026, 8, 7, 10, 0, 0)

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
        amount=Decimal("25000"),
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
    assert t2.running_balance == Decimal("75000")

    entries = build_contract_employee_ledger(db_session, ce.id)
    assert entries[0].balance_after == t1.running_balance
    assert entries[1].balance_after == t2.running_balance


def test_recalculate_raises_on_invariant_violation(db_session, monkeypatch):
    """Guardrail: recalculate fails tests if invariant breaks."""
    ce = _make_ce(db_session)
    db_session.add(
        models.EmployeeTransaction(
            contract_employee_id=ce.id,
            txn_type="owed_increase",
            amount=Decimal("10000"),
            status="paid",
            created_at=datetime.utcnow(),
            paid_at=datetime.utcnow(),
        )
    )
    db_session.commit()

    from app.utils.contract_employee_ledger import ContractEmployeeLedgerEntry, build_contract_employee_ledger

    original = build_contract_employee_ledger

    def _broken_ledger(db, ce_id, **kwargs):
        entries = original(db, ce_id, **kwargs)
        if not entries:
            return entries
        last = entries[-1]
        broken = ContractEmployeeLedgerEntry(
            transaction=last.transaction,
            ledger_type=last.ledger_type,
            transaction_type_label=last.transaction_type_label,
            description=last.description,
            reference=last.reference,
            credit=last.credit,
            debit=last.debit,
            balance_before=last.balance_before,
            balance_after=Decimal("999999"),
            status_label=last.status_label,
            initiated_by=last.initiated_by,
        )
        return entries[:-1] + [broken]

    monkeypatch.setattr("app.utils.contract_employee_ledger.build_contract_employee_ledger", _broken_ledger)

    from app.utils.contract_employee_balance_rules import AccountingInvariantError

    with pytest.raises(AccountingInvariantError):
        recalculate_contract_employee_financials(db_session, ce.id, commit=False)
