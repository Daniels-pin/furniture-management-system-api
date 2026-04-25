from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models
from app.auth.auth import require_role
from app.database import get_db
from app.schemas import ContractEmployeeMeOut, ContractEmployeeMeUpdate
from app.schemas import EmployeeSendPaymentToFinance, EmployeeTransactionOut
from app.utils.financial_audit import log_financial_action
from app.utils.notifications import create_notifications

router = APIRouter(prefix="/contract-employee", tags=["Contract Employee Portal"])


def _needs_completion(ce: models.ContractEmployee) -> bool:
    required = [
        (ce.full_name or "").strip(),
        (getattr(ce, "account_number", None) or "").strip(),
        (getattr(ce, "bank_name", None) or "").strip(),
        (getattr(ce, "phone", None) or "").strip(),
        (getattr(ce, "address", None) or "").strip(),
    ]
    return any(not x for x in required)


@router.get("/me", response_model=ContractEmployeeMeOut)
def me(
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["contract_employee"])),
):
    ce = db.query(models.ContractEmployee).filter(models.ContractEmployee.user_id == current_user.id).first()
    if ce is None:
        raise HTTPException(status_code=404, detail="No contract employee profile linked to your account.")
    out = ContractEmployeeMeOut.model_validate(ce)
    out.needs_profile_completion = _needs_completion(ce)
    out.needs_password_change = bool(getattr(current_user, "must_change_password", False))
    return out


@router.patch("/me", response_model=ContractEmployeeMeOut)
def patch_me(
    body: ContractEmployeeMeUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["contract_employee"])),
):
    ce = db.query(models.ContractEmployee).filter(models.ContractEmployee.user_id == current_user.id).first()
    if ce is None:
        raise HTTPException(status_code=404, detail="No contract employee profile linked to your account.")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(ce, k, v)
    ce.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(ce)
    out = ContractEmployeeMeOut.model_validate(ce)
    out.needs_profile_completion = _needs_completion(ce)
    out.needs_password_change = bool(getattr(current_user, "must_change_password", False))
    return out


@router.post("/payments/request", response_model=EmployeeTransactionOut)
def request_payment(
    body: EmployeeSendPaymentToFinance,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["contract_employee"])),
):
    ce = db.query(models.ContractEmployee).filter(models.ContractEmployee.user_id == current_user.id).first()
    if ce is None:
        raise HTTPException(status_code=404, detail="No contract employee profile linked to your account.")
    if bool(getattr(current_user, "must_change_password", False)):
        raise HTTPException(status_code=403, detail="Change your password to continue.")
    if _needs_completion(ce):
        raise HTTPException(status_code=403, detail="Complete your profile to continue.")
    # Prevent duplicate open requests.
    existing = (
        db.query(models.EmployeeTransaction)
        .filter(
            models.EmployeeTransaction.contract_employee_id == ce.id,
            models.EmployeeTransaction.txn_type == "payment",
            models.EmployeeTransaction.status.in_(["requested", "approved_by_admin", "sent_to_finance", "pending"]),
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="You already have a pending payment request.")

    # `total_owed` is the live/net owed amount (positive => company owes employee).
    bal = Decimal(str(ce.total_owed or 0))
    amt = Decimal(str(body.amount))
    if bal <= 0:
        raise HTTPException(status_code=409, detail="You have no outstanding balance to request.")
    if amt > bal:
        raise HTTPException(status_code=400, detail=f"amount cannot exceed current balance ({bal}).")

    txn = models.EmployeeTransaction(
        contract_employee_id=ce.id,
        txn_type="payment",
        amount=amt,
        status="requested",
        note=body.note,
        created_by_id=current_user.id,
    )
    db.add(txn)
    db.flush()
    log_financial_action(
        db,
        action="contract_employee_payment_requested",
        entity_type="employee_transaction",
        entity_id=txn.id,
        actor_user=current_user,
        meta={"contract_employee_id": ce.id, "amount": str(body.amount), "note": body.note},
    )
    db.commit()
    db.refresh(txn)

    # Notify admin + finance users about the new request.
    # Finance must not see raw employee requests. Only Admin is notified at this step.
    recipients = [int(uid) for (uid,) in db.query(models.User.id).filter(models.User.role == "admin").all()]
    if recipients:
        create_notifications(
            db,
            recipient_user_ids=recipients,
            kind="payment_request_submitted",
            title=f"Payment request submitted ({ce.full_name})",
            message=f"Amount: {str(amt)}",
            entity_type="employee_transaction",
            entity_id=int(txn.id),
        )
        db.commit()

    return EmployeeTransactionOut.model_validate(txn)


@router.get("/jobs/unpaid-completed")
def list_unpaid_completed_jobs(
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["contract_employee"])),
):
    """Jobs completed but not yet marked paid (flag only, does not affect money)."""
    ce = db.query(models.ContractEmployee).filter(models.ContractEmployee.user_id == current_user.id).first()
    if ce is None:
        raise HTTPException(status_code=404, detail="No contract employee profile linked to your account.")
    rows = (
        db.query(models.ContractJob)
        .filter(
            models.ContractJob.contract_employee_id == ce.id,
            models.ContractJob.status == "completed",
            models.ContractJob.paid_flag.is_(False),
        )
        .order_by(models.ContractJob.completed_at.asc().nulls_last(), models.ContractJob.id.asc())
        .all()
    )
    return {
        "items": [
            {
                "id": int(j.id),
                "completed_at": (j.completed_at.isoformat() if j.completed_at else None),
                "final_price": (str(j.final_price) if j.final_price is not None else None),
            }
            for j in rows
        ]
    }

