"""Canonical accounting rules for contract employee financial calculations.

Single source of truth for balance effects, reversal pairing, and eligibility rules
consumed by the ledger builder, compute engine, and recalculate path.

Job earnings model (documented to prevent double-counting):
- Accepted/in-progress/completed jobs create a paid job-linked ``owed_increase`` row.
- ``total_owed`` is derived from transaction contributions only — never from
  ``ContractJob.final_price`` sums, which would double-count those rows.
- Payment impact uses finance-confirmed payment allocation totals (non-voided,
  linked to financially valid jobs); mark-paid enforces allocation sum = payment amount.

Reversal model — Option A (symmetric pairs):
- The original row always contributes its signed effect when paid/eligible.
- A paid reversal contributes the exact opposite signed effect.
- Net of any reversal pair is always zero.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy.orm import Session, aliased

from app import models


class AccountingInvariantError(Exception):
    """Raised in tests when stored, computed, and ledger balances diverge."""


def as_decimal(v: Any) -> Decimal:
    return Decimal(str(v or 0))


def job_is_valid_for_financials(job: models.ContractJob) -> tuple[bool, str]:
    """Whether a job may receive payment allocations (not for owed txn double-counting)."""
    if job.status == "cancelled":
        return False, "cancelled"
    if job.final_price is None:
        return False, "no_final_price"

    fp = as_decimal(job.final_price)
    if fp <= 0:
        return False, "invalid_final_price"

    if job.status in ("in_progress", "completed"):
        return True, "in_progress_or_completed"

    if getattr(job, "price_accepted_at", None) is not None:
        return True, "accepted_by_price_lock"

    return False, "not_accepted_in_progress_or_completed"


def is_finance_confirmed_payment(txn: models.EmployeeTransaction) -> bool:
    if txn.txn_type != "payment" or txn.status != "paid":
        return False
    role = (getattr(txn, "processed_by_role", None) or "").strip().lower()
    if role in ("finance", "admin"):
        return True
    return bool(getattr(txn, "receipt_url", None))


def is_pending_payment_status(status: str | None) -> bool:
    return (status or "").strip().lower() in (
        "requested",
        "approved_by_admin",
        "sent_to_finance",
        "pending",
        "resolved",
    )


def manual_adjustment_eligible(txn: models.EmployeeTransaction) -> bool:
    """Paid manual owed increase/decrease (not linked to a contract job)."""
    if txn.status != "paid":
        return False
    if txn.contract_job_id is not None:
        return False
    return txn.txn_type in ("owed_increase", "owed_decrease")


def job_linked_owed_increase_eligible(txn: models.EmployeeTransaction) -> bool:
    """Paid job-linked owed_increase (canonical job earnings transaction)."""
    return (
        txn.txn_type == "owed_increase"
        and txn.status == "paid"
        and txn.contract_job_id is not None
        and as_decimal(txn.amount) > 0
    )


def get_reversed_payment_ids(db: Session, contract_employee_id: int) -> set[int]:
    rev = aliased(models.EmployeeTransaction)
    orig = aliased(models.EmployeeTransaction)
    rows = (
        db.query(rev.reversal_of_id)
        .join(orig, rev.reversal_of_id == orig.id)
        .filter(
            rev.txn_type == "reversal",
            rev.status == "paid",
            rev.reversal_of_id.isnot(None),
            orig.txn_type == "payment",
            orig.contract_employee_id == contract_employee_id,
        )
        .all()
    )
    return {int(r[0]) for r in rows if r[0] is not None}


def get_reversed_payment_ids_batch(db: Session, contract_employee_ids: list[int]) -> dict[int, set[int]]:
    ce_ids = sorted({int(x) for x in contract_employee_ids if x})
    out: dict[int, set[int]] = {cid: set() for cid in ce_ids}
    if not ce_ids:
        return out

    rev = aliased(models.EmployeeTransaction)
    orig = aliased(models.EmployeeTransaction)
    rows = (
        db.query(orig.contract_employee_id, rev.reversal_of_id)
        .join(orig, rev.reversal_of_id == orig.id)
        .filter(
            rev.txn_type == "reversal",
            rev.status == "paid",
            rev.reversal_of_id.isnot(None),
            orig.txn_type == "payment",
            orig.contract_employee_id.in_(ce_ids),
        )
        .all()
    )
    for ce_id, reversal_of_id in rows:
        if ce_id is None or reversal_of_id is None:
            continue
        out.setdefault(int(ce_id), set()).add(int(reversal_of_id))
    return out


def get_reversed_transaction_ids(db: Session, contract_employee_id: int) -> set[int]:
    rev = aliased(models.EmployeeTransaction)
    rows = (
        db.query(rev.reversal_of_id)
        .filter(
            rev.contract_employee_id == contract_employee_id,
            rev.txn_type == "reversal",
            rev.status == "paid",
            rev.reversal_of_id.isnot(None),
        )
        .all()
    )
    return {int(r[0]) for r in rows if r[0] is not None}


@dataclass
class ContractEmployeeAccountingContext:
    contract_employee_id: int
    orig_by_id: dict[int, models.EmployeeTransaction] = field(default_factory=dict)
    valid_job_ids: set[int] = field(default_factory=set)
    eligible_payment_amount_by_txn_id: dict[int, Decimal] = field(default_factory=dict)


def _eligible_payment_amount(txn: models.EmployeeTransaction, ctx: ContractEmployeeAccountingContext) -> Decimal:
    tid = int(txn.id)
    if tid in ctx.eligible_payment_amount_by_txn_id:
        return ctx.eligible_payment_amount_by_txn_id[tid]
    return as_decimal(txn.amount)


def _non_reversal_owed_contribution(txn: models.EmployeeTransaction) -> Decimal:
    if txn.status != "paid":
        return Decimal("0")
    amt = as_decimal(txn.amount)
    if amt <= 0:
        return Decimal("0")
    if txn.txn_type == "owed_increase":
        return amt
    if txn.txn_type == "owed_decrease":
        return -amt
    return Decimal("0")


def _non_reversal_paid_contribution(
    txn: models.EmployeeTransaction,
    ctx: ContractEmployeeAccountingContext,
) -> Decimal:
    if txn.status == "cancelled":
        return Decimal("0")
    if txn.txn_type != "payment" or txn.status != "paid":
        return Decimal("0")
    if not is_finance_confirmed_payment(txn):
        return Decimal("0")
    return _eligible_payment_amount(txn, ctx)


def transaction_owed_contribution(
    txn: models.EmployeeTransaction,
    ctx: ContractEmployeeAccountingContext,
) -> Decimal:
    if txn.txn_type == "reversal":
        if txn.status != "paid" or txn.reversal_of_id is None:
            return Decimal("0")
        orig = ctx.orig_by_id.get(int(txn.reversal_of_id))
        if orig is None:
            return Decimal("0")
        return -_non_reversal_owed_contribution(orig)
    return _non_reversal_owed_contribution(txn)


def transaction_paid_contribution(
    txn: models.EmployeeTransaction,
    ctx: ContractEmployeeAccountingContext,
) -> Decimal:
    if txn.txn_type == "reversal":
        if txn.status != "paid" or txn.reversal_of_id is None:
            return Decimal("0")
        orig = ctx.orig_by_id.get(int(txn.reversal_of_id))
        if orig is None:
            return Decimal("0")
        return -_non_reversal_paid_contribution(orig, ctx)
    return _non_reversal_paid_contribution(txn, ctx)


def transaction_balance_delta(
    txn: models.EmployeeTransaction,
    ctx: ContractEmployeeAccountingContext,
) -> Decimal:
    """Signed change to employee balance (positive = company owes employee more)."""
    return transaction_owed_contribution(txn, ctx) - transaction_paid_contribution(txn, ctx)


def build_accounting_context(
    db: Session,
    contract_employee_id: int,
    *,
    transactions: Optional[list[models.EmployeeTransaction]] = None,
) -> ContractEmployeeAccountingContext:
    if transactions is None:
        transactions = (
            db.query(models.EmployeeTransaction)
            .filter(models.EmployeeTransaction.contract_employee_id == contract_employee_id)
            .order_by(models.EmployeeTransaction.created_at.asc(), models.EmployeeTransaction.id.asc())
            .all()
        )

    job_rows = (
        db.query(models.ContractJob)
        .filter(models.ContractJob.contract_employee_id == contract_employee_id)
        .all()
    )
    valid_job_ids: set[int] = set()
    for job in job_rows:
        ok, _ = job_is_valid_for_financials(job)
        if ok and job.id is not None:
            valid_job_ids.add(int(job.id))

    reversal_orig_ids = [
        int(t.reversal_of_id) for t in transactions if t.reversal_of_id is not None
    ]
    orig_by_id: dict[int, models.EmployeeTransaction] = {}
    if reversal_orig_ids:
        for orig in (
            db.query(models.EmployeeTransaction)
            .filter(models.EmployeeTransaction.id.in_(reversal_orig_ids))
            .all()
        ):
            if orig.id is not None:
                orig_by_id[int(orig.id)] = orig

    payment_ids = [int(t.id) for t in transactions if t.txn_type == "payment" and t.id is not None]
    eligible_payment_amount_by_txn_id: dict[int, Decimal] = {}
    if payment_ids and valid_job_ids:
        alloc_rows = (
            db.query(
                models.EmployeePaymentAllocation.transaction_id,
                models.EmployeePaymentAllocation.amount,
            )
            .filter(
                models.EmployeePaymentAllocation.transaction_id.in_(payment_ids),
                models.EmployeePaymentAllocation.voided_at.is_(None),
                models.EmployeePaymentAllocation.contract_job_id.in_(valid_job_ids),
            )
            .all()
        )
        for txn_id, amount in alloc_rows:
            tid = int(txn_id)
            eligible_payment_amount_by_txn_id[tid] = (
                eligible_payment_amount_by_txn_id.get(tid, Decimal("0")) + as_decimal(amount)
            )

    # Finance-confirmed payments without allocation rows fall back to txn.amount in _eligible_payment_amount.
    for txn in transactions:
        if (
            txn.id is not None
            and txn.txn_type == "payment"
            and is_finance_confirmed_payment(txn)
            and int(txn.id) not in eligible_payment_amount_by_txn_id
        ):
            eligible_payment_amount_by_txn_id[int(txn.id)] = as_decimal(txn.amount)

    return ContractEmployeeAccountingContext(
        contract_employee_id=contract_employee_id,
        orig_by_id=orig_by_id,
        valid_job_ids=valid_job_ids,
        eligible_payment_amount_by_txn_id=eligible_payment_amount_by_txn_id,
    )


def aggregate_financials_from_transactions(
    transactions: list[models.EmployeeTransaction],
    ctx: ContractEmployeeAccountingContext,
) -> tuple[Decimal, Decimal, Decimal]:
    """Return (total_owed, total_paid, balance) from canonical rules."""
    total_owed = Decimal("0")
    total_paid = Decimal("0")
    for txn in transactions:
        total_owed += transaction_owed_contribution(txn, ctx)
        total_paid += transaction_paid_contribution(txn, ctx)
    balance = total_owed - total_paid
    return total_owed, total_paid, balance


def walk_balance_from_transactions(
    transactions: list[models.EmployeeTransaction],
    ctx: ContractEmployeeAccountingContext,
) -> Decimal:
    """Chronological sum of balance deltas (must equal aggregate balance)."""
    running = Decimal("0")
    for txn in transactions:
        running += transaction_balance_delta(txn, ctx)
    return running
