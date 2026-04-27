from __future__ import annotations

import logging
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app import models
from app.auth.auth import require_role
from app.database import get_db
from app.utils.financial_audit import log_financial_action
from app.auth.utils import hash_password
from app.schemas import (
    ContractEmployeeCreate,
    ContractEmployeeCreateWithLogin,
    ContractEmployeeIncreaseOwed,
    ContractEmployeeDecreaseOwed,
    ContractEmployeeLinkUser,
    ContractEmployeeListItemOut,
    ContractEmployeeOut,
    ContractEmployeeFinanceOut,
    ContractJobFinanceRow,
    ContractEmployeeUpdate,
    ContractEmployeeSendPaymentToFinanceIn,
    EmployeeSendPaymentToFinance,
    EmployeeTransactionOut,
)

router = APIRouter(prefix="/contract-employees", tags=["Contract Employees"])
logger = logging.getLogger(__name__)


def _to_out(emp: models.ContractEmployee) -> ContractEmployeeOut:
    return ContractEmployeeOut(
        id=emp.id,
        full_name=emp.full_name,
        bank_name=getattr(emp, "bank_name", None),
        account_number=emp.account_number,
        phone=emp.phone,
        address=emp.address,
        status=emp.status,
        total_owed=Decimal(str(emp.total_owed or 0)),
        total_paid=Decimal(str(emp.total_paid or 0)),
        balance=Decimal(str(emp.balance or 0)),
        transactions=[EmployeeTransactionOut.model_validate(t) for t in (emp.transactions or [])],
        created_at=emp.created_at,
        updated_at=emp.updated_at,
    )


@router.get("", response_model=list[ContractEmployeeListItemOut])
def list_contract_employees(
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
    search: str = Query("", max_length=200),
    status: str | None = Query(None, description="active | inactive | all"),
    overpaid: bool | None = Query(None, description="true => balance < 0"),
):
    q = db.query(models.ContractEmployee)
    s = (search or "").strip()
    if s:
        q = q.filter(models.ContractEmployee.full_name.ilike(f"%{s}%"))
    # Default behavior: hide inactive employees unless explicitly requested.
    if status is None:
        q = q.filter(models.ContractEmployee.status == "active")
    elif status in ("active", "inactive"):
        q = q.filter(models.ContractEmployee.status == status)
    elif status == "all":
        pass
    if overpaid is True:
        q = q.filter(models.ContractEmployee.balance < 0)
    if overpaid is False:
        q = q.filter(models.ContractEmployee.balance >= 0)
    rows = q.order_by(models.ContractEmployee.id.desc()).all()
    # Enrich list rows with dashboard metrics.
    out: list[ContractEmployeeListItemOut] = []
    for r in rows:
        active_jobs = (
            db.query(models.ContractJob)
            .filter(
                models.ContractJob.contract_employee_id == r.id,
                models.ContractJob.status.in_(["pending", "in_progress"]),
            )
            .count()
        )
        pending_requests = (
            db.query(models.EmployeeTransaction)
            .filter(
                models.EmployeeTransaction.contract_employee_id == r.id,
                models.EmployeeTransaction.txn_type == "payment",
                models.EmployeeTransaction.status.in_(["requested", "approved_by_admin", "sent_to_finance", "pending"]),
            )
            .count()
        )
        item = ContractEmployeeListItemOut.model_validate(r)
        item.active_jobs_count = int(active_jobs)
        item.pending_requests = int(pending_requests)
        out.append(item)
    return out


@router.post("", response_model=ContractEmployeeOut)
def create_contract_employee(
    body: ContractEmployeeCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "factory"])),
):
    emp = models.ContractEmployee(
        full_name=body.full_name.strip(),
        account_number=body.account_number,
        phone=body.phone,
        address=body.address,
        status=body.status,
        total_owed=0,
        total_paid=0,
        balance=0,
    )
    db.add(emp)
    db.commit()
    db.refresh(emp)
    return _to_out(emp)


@router.post("/create-with-login", response_model=ContractEmployeeOut)
def create_contract_employee_with_login(
    body: ContractEmployeeCreateWithLogin,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "factory"])),
):
    username = (body.username or "").strip()
    if not username:
        raise HTTPException(status_code=400, detail="username is required")

    # username must be unique (stored as User.email for backwards compatibility)
    existing_user = db.query(models.User).filter(models.User.email == username).first()
    if existing_user:
        raise HTTPException(status_code=409, detail="username must be unique")

    # Create user account with enforced role and mandatory password change.
    u = models.User(
        name=username,
        email=username,
        password=hash_password(body.password),
        role="contract_employee",
        must_change_password=True,
    )
    db.add(u)
    db.flush()

    full_name = (body.full_name or "").strip()
    emp = models.ContractEmployee(
        # allow minimal creation; profile completed on first login
        full_name=full_name,
        bank_name=body.bank_name,
        account_number=body.account_number,
        phone=body.phone,
        address=body.address,
        status=body.status,
        user_id=u.id,
        total_owed=0,
        total_paid=0,
        balance=0,
    )
    db.add(emp)
    db.commit()
    db.refresh(emp)
    return _to_out(emp)


@router.get("/{employee_id}", response_model=ContractEmployeeOut)
def get_contract_employee(
    employee_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    emp = db.query(models.ContractEmployee).filter(models.ContractEmployee.id == employee_id).first()
    if emp is None:
        raise HTTPException(status_code=404, detail="Contract employee not found")
    return _to_out(emp)


@router.post("/{employee_id}/reset-password")
def admin_reset_contract_employee_password(
    employee_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    # Body: { "new_password": "..." , "force_change_on_next_login": true|false }
    new_password = str(body.get("new_password") or "").strip()
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    force_change = body.get("force_change_on_next_login")
    if force_change is None:
        force_change = True
    force_change = bool(force_change)

    emp = db.query(models.ContractEmployee).filter(models.ContractEmployee.id == employee_id).first()
    if emp is None:
        raise HTTPException(status_code=404, detail="Contract employee not found")
    if emp.user_id is None:
        raise HTTPException(status_code=409, detail="This contract employee has no linked login account.")

    u = db.query(models.User).filter(models.User.id == emp.user_id).first()
    if u is None:
        raise HTTPException(status_code=404, detail="User not found")
    if (u.role or "") != "contract_employee":
        raise HTTPException(status_code=409, detail="Linked user is not a contract_employee account.")

    u.password = hash_password(new_password)
    u.must_change_password = force_change
    db.commit()
    return {"message": "Password reset"}


@router.patch("/{employee_id}", response_model=ContractEmployeeOut)
def patch_contract_employee(
    employee_id: int,
    body: ContractEmployeeUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    emp = db.query(models.ContractEmployee).filter(models.ContractEmployee.id == employee_id).first()
    if emp is None:
        raise HTTPException(status_code=404, detail="Contract employee not found")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(emp, k, v)
    emp.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(emp)
    return _to_out(emp)


@router.post("/{employee_id}/link-user", response_model=ContractEmployeeOut)
def link_contract_employee_user(
    employee_id: int,
    body: ContractEmployeeLinkUser,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    emp = db.query(models.ContractEmployee).filter(models.ContractEmployee.id == employee_id).first()
    if emp is None:
        raise HTTPException(status_code=404, detail="Contract employee not found")
    u = db.query(models.User).filter(models.User.id == int(body.user_id)).first()
    if u is None:
        raise HTTPException(status_code=404, detail="User not found")
    if (u.role or "") != "contract_employee":
        raise HTTPException(status_code=400, detail="User role must be contract_employee")
    taken = (
        db.query(models.ContractEmployee)
        .filter(models.ContractEmployee.user_id == u.id, models.ContractEmployee.id != employee_id)
        .first()
    )
    if taken:
        raise HTTPException(status_code=409, detail="That user is already linked to another contract employee.")
    emp.user_id = u.id
    emp.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(emp)
    return _to_out(emp)


@router.post("/{employee_id}/owed/increase", response_model=ContractEmployeeOut)
def increase_total_owed(
    employee_id: int,
    body: ContractEmployeeIncreaseOwed,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    emp = db.query(models.ContractEmployee).filter(models.ContractEmployee.id == employee_id).first()
    if emp is None:
        raise HTTPException(status_code=404, detail="Contract employee not found")
    amt = Decimal(str(body.amount))
    if amt <= 0:
        raise HTTPException(status_code=400, detail="amount must be > 0")
    note = (body.note or "").strip()
    if not note:
        raise HTTPException(status_code=400, detail="note is required")

    # Manual adjustments affect the live/net amount owed.
    emp.total_owed = (Decimal(str(emp.total_owed or 0)) + amt)
    emp.balance = Decimal(str(emp.total_owed))
    emp.updated_at = datetime.utcnow()

    txn = models.EmployeeTransaction(
        contract_employee_id=emp.id,
        txn_type="owed_increase",
        amount=amt,
        status="paid",
        note=note,
        created_by_id=current_user.id,
        processed_by_id=current_user.id,
        processed_by_role="admin",
        paid_at=datetime.utcnow(),
        running_balance=emp.balance,
    )
    db.add(txn)
    db.flush()
    log_financial_action(
        db,
        action="owed_increase",
        entity_type="employee_transaction",
        entity_id=txn.id,
        actor_user=current_user,
        meta={"contract_employee_id": emp.id, "amount": str(amt), "note": note},
    )
    db.commit()
    db.refresh(emp)
    return _to_out(emp)


@router.post("/{employee_id}/owed/decrease", response_model=ContractEmployeeOut)
def decrease_total_owed(
    employee_id: int,
    body: ContractEmployeeDecreaseOwed,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    emp = db.query(models.ContractEmployee).filter(models.ContractEmployee.id == employee_id).first()
    if emp is None:
        raise HTTPException(status_code=404, detail="Contract employee not found")
    amt = Decimal(str(body.amount))
    if amt <= 0:
        raise HTTPException(status_code=400, detail="amount must be > 0")
    note = (body.note or "").strip()
    if not note:
        raise HTTPException(status_code=400, detail="note is required")

    now = datetime.utcnow()
    emp.total_owed = (Decimal(str(emp.total_owed or 0)) - amt)
    emp.balance = Decimal(str(emp.total_owed))
    emp.updated_at = now

    txn = models.EmployeeTransaction(
        contract_employee_id=emp.id,
        txn_type="owed_decrease",
        amount=amt,
        status="paid",
        note=note,
        created_by_id=current_user.id,
        processed_by_id=current_user.id,
        processed_by_role="admin",
        paid_at=now,
        running_balance=emp.balance,
    )
    db.add(txn)
    db.flush()
    log_financial_action(
        db,
        action="owed_decrease",
        entity_type="employee_transaction",
        entity_id=txn.id,
        actor_user=current_user,
        meta={"contract_employee_id": emp.id, "amount": str(amt), "note": note},
    )
    db.commit()
    db.refresh(emp)
    return _to_out(emp)


@router.get("/{employee_id}/finances", response_model=ContractEmployeeFinanceOut)
def get_contract_employee_finances(
    employee_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    emp = db.query(models.ContractEmployee).filter(models.ContractEmployee.id == employee_id).first()
    if emp is None:
        raise HTTPException(status_code=404, detail="Contract employee not found")

    pending = (
        db.query(models.EmployeeTransaction)
        .filter(
            models.EmployeeTransaction.contract_employee_id == employee_id,
            models.EmployeeTransaction.txn_type == "payment",
            models.EmployeeTransaction.status.in_(["requested", "approved_by_admin", "sent_to_finance", "pending"]),
        )
        .order_by(models.EmployeeTransaction.created_at.asc(), models.EmployeeTransaction.id.asc())
        .first()
    )

    jobs = (
        db.query(models.ContractJob)
        .filter(models.ContractJob.contract_employee_id == employee_id, models.ContractJob.status != "cancelled")
        .order_by(models.ContractJob.id.desc())
        .all()
    )

    # Aggregate paid allocations per job.
    job_paid: dict[int, Decimal] = {}
    alloc_rows = (
        db.query(models.EmployeePaymentAllocation.contract_job_id, models.EmployeePaymentAllocation.amount)
        .join(models.EmployeeTransaction, models.EmployeeTransaction.id == models.EmployeePaymentAllocation.transaction_id)
        .filter(
            models.EmployeeTransaction.contract_employee_id == employee_id,
            models.EmployeeTransaction.txn_type == "payment",
            models.EmployeeTransaction.status == "paid",
        )
        .all()
    )
    for job_id, amt in alloc_rows:
        job_paid[int(job_id)] = job_paid.get(int(job_id), Decimal("0")) + Decimal(str(amt or 0))

    job_rows: list[ContractJobFinanceRow] = []
    for j in jobs:
        fp = Decimal(str(j.final_price or 0)) if j.final_price is not None else None
        paid_amt = job_paid.get(int(j.id), Decimal("0"))
        bal = (fp - paid_amt) if fp is not None else None
        job_rows.append(
            ContractJobFinanceRow(
                id=j.id,
                status=j.status,
                final_price=fp,
                amount_paid=paid_amt,
                balance=bal,
            )
        )

    txns = (
        db.query(models.EmployeeTransaction)
        .filter(models.EmployeeTransaction.contract_employee_id == employee_id)
        .order_by(models.EmployeeTransaction.created_at.desc(), models.EmployeeTransaction.id.desc())
        .all()
    )

    return ContractEmployeeFinanceOut(
        id=emp.id,
        full_name=emp.full_name,
        total_owed=Decimal(str(emp.total_owed or 0)),
        total_paid=Decimal(str(emp.total_paid or 0)),
        balance=Decimal(str(emp.balance or 0)),
        pending_payment=(EmployeeTransactionOut.model_validate(pending) if pending else None),
        jobs=job_rows,
        transactions=[EmployeeTransactionOut.model_validate(t) for t in txns],
    )


@router.post("/{employee_id}/payments/send-to-finance", response_model=EmployeeTransactionOut)
def send_contract_payment_to_finance(
    employee_id: int,
    body: ContractEmployeeSendPaymentToFinanceIn | EmployeeSendPaymentToFinance,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    emp = db.query(models.ContractEmployee).filter(models.ContractEmployee.id == employee_id).first()
    if emp is None:
        raise HTTPException(status_code=404, detail="Contract employee not found")

    # Preferred/modern behavior: process ONLY the specified request id.
    if isinstance(body, ContractEmployeeSendPaymentToFinanceIn):
        request_id = int(body.request_id)
        logger.info("contract_employee send-to-finance: request_id=%s contract_employee_id=%s", request_id, employee_id)

        t = (
            db.query(models.EmployeeTransaction)
            .filter(
                models.EmployeeTransaction.id == request_id,
                models.EmployeeTransaction.contract_employee_id == employee_id,
                models.EmployeeTransaction.txn_type == "payment",
            )
            .first()
        )
        if t is None:
            raise HTTPException(status_code=404, detail="Payment request not found")

        # Validation rules (ONLY)
        owed = Decimal(str(getattr(emp, "total_owed", 0) or 0))
        request_amt = Decimal(str(getattr(t, "amount", 0) or 0))
        pay_amt = Decimal(str(getattr(body, "amount", 0) or 0))
        if pay_amt <= 0:
            raise HTTPException(status_code=400, detail="amount must be > 0")
        if pay_amt > owed:
            raise HTTPException(status_code=400, detail=f"amount cannot exceed total owed ({owed}).")
        if pay_amt > request_amt:
            raise HTTPException(status_code=400, detail=f"amount cannot exceed request amount ({request_amt}).")
        if t.status == "paid" or getattr(t, "paid_at", None) is not None:
            raise HTTPException(status_code=409, detail="Request is already marked paid.")
        if t.status in ("sent_to_finance", "pending"):
            raise HTTPException(status_code=409, detail="Request is already sent to Finance.")
        if t.status not in ("requested", "approved_by_admin"):
            raise HTTPException(status_code=409, detail="Payment request is not eligible to send to Finance.")

        # Conflict rule: block ONLY if a DIFFERENT request is already in Finance queue for this employee.
        conflicting = (
            db.query(models.EmployeeTransaction)
            .filter(
                models.EmployeeTransaction.contract_employee_id == employee_id,
                models.EmployeeTransaction.txn_type == "payment",
                models.EmployeeTransaction.status.in_(["sent_to_finance", "pending"]),
                models.EmployeeTransaction.id != t.id,
            )
            .order_by(models.EmployeeTransaction.id.desc())
            .first()
        )
        if conflicting is not None:
            logger.info(
                "contract_employee send-to-finance conflict: request_id=%s conflicting_request_id=%s",
                request_id,
                int(conflicting.id),
            )
            raise HTTPException(status_code=409, detail="This employee already has a payment pending in Finance.")

        base_note = str(body.note).strip() if (body.note is not None and str(body.note).strip()) else None

        # Full payment: transition the same request into Finance queue.
        if pay_amt == request_amt:
            if base_note is not None:
                t.note = base_note
            # Allow same-record transition requested/approved_by_admin -> sent_to_finance
            t.status = "sent_to_finance"
            txn = t
        else:
            # Partial payment (CRITICAL RULE):
            # - The ORIGINAL request intent is FULLY RESOLVED once Admin sends ANY amount to Finance.
            # - The remaining amount MUST NOT remain as a pending request.
            # - The unpaid remainder stays in the employee's live balance/owed (handled by totals on payment confirmation),
            #   not as a request artifact.

            finance_note = base_note
            if finance_note is None:
                finance_note = f"Partial payment sent to Finance (from request #{t.id})"

            finance_txn = models.EmployeeTransaction(
                contract_employee_id=employee_id,
                txn_type="payment",
                amount=pay_amt,
                status="sent_to_finance",
                note=finance_note,
                created_by_id=current_user.id,
                processed_by_id=current_user.id,
                processed_by_role="admin",
            )
            db.add(finance_txn)
            db.flush()

            # Resolve (close) the original request WITHOUT changing its amount.
            t.status = "resolved"
            tail = f"Resolved by admin send-to-finance: {str(pay_amt)} from requested {str(request_amt)}."
            if t.note and str(t.note).strip():
                t.note = f"{str(t.note).strip()} | {tail}"
            else:
                t.note = tail
            t.processed_by_id = current_user.id
            t.processed_by_role = "admin"

            txn = finance_txn
    else:
        # Backward-compatible legacy behavior: create a new Finance-queue row from an amount.
        # (Kept for older clients; prefer request_id flow above.)
        amt = Decimal(str(body.amount))
        if amt <= 0:
            raise HTTPException(status_code=400, detail="amount must be > 0")
        conflicting = (
            db.query(models.EmployeeTransaction)
            .filter(
                models.EmployeeTransaction.contract_employee_id == employee_id,
                models.EmployeeTransaction.txn_type == "payment",
                models.EmployeeTransaction.status.in_(["sent_to_finance", "pending"]),
            )
            .first()
        )
        if conflicting is not None:
            logger.info(
                "contract_employee legacy send-to-finance conflict: contract_employee_id=%s conflicting_request_id=%s",
                employee_id,
                int(conflicting.id),
            )
            raise HTTPException(status_code=409, detail="This employee already has a payment pending in Finance.")

        txn = models.EmployeeTransaction(
            contract_employee_id=employee_id,
            txn_type="payment",
            amount=amt,
            status="sent_to_finance",
            note=body.note,
            created_by_id=current_user.id,
        )
        db.add(txn)
        db.flush()

    # Notify finance users
    finance_ids = [int(uid) for (uid,) in db.query(models.User.id).filter(models.User.role == "finance").all() if uid is not None]
    if finance_ids:
        from app.utils.notifications import create_notifications

        create_notifications(
            db,
            recipient_user_ids=finance_ids,
            kind="payment_sent_to_finance",
            title="Payment sent to Finance",
            message=f"Amount: {str(getattr(txn, 'amount', ''))}",
            entity_type="employee_transaction",
            entity_id=int(txn.id),
        )
    log_financial_action(
        db,
        action="send_to_finance",
        entity_type="employee_transaction",
        entity_id=txn.id,
        actor_user=current_user,
        meta={
            "employee_kind": "contract",
            "contract_employee_id": employee_id,
            "amount": str(getattr(txn, "amount", None)),
            "note": getattr(txn, "note", None),
        },
    )
    db.commit()
    db.refresh(txn)
    return EmployeeTransactionOut.model_validate(txn)


@router.delete("/{employee_id}")
def delete_contract_employee(
    employee_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    emp = db.query(models.ContractEmployee).filter(models.ContractEmployee.id == employee_id).first()
    if emp is None:
        raise HTTPException(status_code=404, detail="Contract employee not found")

    txn_count = (
        db.query(models.EmployeeTransaction)
        .filter(models.EmployeeTransaction.contract_employee_id == employee_id)
        .count()
    )

    if txn_count > 0:
        if emp.status != "inactive":
            emp.status = "inactive"
            emp.updated_at = datetime.utcnow()
            log_financial_action(
                db,
                action="contract_employee_inactivated",
                entity_type="contract_employee",
                entity_id=emp.id,
                actor_user=current_user,
                meta={"reason": "has_transaction_history", "transaction_count": txn_count},
            )
            db.commit()
        return {"action": "inactivated", "message": "Employee has transaction history and was marked inactive."}

    # No transaction history: allow permanent delete.
    log_financial_action(
        db,
        action="contract_employee_deleted",
        entity_type="contract_employee",
        entity_id=emp.id,
        actor_user=current_user,
        meta={"reason": "no_transaction_history"},
    )
    db.delete(emp)
    db.commit()
    return {"action": "deleted", "message": "Contract employee deleted."}

