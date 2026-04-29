from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session, aliased

from app import models
from app.utils.financial_audit import log_financial_action


def _as_decimal(v: Any) -> Decimal:
    return Decimal(str(v or 0))


@dataclass(frozen=True)
class ContractEmployeeDerivedTotals:
    total_owed: Decimal
    total_paid: Decimal
    balance: Decimal


def _job_is_valid_for_financials(job: models.ContractJob) -> tuple[bool, str]:
    # Requirement mapping:
    # - Include only: accepted (price_accepted_at) OR in_progress OR completed
    # - Exclude: cancelled
    # - Exclude: no final accepted price (final_price missing / <= 0)
    if job.status == "cancelled":
        return False, "cancelled"
    if job.final_price is None:
        return False, "no_final_price"

    fp = _as_decimal(job.final_price)
    if fp <= 0:
        return False, "invalid_final_price"

    if job.status in ("in_progress", "completed"):
        return True, "in_progress_or_completed"

    # "accepted" isn't a stored status in the DB; we use the price-locked timestamp.
    if getattr(job, "price_accepted_at", None) is not None:
        return True, "accepted_by_price_lock"

    return False, "not_accepted_in_progress_or_completed"


def _get_reversed_payment_ids(db: Session, contract_employee_id: int) -> set[int]:
    """
    Identify payment transactions that have been reversed by a corresponding reversal row.

    We exclude these payments even if allocations were not voided, so payment impact stays correct.
    """

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


def compute_contract_employee_financials(
    db: Session,
    contract_employee_id: int,
    *,
    debug: bool = False,
) -> tuple[ContractEmployeeDerivedTotals, dict[str, Any]]:
    """
    Derive all financial totals from:
    - ContractJobs: only accepted/in_progress/completed jobs with a locked final price
    - EmployeeTransaction (payment): only status=paid and finance-confirmed (best-effort)

    Excludes:
    - cancelled jobs
    - voided payment allocations
    - reversed payment transactions
    - allocations tied to invalid jobs
    """

    # Snapshot jobs to determine which are valid and which are excluded (for debug logging).
    job_rows = (
        db.query(
            models.ContractJob.id,
            models.ContractJob.status,
            models.ContractJob.final_price,
            models.ContractJob.price_accepted_at,
        )
        .filter(models.ContractJob.contract_employee_id == contract_employee_id)
        .all()
    )

    job_valid: dict[int, str] = {}
    job_excluded: list[dict[str, Any]] = []
    for jid, status, final_price, price_accepted_at in job_rows:
        tmp = models.ContractJob(
            id=int(jid),
            status=status,
            final_price=final_price,
            price_accepted_at=price_accepted_at,
        )
        ok, reason = _job_is_valid_for_financials(tmp)
        if ok:
            job_valid[int(jid)] = reason
        else:
            job_excluded.append({"id": int(jid), "status": status, "reason": reason})

    valid_job_ids = set(job_valid.keys())

    # Total owed: sum final_price for valid jobs only.
    total_owed = Decimal("0")
    if valid_job_ids:
        owed_sum = (
            db.query(func.coalesce(func.sum(models.ContractJob.final_price), 0))
            .filter(models.ContractJob.contract_employee_id == contract_employee_id)
            .filter(models.ContractJob.id.in_(valid_job_ids))
            .scalar()
        )
        total_owed = _as_decimal(owed_sum)

    # Payments:
    # Only include finance-confirmed (best-effort).
    # - Primary: processed_by_role='finance'
    # - Legacy fallback: receipt_url present
    reversed_payment_ids = _get_reversed_payment_ids(db, contract_employee_id)

    payments_candidate_rows = (
        db.query(models.EmployeeTransaction.id)
        .filter(
            models.EmployeeTransaction.contract_employee_id == contract_employee_id,
            models.EmployeeTransaction.txn_type == "payment",
            models.EmployeeTransaction.status == "paid",
            or_(
                models.EmployeeTransaction.processed_by_role == "finance",
                models.EmployeeTransaction.receipt_url.isnot(None),
            ),
        )
        .all()
    )
    candidate_payment_ids = {int(r[0]) for r in payments_candidate_rows}
    candidate_payment_ids -= reversed_payment_ids

    # Aggregate paid allocations ONLY for valid jobs and non-voided allocation lines.
    job_paid: dict[int, Decimal] = {}
    payments_used: set[int] = set()
    excluded_allocations_count = 0

    if valid_job_ids and candidate_payment_ids:
        alloc_rows = (
            db.query(
                models.EmployeePaymentAllocation.contract_job_id,
                models.EmployeePaymentAllocation.amount,
                models.EmployeePaymentAllocation.transaction_id,
            )
            .join(
                models.EmployeeTransaction,
                models.EmployeeTransaction.id == models.EmployeePaymentAllocation.transaction_id,
            )
            .filter(
                models.EmployeeTransaction.contract_employee_id == contract_employee_id,
                models.EmployeeTransaction.txn_type == "payment",
                models.EmployeeTransaction.status == "paid",
                models.EmployeePaymentAllocation.voided_at.is_(None),
                models.EmployeePaymentAllocation.contract_job_id.in_(valid_job_ids),
                models.EmployeePaymentAllocation.transaction_id.in_(candidate_payment_ids),
            )
            .all()
        )

        for job_id, amt, txn_id in alloc_rows:
            jid = int(job_id)
            payments_used.add(int(txn_id))
            job_paid[jid] = job_paid.get(jid, Decimal("0")) + _as_decimal(amt)

        # Debug: count allocations excluded due to voiding or invalid linked jobs.
        if valid_job_ids:
            excluded_allocations_count = (
                db.query(func.count(models.EmployeePaymentAllocation.id))
                .join(
                    models.EmployeeTransaction,
                    models.EmployeeTransaction.id == models.EmployeePaymentAllocation.transaction_id,
                )
                .filter(
                    models.EmployeeTransaction.contract_employee_id == contract_employee_id,
                    models.EmployeeTransaction.txn_type == "payment",
                    models.EmployeeTransaction.status == "paid",
                    models.EmployeePaymentAllocation.transaction_id.in_(candidate_payment_ids),
                    or_(
                        models.EmployeePaymentAllocation.voided_at.isnot(None),
                        models.EmployeePaymentAllocation.contract_job_id.notin_(valid_job_ids),
                    ),
                )
                .scalar()
                or 0
            )
        else:
            # No valid jobs means every allocation linked to this employee is excluded.
            excluded_allocations_count = (
                db.query(func.count(models.EmployeePaymentAllocation.id))
                .join(
                    models.EmployeeTransaction,
                    models.EmployeeTransaction.id == models.EmployeePaymentAllocation.transaction_id,
                )
                .filter(
                    models.EmployeeTransaction.contract_employee_id == contract_employee_id,
                    models.EmployeeTransaction.txn_type == "payment",
                    models.EmployeeTransaction.status == "paid",
                    models.EmployeePaymentAllocation.transaction_id.in_(candidate_payment_ids),
                )
                .scalar()
                or 0
            )

    total_paid = Decimal("0")
    for _, amt in job_paid.items():
        total_paid += amt
    balance = total_owed - total_paid

    payments_excluded = sorted(list(candidate_payment_ids - payments_used))

    debug_info: dict[str, Any] = {
        "jobs_used": sorted(list(valid_job_ids)),
        "jobs_excluded": job_excluded,
        "payments_used_count": len(payments_used),
        "payments_used_sample": sorted(list(payments_used))[:25],
        "payments_excluded_count": len(payments_excluded),
        "payments_excluded_sample": payments_excluded[:25],
        "excluded_allocations_count": int(excluded_allocations_count),
    }
    if not debug:
        # Keep debug small for logs.
        # jobs_excluded can still be large; truncate unless requested.
        if len(debug_info["jobs_excluded"]) > 50:
            debug_info["jobs_excluded_truncated"] = len(debug_info["jobs_excluded"])
            debug_info["jobs_excluded"] = debug_info["jobs_excluded"][:50]

    return (
        ContractEmployeeDerivedTotals(
            total_owed=total_owed,
            total_paid=total_paid,
            balance=balance,
        ),
        debug_info,
    )


def recalculate_contract_employee_financials(
    db: Session,
    contract_employee_id: int,
    *,
    actor_user: Optional[Any] = None,
    debug: bool = False,
    commit: bool = True,
) -> ContractEmployeeDerivedTotals:
    derived, debug_info = compute_contract_employee_financials(db, contract_employee_id, debug=debug)

    emp = db.query(models.ContractEmployee).filter(models.ContractEmployee.id == contract_employee_id).first()
    if emp is None:
        raise ValueError(f"Contract employee not found: {contract_employee_id}")

    emp.total_owed = derived.total_owed
    emp.total_paid = derived.total_paid
    emp.balance = derived.balance
    emp.updated_at = datetime.utcnow()

    # Make transaction UI balance consistent after recalculation.
    # (We keep running_balance as a cached field, but ensure it reflects the rebuilt totals.)
    db.query(models.EmployeeTransaction).filter(models.EmployeeTransaction.contract_employee_id == contract_employee_id).update(
        {models.EmployeeTransaction.running_balance: derived.balance},
        synchronize_session=False,
    )

    if actor_user is not None:
        log_financial_action(
            db,
            action="recalculate_contract_employee_financials",
            entity_type="contract_employee",
            entity_id=contract_employee_id,
            actor_user=actor_user,
            meta=debug_info,
        )

    if commit:
        db.commit()

    return derived


def recalculate_all_contract_employees_financials(
    db: Session,
    *,
    actor_user: Optional[Any] = None,
    debug: bool = False,
) -> dict[str, Any]:
    ids = [int(r[0]) for r in db.query(models.ContractEmployee.id).all()]
    updated = 0
    started = datetime.utcnow()
    for cid in ids:
        recalculate_contract_employee_financials(
            db,
            cid,
            actor_user=actor_user,
            debug=debug,
            commit=False,
        )
        updated += 1

    db.commit()
    finished = datetime.utcnow()
    return {
        "updated_employees": updated,
        "started_at": started.isoformat(),
        "finished_at": finished.isoformat(),
        "elapsed_seconds": (finished - started).total_seconds(),
    }

