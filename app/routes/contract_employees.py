from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app import models
from app.auth.auth import require_role
from app.database import get_db
from app.utils.financial_audit import log_financial_action
from app.schemas import (
    ContractEmployeeCreate,
    ContractEmployeeIncreaseOwed,
    ContractEmployeeListItemOut,
    ContractEmployeeOut,
    ContractEmployeeUpdate,
    EmployeeSendPaymentToFinance,
    EmployeeTransactionOut,
)

router = APIRouter(prefix="/contract-employees", tags=["Contract Employees"])


def _to_out(emp: models.ContractEmployee) -> ContractEmployeeOut:
    return ContractEmployeeOut(
        id=emp.id,
        full_name=emp.full_name,
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
    return [ContractEmployeeListItemOut.model_validate(r) for r in rows]


@router.post("", response_model=ContractEmployeeOut)
def create_contract_employee(
    body: ContractEmployeeCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
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

    # Owed increase is applied immediately (paid/locked) by Admin.
    emp.total_owed = (Decimal(str(emp.total_owed or 0)) + amt)
    emp.balance = Decimal(str(emp.total_owed)) - Decimal(str(emp.total_paid or 0))
    emp.updated_at = datetime.utcnow()

    txn = models.EmployeeTransaction(
        contract_employee_id=emp.id,
        txn_type="owed_increase",
        amount=amt,
        status="paid",
        note=body.note,
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
        meta={"contract_employee_id": emp.id, "amount": str(amt), "note": body.note},
    )
    db.commit()
    db.refresh(emp)
    return _to_out(emp)


@router.post("/{employee_id}/payments/send-to-finance", response_model=EmployeeTransactionOut)
def send_contract_payment_to_finance(
    employee_id: int,
    body: EmployeeSendPaymentToFinance,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    emp = db.query(models.ContractEmployee).filter(models.ContractEmployee.id == employee_id).first()
    if emp is None:
        raise HTTPException(status_code=404, detail="Contract employee not found")
    amt = Decimal(str(body.amount))
    if amt <= 0:
        raise HTTPException(status_code=400, detail="amount must be > 0")
    existing = (
        db.query(models.EmployeeTransaction)
        .filter(
            models.EmployeeTransaction.contract_employee_id == employee_id,
            models.EmployeeTransaction.txn_type == "payment",
            models.EmployeeTransaction.status == "pending",
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="This employee already has a pending payment.")

    txn = models.EmployeeTransaction(
        contract_employee_id=employee_id,
        txn_type="payment",
        amount=amt,
        status="pending",
        note=body.note,
        created_by_id=current_user.id,
    )
    db.add(txn)
    db.flush()
    log_financial_action(
        db,
        action="send_to_finance",
        entity_type="employee_transaction",
        entity_id=txn.id,
        actor_user=current_user,
        meta={"employee_kind": "contract", "contract_employee_id": employee_id, "amount": str(amt), "note": body.note},
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

