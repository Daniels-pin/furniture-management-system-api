from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy.orm import Session

from app import models
from app.utils.contract_employee_balance_rules import (
    AccountingInvariantError,
    aggregate_financials_from_transactions,
    build_accounting_context,
    get_reversed_payment_ids,
    get_reversed_payment_ids_batch,
    get_reversed_transaction_ids,
    job_is_valid_for_financials,
    walk_balance_from_transactions,
)
from app.utils.financial_audit import log_financial_action

logger = logging.getLogger(__name__)

# Backward-compatible re-exports for existing imports.
_get_reversed_payment_ids = get_reversed_payment_ids
_get_reversed_payment_ids_batch = get_reversed_payment_ids_batch
_get_reversed_transaction_ids = get_reversed_transaction_ids
_job_is_valid_for_financials = job_is_valid_for_financials


@dataclass(frozen=True)
class ContractEmployeeDerivedTotals:
    total_owed: Decimal
    total_paid: Decimal
    balance: Decimal


def compute_contract_employee_financials(
    db: Session,
    contract_employee_id: int,
    *,
    debug: bool = False,
) -> tuple[ContractEmployeeDerivedTotals, dict[str, Any]]:
    """
    Derive financial totals by walking all transactions with canonical accounting rules.

    total_owed and total_paid decompose the same walk used for balance; balance equals
    the chronological sum of transaction_balance_delta (Option A symmetric reversals).
    """

    transactions = (
        db.query(models.EmployeeTransaction)
        .filter(models.EmployeeTransaction.contract_employee_id == contract_employee_id)
        .order_by(models.EmployeeTransaction.created_at.asc(), models.EmployeeTransaction.id.asc())
        .all()
    )
    ctx = build_accounting_context(db, contract_employee_id, transactions=transactions)

    total_owed, total_paid, balance = aggregate_financials_from_transactions(transactions, ctx)
    walk_balance = walk_balance_from_transactions(transactions, ctx)
    if walk_balance != balance:
        raise AccountingInvariantError(
            f"Internal aggregation mismatch for contract employee {contract_employee_id}: "
            f"walk={walk_balance} aggregate={balance}"
        )

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
        ok, reason = job_is_valid_for_financials(tmp)
        if ok:
            job_valid[int(jid)] = reason
        else:
            job_excluded.append({"id": int(jid), "status": status, "reason": reason})

    debug_info: dict[str, Any] = {
        "jobs_used": sorted(list(job_valid.keys())),
        "jobs_excluded": job_excluded,
        "transaction_count": len(transactions),
        "walk_balance": str(walk_balance),
    }
    if not debug and len(debug_info["jobs_excluded"]) > 50:
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


def _verify_accounting_invariant(
    contract_employee_id: int,
    stored_balance: Decimal,
    derived: ContractEmployeeDerivedTotals,
    ledger_final_balance: Decimal,
) -> None:
    if stored_balance == derived.balance == ledger_final_balance:
        return
    msg = (
        f"Accounting invariant violated for contract employee {contract_employee_id}: "
        f"stored={stored_balance} computed={derived.balance} ledger_final={ledger_final_balance}"
    )
    logger.critical(msg)
    if os.getenv("PYTEST_CURRENT_TEST"):
        raise AccountingInvariantError(msg)


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

    from app.utils.contract_employee_ledger import build_contract_employee_ledger

    entries = build_contract_employee_ledger(db, contract_employee_id)
    ledger_final = entries[-1].balance_after if entries else Decimal("0")
    for entry in entries:
        entry.transaction.running_balance = entry.balance_after

    _verify_accounting_invariant(contract_employee_id, emp.balance, derived, ledger_final)

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
