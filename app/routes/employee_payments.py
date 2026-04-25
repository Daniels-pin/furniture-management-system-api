from __future__ import annotations

import csv
import io
from datetime import datetime
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app import models
from app.auth.auth import normalize_role, require_role
from app.database import get_db
from app.schemas import (
    EmployeePaymentMarkPaidIn,
    AdminApprovePaymentRequestIn,
    AdminSendPaymentToFinanceIn,
    PendingEmployeePaymentItem,
    PendingEmployeePaymentsOut,
    EmployeeTransactionOut,
)
from app.utils.cloudinary import upload_asset
from app.utils.financial_audit import log_financial_action

router = APIRouter(prefix="/employee-payments", tags=["Employee Payments"])


def _as_decimal(v) -> Decimal:
    return Decimal(str(v or 0))


@router.get("/pending", response_model=PendingEmployeePaymentsOut)
def list_pending_payments(
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "finance"])),
    search: str = Query("", max_length=200),
    kind: Optional[str] = Query(None, description="monthly | contract"),
    overpaid: Optional[bool] = Query(None, description="true shows employees with balance < 0 (contract only)"),
    sort: str = Query("oldest", description="oldest | newest | amount_desc | amount_asc"),
):
    role = normalize_role(getattr(current_user, "role", None))
    q = db.query(models.EmployeeTransaction).filter(models.EmployeeTransaction.txn_type == "payment")

    # Role visibility rules:
    # - Admin: sees employee requests and items awaiting finance
    # - Finance: MUST ONLY see sent_to_finance items
    if role == "finance":
        q = q.filter(models.EmployeeTransaction.status.in_(["sent_to_finance", "pending"]))
    else:
        q = q.filter(models.EmployeeTransaction.status.in_(["requested", "approved_by_admin", "sent_to_finance", "pending"]))
    if kind == "contract":
        q = q.filter(models.EmployeeTransaction.contract_employee_id.isnot(None))
    elif kind == "monthly":
        q = q.filter(models.EmployeeTransaction.employee_id.isnot(None))

    s = (search or "").strip()
    if s:
        emp_ids = [int(x) for (x,) in db.query(models.Employee.id).filter(models.Employee.full_name.ilike(f"%{s}%")).all()]
        ce_ids = [
            int(x)
            for (x,) in db.query(models.ContractEmployee.id).filter(models.ContractEmployee.full_name.ilike(f"%{s}%")).all()
        ]
        q = q.filter(
            or_(
                models.EmployeeTransaction.employee_id.in_(emp_ids) if emp_ids else False,
                models.EmployeeTransaction.contract_employee_id.in_(ce_ids) if ce_ids else False,
            )
        )

    if sort == "newest":
        q = q.order_by(models.EmployeeTransaction.created_at.desc(), models.EmployeeTransaction.id.desc())
    elif sort == "amount_desc":
        q = q.order_by(models.EmployeeTransaction.amount.desc(), models.EmployeeTransaction.id.desc())
    elif sort == "amount_asc":
        q = q.order_by(models.EmployeeTransaction.amount.asc(), models.EmployeeTransaction.id.asc())
    else:
        q = q.order_by(models.EmployeeTransaction.created_at.asc(), models.EmployeeTransaction.id.asc())

    rows = q.all()

    items: list[PendingEmployeePaymentItem] = []
    total = Decimal("0")
    for t in rows:
        total += _as_decimal(t.amount)
        if t.contract_employee_id is not None:
            ce = db.query(models.ContractEmployee).filter(models.ContractEmployee.id == t.contract_employee_id).first()
            if overpaid is True and ce and _as_decimal(ce.balance) >= 0:
                continue
            if overpaid is False and ce and _as_decimal(ce.balance) < 0:
                continue
            items.append(
                PendingEmployeePaymentItem(
                    transaction=EmployeeTransactionOut.model_validate(t),
                    employee_kind="contract",
                    employee_id=int(t.contract_employee_id),
                    employee_name=ce.full_name if ce else "Contract employee",
                    account_number=(ce.account_number if ce else None),
                    phone=(ce.phone if ce else None),
                    period_label=None,
                )
            )
        else:
            emp = db.query(models.Employee).filter(models.Employee.id == t.employee_id).first()
            period_label: Optional[str] = None
            if t.period_id:
                p = db.query(models.SalaryPeriod).filter(models.SalaryPeriod.id == t.period_id).first()
                period_label = p.label if p else None
            items.append(
                PendingEmployeePaymentItem(
                    transaction=EmployeeTransactionOut.model_validate(t),
                    employee_kind="monthly",
                    employee_id=int(t.employee_id or 0),
                    employee_name=emp.full_name if emp else "Employee",
                    account_number=(emp.account_number if emp else None),
                    phone=(emp.phone if emp else None),
                    period_label=period_label,
                )
            )

    return PendingEmployeePaymentsOut(total_pending_amount=total, items=items)


@router.post("/{transaction_id}/admin-approve", response_model=EmployeeTransactionOut)
def admin_approve_payment_request(
    transaction_id: int,
    body: AdminApprovePaymentRequestIn,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    t = db.query(models.EmployeeTransaction).filter(models.EmployeeTransaction.id == transaction_id).first()
    if t is None:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if t.txn_type != "payment":
        raise HTTPException(status_code=400, detail="Only payment requests can be approved.")
    if t.status not in ("requested",):
        # Allow legacy pending to be treated as already in finance queue.
        raise HTTPException(status_code=409, detail="Only requested payments can be approved.")

    if body.amount_override is not None:
        t.amount = _as_decimal(body.amount_override)
    if body.note is not None and str(body.note).strip():
        t.note = str(body.note).strip()
    t.status = "approved_by_admin"
    t.processed_by_id = current_user.id
    t.processed_by_role = "admin"

    # Notify employee (if a contract employee with a linked user account).
    if t.contract_employee_id is not None:
        ce = db.query(models.ContractEmployee).filter(models.ContractEmployee.id == t.contract_employee_id).first()
        if ce and ce.user_id:
            from app.utils.notifications import create_notifications

            create_notifications(
                db,
                recipient_user_ids=[int(ce.user_id)],
                kind="payment_approved",
                title="Payment approved",
                message=f"Amount: {str(_as_decimal(t.amount))}",
                entity_type="employee_transaction",
                entity_id=int(t.id),
            )

    log_financial_action(
        db,
        action="payment_request_approved",
        entity_type="employee_transaction",
        entity_id=t.id,
        actor_user=current_user,
        meta={"amount": str(_as_decimal(t.amount)), "contract_employee_id": t.contract_employee_id, "employee_id": t.employee_id},
    )
    db.commit()
    db.refresh(t)
    return EmployeeTransactionOut.model_validate(t)


@router.post("/{transaction_id}/send-to-finance", response_model=EmployeeTransactionOut)
def admin_send_payment_to_finance(
    transaction_id: int,
    body: AdminSendPaymentToFinanceIn | None = None,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    t = db.query(models.EmployeeTransaction).filter(models.EmployeeTransaction.id == transaction_id).first()
    if t is None:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if t.txn_type != "payment":
        raise HTTPException(status_code=400, detail="Only payment requests can be sent to Finance.")
    if t.status not in ("approved_by_admin", "requested"):
        # Legacy 'pending' is already in Finance queue.
        raise HTTPException(status_code=409, detail="Payment is not eligible to send to Finance.")

    # If admin sends directly without explicit approval, we still move it through approved state.
    if t.status == "requested":
        t.status = "approved_by_admin"
    if body and body.note is not None and str(body.note).strip():
        t.note = str(body.note).strip()
    t.status = "sent_to_finance"

    log_financial_action(
        db,
        action="payment_sent_to_finance",
        entity_type="employee_transaction",
        entity_id=t.id,
        actor_user=current_user,
        meta={"amount": str(_as_decimal(t.amount)), "contract_employee_id": t.contract_employee_id, "employee_id": t.employee_id},
    )

    # Notify finance users
    finance_ids = [int(uid) for (uid,) in db.query(models.User.id).filter(models.User.role == "finance").all() if uid is not None]
    if finance_ids:
        from app.utils.notifications import create_notifications

        create_notifications(
            db,
            recipient_user_ids=finance_ids,
            kind="payment_sent_to_finance",
            title="Payment sent to Finance",
            message=f"Amount: {str(_as_decimal(t.amount))}",
            entity_type="employee_transaction",
            entity_id=int(t.id),
        )

    db.commit()
    db.refresh(t)
    return EmployeeTransactionOut.model_validate(t)


@router.post("/{transaction_id}/receipt", response_model=EmployeeTransactionOut)
async def upload_payment_receipt(
    transaction_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "finance"])),
    file: UploadFile = File(...),
    label: Optional[str] = Form(None),
):
    t = db.query(models.EmployeeTransaction).filter(models.EmployeeTransaction.id == transaction_id).first()
    if t is None:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if t.status != "pending":
        raise HTTPException(status_code=409, detail="Transaction is locked.")
    if t.txn_type != "payment":
        raise HTTPException(status_code=400, detail="Receipt upload is only supported for payment transactions.")
    if t.receipt_url:
        raise HTTPException(status_code=409, detail="Receipt already uploaded.")
    url = upload_asset(file, folder="employee_payment_receipts")
    t.receipt_url = url
    if label and str(label).strip():
        t.note = (t.note or "").strip() or None
    log_financial_action(
        db,
        action="receipt_uploaded",
        entity_type="employee_transaction",
        entity_id=t.id,
        actor_user=current_user,
        meta={"receipt_url": url},
    )
    db.commit()
    db.refresh(t)
    return EmployeeTransactionOut.model_validate(t)


@router.get("/export", response_class=StreamingResponse)
def export_transactions_csv(
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "finance"])),
    employee_id: Optional[int] = Query(None),
    contract_employee_id: Optional[int] = Query(None),
):
    """Export transaction history as CSV for a single employee (monthly or contract)."""
    if bool(employee_id) == bool(contract_employee_id):
        raise HTTPException(status_code=400, detail="Provide exactly one of employee_id or contract_employee_id.")
    q = db.query(models.EmployeeTransaction)
    label = "transactions"
    if employee_id:
        q = q.filter(models.EmployeeTransaction.employee_id == int(employee_id))
        emp = db.query(models.Employee).filter(models.Employee.id == int(employee_id)).first()
        label = (emp.full_name if emp else f"employee_{employee_id}").replace(" ", "_")
    else:
        q = q.filter(models.EmployeeTransaction.contract_employee_id == int(contract_employee_id or 0))
        emp = db.query(models.ContractEmployee).filter(models.ContractEmployee.id == int(contract_employee_id or 0)).first()
        label = (emp.full_name if emp else f"contract_{contract_employee_id}").replace(" ", "_")

    rows = q.order_by(models.EmployeeTransaction.created_at.asc(), models.EmployeeTransaction.id.asc()).all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(
        [
            "ID",
            "Created at",
            "Paid at",
            "Cancelled at",
            "Type",
            "Status",
            "Amount",
            "Running balance",
            "Reversal of",
            "Note",
            "Receipt URL",
            "Cancelled reason",
        ]
    )
    for t in rows:
        w.writerow(
            [
                t.id,
                t.created_at.isoformat() if t.created_at else "",
                t.paid_at.isoformat() if t.paid_at else "",
                t.cancelled_at.isoformat() if getattr(t, "cancelled_at", None) else "",
                t.txn_type,
                t.status,
                str(_as_decimal(t.amount)),
                str(_as_decimal(t.running_balance)) if t.running_balance is not None else "",
                str(t.reversal_of_id) if t.reversal_of_id else "",
                t.note or "",
                t.receipt_url or "",
                (getattr(t, "cancelled_reason", None) or ""),
            ]
        )
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{label}_transactions.csv"'},
    )


@router.post("/bulk-send")
def bulk_send_to_finance(
    body: dict,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    """Bulk send multiple payments to Finance (Admin only)."""
    items = body.get("items") if isinstance(body, dict) else None
    if not isinstance(items, list) or not items:
        raise HTTPException(status_code=400, detail="items must be a non-empty list")

    created_ids: list[int] = []
    for it in items:
        if not isinstance(it, dict):
            raise HTTPException(status_code=400, detail="Invalid items payload")
        kind = (it.get("employee_kind") or "").strip()
        amount = Decimal(str(it.get("amount") or 0))
        note = it.get("note")
        if amount <= 0:
            raise HTTPException(status_code=400, detail="amount must be > 0")
        if kind == "contract":
            ce_id = int(it.get("employee_id") or 0)
            if ce_id <= 0:
                raise HTTPException(status_code=400, detail="employee_id is required for contract")
            existing = (
                db.query(models.EmployeeTransaction)
                .filter(
                    models.EmployeeTransaction.contract_employee_id == ce_id,
                    models.EmployeeTransaction.txn_type == "payment",
                    models.EmployeeTransaction.status == "pending",
                )
                .first()
            )
            if existing:
                continue
            txn = models.EmployeeTransaction(
                contract_employee_id=ce_id,
                txn_type="payment",
                amount=amount,
                status="pending",
                note=(str(note).strip() if isinstance(note, str) else None),
                created_by_id=current_user.id,
            )
            db.add(txn)
            db.flush()
            created_ids.append(int(txn.id))
            log_financial_action(
                db,
                action="send_to_finance_bulk",
                entity_type="employee_transaction",
                entity_id=txn.id,
                actor_user=current_user,
                meta={"employee_kind": "contract", "contract_employee_id": ce_id, "amount": str(amount)},
            )
        elif kind == "monthly":
            emp_id = int(it.get("employee_id") or 0)
            period_year = int(it.get("period_year") or 0)
            period_month = int(it.get("period_month") or 0)
            if emp_id <= 0 or period_year <= 0 or period_month <= 0:
                raise HTTPException(status_code=400, detail="employee_id, period_year, and period_month are required for monthly")
            period = (
                db.query(models.SalaryPeriod)
                .filter(models.SalaryPeriod.year == period_year, models.SalaryPeriod.month == period_month)
                .first()
            )
            if period is None:
                raise HTTPException(status_code=404, detail="Salary period not found")
            if not period.is_active:
                raise HTTPException(status_code=403, detail="This salary period is archived.")
            existing = (
                db.query(models.EmployeeTransaction)
                .filter(
                    models.EmployeeTransaction.employee_id == emp_id,
                    models.EmployeeTransaction.period_id == period.id,
                    models.EmployeeTransaction.txn_type == "payment",
                    models.EmployeeTransaction.status == "pending",
                )
                .first()
            )
            if existing:
                continue
            txn = models.EmployeeTransaction(
                employee_id=emp_id,
                period_id=period.id,
                txn_type="payment",
                amount=amount,
                status="pending",
                note=(str(note).strip() if isinstance(note, str) else None),
                created_by_id=current_user.id,
            )
            db.add(txn)
            db.flush()
            created_ids.append(int(txn.id))
            log_financial_action(
                db,
                action="send_to_finance_bulk",
                entity_type="employee_transaction",
                entity_id=txn.id,
                actor_user=current_user,
                meta={
                    "employee_kind": "monthly",
                    "employee_id": emp_id,
                    "period_id": period.id,
                    "period_label": period.label,
                    "amount": str(amount),
                },
            )
        else:
            raise HTTPException(status_code=400, detail="employee_kind must be 'monthly' or 'contract'")

    db.commit()
    return {"created_transaction_ids": created_ids, "created": len(created_ids)}


@router.post("/{transaction_id}/mark-paid", response_model=EmployeeTransactionOut)
def mark_payment_as_paid(
    transaction_id: int,
    confirm_without_receipt: bool = Query(False),
    confirm_overpay: bool = Query(False),
    body: EmployeePaymentMarkPaidIn | None = None,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "finance"])),
):
    t = db.query(models.EmployeeTransaction).filter(models.EmployeeTransaction.id == transaction_id).first()
    if t is None:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if t.txn_type != "payment":
        raise HTTPException(status_code=400, detail="Only payment transactions can be marked paid here.")
    if t.status == "paid" or t.status == "cancelled":
        raise HTTPException(status_code=409, detail="Transaction is already finalized.")

    role = normalize_role(getattr(current_user, "role", None))
    if role == "finance" and t.status not in ("sent_to_finance", "pending"):
        raise HTTPException(status_code=403, detail="Finance can only confirm payments sent to finance.")
    if role == "finance" and not t.receipt_url:
        raise HTTPException(status_code=400, detail="Receipt is required for Finance to confirm payment.")
    if role == "admin" and not t.receipt_url and not confirm_without_receipt:
        raise HTTPException(status_code=400, detail="confirm_without_receipt=true is required when no receipt is attached.")

    paid_at = datetime.utcnow()
    t.status = "paid"
    t.paid_at = paid_at
    t.processed_by_id = current_user.id
    t.processed_by_role = role

    # Optional admin/finance adjustment to requested amount.
    effective_amount = _as_decimal(body.amount_override) if (body and body.amount_override is not None) else _as_decimal(t.amount)
    if effective_amount <= 0:
        raise HTTPException(status_code=400, detail="amount must be > 0")
    if body and body.amount_override is not None:
        t.amount = effective_amount
    amt = effective_amount

    if t.contract_employee_id is not None:
        emp = db.query(models.ContractEmployee).filter(models.ContractEmployee.id == t.contract_employee_id).first()
        if emp is None:
            raise HTTPException(status_code=404, detail="Contract employee not found")

        # Enforce allocation to one or more jobs.
        allocations_in = body.allocations if body else []
        if not allocations_in:
            # Backward compatibility: allow single linked job id if present.
            if getattr(t, "contract_job_id", None):
                allocations_in = [{"contract_job_id": int(t.contract_job_id), "amount": amt}]
            else:
                raise HTTPException(status_code=400, detail="Allocations are required: select one or more jobs for this payment.")

        # Validate allocation sum equals effective amount.
        total_alloc = Decimal("0")
        for a in allocations_in:
            a_amt = _as_decimal(a["amount"] if isinstance(a, dict) else getattr(a, "amount", 0))
            if a_amt <= 0:
                raise HTTPException(status_code=400, detail="Allocation amounts must be > 0")
            total_alloc += a_amt
        if total_alloc != amt:
            raise HTTPException(status_code=400, detail=f"Allocation total ({total_alloc}) must equal payment amount ({amt}).")

        # Clear existing allocations (should be none for pending).
        db.query(models.EmployeePaymentAllocation).filter(models.EmployeePaymentAllocation.transaction_id == t.id).delete()

        # Create allocations and validate job ownership.
        for a in allocations_in:
            job_id = int(a["contract_job_id"] if isinstance(a, dict) else getattr(a, "contract_job_id", 0))
            if job_id <= 0:
                raise HTTPException(status_code=400, detail="contract_job_id must be > 0")
            job = db.query(models.ContractJob).filter(models.ContractJob.id == job_id).first()
            if job is None or job.contract_employee_id != int(t.contract_employee_id):
                raise HTTPException(status_code=400, detail=f"Job #{job_id} does not belong to this employee.")
            if job.status == "cancelled":
                raise HTTPException(status_code=409, detail=f"Job #{job_id} is cancelled and cannot receive payments.")
            db.add(
                models.EmployeePaymentAllocation(
                    transaction_id=t.id,
                    contract_job_id=job_id,
                    amount=_as_decimal(a["amount"] if isinstance(a, dict) else getattr(a, "amount", 0)),
                )
            )
        projected_total_owed = _as_decimal(emp.total_owed) - amt
        if projected_total_owed < 0 and not confirm_overpay:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "OVERPAY_CONFIRM_REQUIRED",
                    "message": "This payment will overpay the employee (employee will owe the company). पुष्टि confirm_overpay=true to proceed.",
                    "current_balance": str(_as_decimal(emp.total_owed)),
                    "amount": str(amt),
                    "projected_balance": str(projected_total_owed),
                },
            )
        # Core rule: confirmed payment increases total_paid and decreases total_owed.
        emp.total_paid = _as_decimal(emp.total_paid) + amt
        emp.total_owed = _as_decimal(emp.total_owed) - amt
        emp.balance = _as_decimal(emp.total_owed)
        emp.updated_at = paid_at
        t.running_balance = emp.balance
    else:
        # Monthly payroll: also mark the period paid to prevent duplicates.
        if t.employee_id is None or t.period_id is None:
            raise HTTPException(status_code=400, detail="Monthly payment is missing employee_id or period_id.")
        payroll = (
            db.query(models.EmployeePeriodPayroll)
            .filter_by(employee_id=t.employee_id, period_id=t.period_id)
            .first()
        )
        if payroll is None:
            payroll = models.EmployeePeriodPayroll(employee_id=t.employee_id, period_id=t.period_id, payment_status="unpaid")
            db.add(payroll)
            db.flush()
        if payroll.payment_status == "paid":
            raise HTTPException(status_code=409, detail="This payroll period is already marked paid.")
        payroll.payment_status = "paid"
        payroll.payment_date = paid_at
        payroll.updated_at = paid_at
        payroll.updated_by_id = current_user.id

    log_financial_action(
        db,
        action="payment_confirmed",
        entity_type="employee_transaction",
        entity_id=t.id,
        actor_user=current_user,
        meta={
            "txn_type": t.txn_type,
            "employee_id": t.employee_id,
            "contract_employee_id": t.contract_employee_id,
            "period_id": t.period_id,
            "amount": str(amt),
            "status": "paid",
            "processed_by_role": role,
        },
    )

    # Notifications:
    # - Contract employee: notify when payment completed
    # - Admins: notify when finance completed (optional)
    if t.contract_employee_id is not None:
        ce = db.query(models.ContractEmployee).filter(models.ContractEmployee.id == t.contract_employee_id).first()
        if ce and ce.user_id:
            from app.utils.notifications import create_notifications

            create_notifications(
                db,
                recipient_user_ids=[int(ce.user_id)],
                kind="payment_completed",
                title="Payment completed",
                message=f"Amount: {str(amt)}",
                entity_type="employee_transaction",
                entity_id=int(t.id),
            )
    if role == "finance":
        admin_ids = [int(uid) for (uid,) in db.query(models.User.id).filter(models.User.role == "admin").all() if uid is not None]
        if admin_ids:
            from app.utils.notifications import create_notifications

            create_notifications(
                db,
                recipient_user_ids=admin_ids,
                kind="payment_completed",
                title="Payment completed by Finance",
                message=f"Amount: {str(amt)}",
                entity_type="employee_transaction",
                entity_id=int(t.id),
            )
    db.commit()
    db.refresh(t)
    return EmployeeTransactionOut.model_validate(t)


@router.post("/{transaction_id}/reverse", response_model=EmployeeTransactionOut)
def reverse_transaction(
    transaction_id: int,
    reason: str = Query("", max_length=4000),
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    """Admin-only reversal. Creates a NEW transaction row linked to the original."""
    orig = db.query(models.EmployeeTransaction).filter(models.EmployeeTransaction.id == transaction_id).first()
    if orig is None:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if orig.status != "paid":
        raise HTTPException(status_code=409, detail="Only paid transactions can be reversed.")
    if orig.reversal_of_id is not None:
        raise HTTPException(status_code=400, detail="Cannot reverse a reversal transaction.")
    existing_rev = (
        db.query(models.EmployeeTransaction)
        .filter(models.EmployeeTransaction.reversal_of_id == orig.id)
        .first()
    )
    if existing_rev:
        raise HTTPException(status_code=409, detail="This transaction is already reversed.")

    now = datetime.utcnow()
    role = normalize_role(getattr(current_user, "role", None))
    amt = _as_decimal(orig.amount)

    rev = models.EmployeeTransaction(
        employee_id=orig.employee_id,
        contract_employee_id=orig.contract_employee_id,
        period_id=orig.period_id,
        txn_type="reversal",
        amount=amt,
        status="paid",
        note=(reason or "").strip() or None,
        receipt_url=None,
        created_at=now,
        paid_at=now,
        created_by_id=current_user.id,
        processed_by_id=current_user.id,
        processed_by_role=role,
        reversal_of_id=orig.id,
    )
    db.add(rev)
    db.flush()

    if orig.contract_employee_id is not None:
        emp = db.query(models.ContractEmployee).filter(models.ContractEmployee.id == orig.contract_employee_id).first()
        if emp is None:
            raise HTTPException(status_code=404, detail="Contract employee not found")
        if orig.txn_type == "payment":
            emp.total_paid = _as_decimal(emp.total_paid) - amt
        elif orig.txn_type == "owed_increase":
            emp.total_owed = _as_decimal(emp.total_owed) - amt
        elif orig.txn_type == "owed_decrease":
            emp.total_owed = _as_decimal(emp.total_owed) + amt
        else:
            raise HTTPException(status_code=400, detail="Unsupported original transaction type for reversal.")
        emp.balance = _as_decimal(emp.total_owed) - _as_decimal(emp.total_paid)
        emp.updated_at = now
        rev.running_balance = emp.balance

    log_financial_action(
        db,
        action="transaction_reversed",
        entity_type="employee_transaction",
        entity_id=rev.id,
        actor_user=current_user,
        meta={"original_transaction_id": orig.id, "original_txn_type": orig.txn_type, "amount": str(amt), "reason": reason or None},
    )
    db.commit()
    db.refresh(rev)
    return EmployeeTransactionOut.model_validate(rev)


@router.post("/{transaction_id}/cancel-pending", response_model=EmployeeTransactionOut)
def cancel_pending_payment(
    transaction_id: int,
    reason: str = Query("", max_length=4000),
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    """Admin-only cancellation for pending payment transactions.

    - Applies ONLY to status=pending and txn_type=payment
    - Does NOT affect balances (because not yet paid)
    - Preserves history by marking the existing row cancelled
    """
    t = db.query(models.EmployeeTransaction).filter(models.EmployeeTransaction.id == transaction_id).first()
    if t is None:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if t.txn_type != "payment":
        raise HTTPException(status_code=400, detail="Only payment transactions can be cancelled.")
    if t.status == "cancelled":
        raise HTTPException(status_code=409, detail="Transaction is already cancelled.")
    if t.status != "pending":
        raise HTTPException(status_code=409, detail="Only pending transactions can be cancelled.")

    now = datetime.utcnow()
    t.status = "cancelled"
    t.cancelled_at = now
    t.cancelled_by_id = current_user.id
    t.cancelled_reason = (reason or "").strip() or None

    log_financial_action(
        db,
        action="pending_payment_cancelled",
        entity_type="employee_transaction",
        entity_id=t.id,
        actor_user=current_user,
        meta={
            "txn_type": t.txn_type,
            "employee_id": t.employee_id,
            "contract_employee_id": t.contract_employee_id,
            "period_id": t.period_id,
            "amount": str(_as_decimal(t.amount)),
            "reason": t.cancelled_reason,
        },
    )
    db.commit()
    db.refresh(t)
    return EmployeeTransactionOut.model_validate(t)

