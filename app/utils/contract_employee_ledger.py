from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any, Literal, Optional

from sqlalchemy.orm import Session

from app import models
from app.utils.contract_employee_balance_rules import (
    build_accounting_context,
    transaction_balance_delta,
)

LedgerType = Literal[
    "job_accepted",
    "manual_increase",
    "manual_deduction",
    "employee_money_request",
    "payment_sent_to_finance",
    "finance_payment_completed",
    "payment_reversal",
    "admin_reversal",
    "cancelled_transfer",
    "other",
]

LEDGER_TYPE_LABELS: dict[str, str] = {
    "job_accepted": "Job Accepted",
    "manual_increase": "Manual Increase",
    "manual_deduction": "Manual Deduction",
    "employee_money_request": "Employee Money Request",
    "payment_sent_to_finance": "Payment Sent to Finance",
    "finance_payment_completed": "Finance Payment Completed",
    "payment_reversal": "Payment Reversal",
    "admin_reversal": "Admin Reversal",
    "cancelled_transfer": "Cancelled Transfer",
    "other": "Other",
}


def _as_decimal(v: Any) -> Decimal:
    return Decimal(str(v or 0))


def _payment_initiated_by(
    db: Session,
    payment_ids: list[int],
) -> dict[int, str]:
    if not payment_ids:
        return {}
    requested_ids = {
        int(eid)
        for (eid,) in db.query(models.FinancialAuditLog.entity_id)
        .filter(
            models.FinancialAuditLog.entity_type == "employee_transaction",
            models.FinancialAuditLog.action == "contract_employee_payment_requested",
            models.FinancialAuditLog.entity_id.in_(payment_ids),
        )
        .all()
        if eid is not None
    }
    return {tid: ("employee" if tid in requested_ids else "admin") for tid in payment_ids}


def _classify_ledger_type(
    txn: models.EmployeeTransaction,
    *,
    initiated_by: Optional[str],
    orig_by_id: dict[int, models.EmployeeTransaction],
) -> LedgerType:
    if txn.txn_type == "owed_increase":
        return "job_accepted" if txn.contract_job_id else "manual_increase"
    if txn.txn_type == "owed_decrease":
        return "manual_deduction"
    if txn.txn_type == "reversal":
        orig = orig_by_id.get(int(txn.reversal_of_id)) if txn.reversal_of_id else None
        if orig and orig.txn_type == "payment":
            return "payment_reversal"
        return "admin_reversal"
    if txn.txn_type == "payment":
        if txn.status == "cancelled":
            return "cancelled_transfer"
        if txn.status == "paid":
            return "finance_payment_completed"
        if txn.status in ("sent_to_finance", "pending"):
            return "payment_sent_to_finance"
        if txn.status in ("requested", "approved_by_admin", "resolved"):
            return "employee_money_request"
        return "other"
    return "other"


def _status_label(txn: models.EmployeeTransaction) -> str:
    if txn.status == "requested":
        return "Awaiting Admin"
    if txn.status == "approved_by_admin":
        return "Awaiting Finance"
    if txn.status in ("sent_to_finance", "pending"):
        return "Awaiting Finance"
    if txn.status == "paid":
        return "Completed"
    if txn.status == "resolved":
        return "Resolved"
    if txn.status == "cancelled":
        return "Cancelled"
    return str(txn.status or "—").replace("_", " ").title()


def _ledger_reference(
    txn: models.EmployeeTransaction,
    *,
    ledger_type: LedgerType,
) -> str:
    if txn.contract_job_id:
        return f"Job #{int(txn.contract_job_id)}"
    if txn.txn_type == "payment":
        if ledger_type in ("employee_money_request", "payment_sent_to_finance", "finance_payment_completed", "cancelled_transfer"):
            return f"Payment Request #{int(txn.id)}"
        return f"Payment Request #{int(txn.id)}"
    if ledger_type in ("manual_increase", "manual_deduction"):
        return "Manual Adjustment"
    if txn.txn_type == "reversal" and txn.reversal_of_id:
        return f"Reversal of #{int(txn.reversal_of_id)}"
    return "—"


def _ledger_description(
    txn: models.EmployeeTransaction,
    *,
    ledger_type: LedgerType,
    initiated_by: Optional[str],
) -> str:
    note = (txn.note or "").strip()
    if note:
        return note
    if ledger_type == "job_accepted" and txn.contract_job_id:
        return f"Job #{int(txn.contract_job_id)} accepted"
    if ledger_type == "manual_increase":
        return "Manual increase by Admin"
    if ledger_type == "manual_deduction":
        return "Manual deduction by Admin"
    if ledger_type == "employee_money_request":
        return "Employee money request"
    if ledger_type == "payment_sent_to_finance":
        return "Payment sent to Finance" if initiated_by == "admin" else "Employee request sent to Finance"
    if ledger_type == "finance_payment_completed":
        return "Payment processed by Finance"
    if ledger_type == "payment_reversal":
        return "Payment reversed"
    if ledger_type == "admin_reversal":
        return "Payment reversed" if txn.reversal_of_id else "Transaction reversed"
    if ledger_type == "cancelled_transfer":
        return "Payment transfer cancelled"
    return LEDGER_TYPE_LABELS.get(ledger_type, "Financial transaction")


def _display_credit_debit(
    txn: models.EmployeeTransaction,
    *,
    ledger_type: LedgerType,
    orig_by_id: dict[int, models.EmployeeTransaction],
) -> tuple[Decimal, Decimal]:
    amt = _as_decimal(txn.amount)
    if amt <= 0:
        return Decimal("0"), Decimal("0")

    if txn.txn_type == "owed_increase":
        return amt, Decimal("0")
    if txn.txn_type == "owed_decrease":
        return Decimal("0"), amt
    if txn.txn_type == "payment":
        return Decimal("0"), amt
    if txn.txn_type == "reversal":
        orig = orig_by_id.get(int(txn.reversal_of_id)) if txn.reversal_of_id else None
        if orig and orig.txn_type == "payment":
            return amt, Decimal("0")
        if orig and orig.txn_type == "owed_increase":
            return Decimal("0"), amt
        if orig and orig.txn_type == "owed_decrease":
            return amt, Decimal("0")
        return Decimal("0"), amt
    return Decimal("0"), Decimal("0")


@dataclass(frozen=True)
class ContractEmployeeLedgerEntry:
    transaction: models.EmployeeTransaction
    ledger_type: LedgerType
    transaction_type_label: str
    description: str
    reference: str
    credit: Decimal
    debit: Decimal
    balance_before: Decimal
    balance_after: Decimal
    status_label: str
    initiated_by: Optional[str] = None


def build_contract_employee_ledger(
    db: Session,
    contract_employee_id: int,
    *,
    initiated_by_by_txn_id: dict[int, str] | None = None,
) -> list[ContractEmployeeLedgerEntry]:
    rows = (
        db.query(models.EmployeeTransaction)
        .filter(models.EmployeeTransaction.contract_employee_id == contract_employee_id)
        .order_by(models.EmployeeTransaction.created_at.asc(), models.EmployeeTransaction.id.asc())
        .all()
    )
    if not rows:
        return []

    payment_ids = [int(t.id) for t in rows if t.txn_type == "payment" and t.id is not None]
    if initiated_by_by_txn_id is None:
        initiated_by_by_txn_id = _payment_initiated_by(db, payment_ids)

    ctx = build_accounting_context(db, contract_employee_id, transactions=rows)
    orig_by_id = ctx.orig_by_id

    running = Decimal("0")
    entries: list[ContractEmployeeLedgerEntry] = []

    for txn in rows:
        tid = int(txn.id)
        initiated_by = initiated_by_by_txn_id.get(tid)
        ledger_type = _classify_ledger_type(txn, initiated_by=initiated_by, orig_by_id=orig_by_id)
        credit, debit = _display_credit_debit(txn, ledger_type=ledger_type, orig_by_id=orig_by_id)
        balance_before = running
        delta = transaction_balance_delta(txn, ctx)
        balance_after = balance_before + delta
        running = balance_after

        entries.append(
            ContractEmployeeLedgerEntry(
                transaction=txn,
                ledger_type=ledger_type,
                transaction_type_label=LEDGER_TYPE_LABELS.get(ledger_type, "Other"),
                description=_ledger_description(txn, ledger_type=ledger_type, initiated_by=initiated_by),
                reference=_ledger_reference(txn, ledger_type=ledger_type),
                credit=credit,
                debit=debit,
                balance_before=balance_before,
                balance_after=balance_after,
                status_label=_status_label(txn),
                initiated_by=initiated_by,
            )
        )

    return entries


def filter_ledger_entries(
    entries: list[ContractEmployeeLedgerEntry],
    *,
    ledger_type: Optional[str] = None,
    status: Optional[str] = None,
    job_id: Optional[int] = None,
    payment_request_id: Optional[int] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    search: Optional[str] = None,
) -> list[ContractEmployeeLedgerEntry]:
    out = entries

    if ledger_type:
        lt = ledger_type.strip().lower()
        out = [e for e in out if e.ledger_type == lt]

    if status:
        st = status.strip().lower()
        out = [e for e in out if (e.transaction.status or "").lower() == st or e.status_label.lower().replace(" ", "_") == st]

    if job_id is not None:
        jid = int(job_id)
        out = [
            e
            for e in out
            if e.transaction.contract_job_id == jid
            or any(
                int(getattr(a, "contract_job_id", 0) or 0) == jid
                for a in (getattr(e.transaction, "allocations", None) or [])
            )
        ]

    if payment_request_id is not None:
        prid = int(payment_request_id)
        out = [e for e in out if int(e.transaction.id) == prid]

    if date_from is not None:
        out = [e for e in out if e.transaction.created_at and e.transaction.created_at >= date_from]
    if date_to is not None:
        out = [e for e in out if e.transaction.created_at and e.transaction.created_at <= date_to]

    if search:
        q = search.strip().lower()
        if q:
            def _matches(e: ContractEmployeeLedgerEntry) -> bool:
                txn = e.transaction
                hay = " ".join(
                    [
                        str(txn.id),
                        e.description,
                        e.reference,
                        e.transaction_type_label,
                        e.status_label,
                        txn.note or "",
                        txn.txn_type or "",
                        txn.status or "",
                    ]
                ).lower()
                if q.startswith("#") and q[1:].isdigit():
                    return str(txn.id) == q[1:] or f"#{txn.id}" in hay
                return q in hay

            out = [e for e in out if _matches(e)]

    return out


def paginate_ledger_entries(
    entries: list[ContractEmployeeLedgerEntry],
    *,
    limit: int,
    offset: int,
    sort: Literal["newest", "oldest"] = "newest",
) -> tuple[list[ContractEmployeeLedgerEntry], int]:
    ordered = list(entries)
    if sort == "newest":
        ordered.reverse()
    total = len(ordered)
    page = ordered[offset : offset + limit]
    return page, total
