from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app import models
from app.auth.auth import get_current_user, normalize_role, require_role
from app.database import get_db
from app.schemas import (
    ContractJobCancelBody,
    ContractJobCreateAdmin,
    ContractJobCreateEmployee,
    ContractJobOfferUpdate,
    ContractJobOut,
    EmployeeTransactionOut,
)
from app.utils.cloudinary import upload_image
from app.utils.financial_audit import log_financial_action
from app.utils.notifications import create_notifications
from app.utils.contract_financials import (
    _get_reversed_payment_ids,
    compute_contract_employee_financials,
    recalculate_contract_employee_financials,
)

router = APIRouter(prefix="/contract-jobs", tags=["Contract Jobs"])


def _as_decimal(v) -> Decimal:
    return Decimal(str(v or 0))


def _job_out(db: Session, j: models.ContractJob, *, employee_name: str | None = None) -> ContractJobOut:
    # We only treat finance-confirmed, non-reversed payment allocations as having financial impact.
    reversed_payment_ids = _get_reversed_payment_ids(db, int(j.contract_employee_id))

    tx = (
        db.query(models.EmployeeTransaction)
        .filter(models.EmployeeTransaction.contract_job_id == j.id)
        .order_by(models.EmployeeTransaction.created_at.asc(), models.EmployeeTransaction.id.asc())
        .all()
    )

    paid_alloc_q = (
        db.query(models.EmployeePaymentAllocation)
        .join(models.EmployeeTransaction, models.EmployeeTransaction.id == models.EmployeePaymentAllocation.transaction_id)
        .filter(
            models.EmployeePaymentAllocation.contract_job_id == j.id,
            models.EmployeePaymentAllocation.voided_at.is_(None),
            models.EmployeeTransaction.txn_type == "payment",
            models.EmployeeTransaction.status == "paid",
            or_(
                models.EmployeeTransaction.processed_by_role == "finance",
                models.EmployeeTransaction.receipt_url.isnot(None),
            ),
        )
    )
    if reversed_payment_ids:
        paid_alloc_q = paid_alloc_q.filter(models.EmployeeTransaction.id.notin_(reversed_payment_ids))
    paid_alloc_sum = paid_alloc_q.with_entities(models.EmployeePaymentAllocation.amount).all()
    amount_paid = sum((_as_decimal(a) for (a,) in paid_alloc_sum), Decimal("0"))
    bal = _as_decimal(j.final_price) - amount_paid if j.final_price is not None else None
    payment_state = "not_paid"
    if j.final_price is not None:
        fp = _as_decimal(j.final_price)
        if amount_paid <= 0:
            payment_state = "not_paid"
        elif amount_paid >= fp:
            payment_state = "fully_paid"
        else:
            payment_state = "partially_paid"
    if employee_name is None:
        ce = db.query(models.ContractEmployee).filter(models.ContractEmployee.id == j.contract_employee_id).first()
        employee_name = (ce.full_name if ce else None)
    return ContractJobOut(
        id=j.id,
        contract_employee_id=j.contract_employee_id,
        contract_employee_name=(employee_name or None),
        description=(getattr(j, "description", "") or "").strip(),
        image_url=j.image_url,
        price_offer=_as_decimal(j.price_offer) if j.price_offer is not None else None,
        last_offer_by_role=(getattr(j, "last_offer_by_role", None) or None),
        offer_updated_at=getattr(j, "offer_updated_at", None),
        offer_version=int(getattr(j, "offer_version", 0) or 0),
        negotiation_occurred=bool(getattr(j, "negotiation_occurred", False)),
        admin_accepted_at=getattr(j, "admin_accepted_at", None),
        employee_accepted_at=getattr(j, "employee_accepted_at", None),
        adminAccepted=bool(getattr(j, "admin_accepted_at", None)),
        employeeAccepted=bool(getattr(j, "employee_accepted_at", None)),
        hasNegotiation=bool(getattr(j, "negotiation_occurred", False)),
        final_price=_as_decimal(j.final_price) if j.final_price is not None else None,
        amount_paid=amount_paid,
        balance=bal,
        payment_state=payment_state,
        price_accepted_at=j.price_accepted_at,
        status=j.status,
        created_at=j.created_at,
        started_at=j.started_at,
        completed_at=j.completed_at,
        cancelled_at=j.cancelled_at,
        cancelled_note=j.cancelled_note,
        paid_flag=bool(getattr(j, "paid_flag", False) or amount_paid > 0),
        linked_transactions=[EmployeeTransactionOut.model_validate(t) for t in tx],
    )


def _get_job_or_404(db: Session, job_id: int) -> models.ContractJob:
    j = db.query(models.ContractJob).filter(models.ContractJob.id == job_id).first()
    if j is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return j


def _assert_job_belongs_to_user(db: Session, user: models.User, job: models.ContractJob) -> models.ContractEmployee:
    ce = db.query(models.ContractEmployee).filter(models.ContractEmployee.id == job.contract_employee_id).first()
    if ce is None:
        raise HTTPException(status_code=404, detail="Contract employee not found")
    if ce.user_id is None or ce.user_id != user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    return ce


def _assert_contract_employee_ready(ce: models.ContractEmployee, current_user: models.User) -> None:
    # Must change password enforcement.
    if bool(getattr(current_user, "must_change_password", False)):
        raise HTTPException(status_code=403, detail="Change your password to continue.")
    # Profile completion enforcement.
    required = [
        (ce.full_name or "").strip(),
        (getattr(ce, "account_number", None) or "").strip(),
        (getattr(ce, "bank_name", None) or "").strip(),
        (getattr(ce, "phone", None) or "").strip(),
        (getattr(ce, "address", None) or "").strip(),
    ]
    if any(not x for x in required):
        raise HTTPException(status_code=403, detail="Complete your profile to continue.")


def _role_key(user: models.User) -> str:
    role = normalize_role(getattr(user, "role", None))
    if role not in ("admin", "contract_employee"):
        return role or "unknown"
    return role


def _set_offer(db: Session, job: models.ContractJob, *, new_offer: Decimal, actor: models.User) -> None:
    if new_offer <= 0:
        raise HTTPException(status_code=400, detail="price_offer must be > 0")
    if job.status == "cancelled":
        raise HTTPException(status_code=409, detail="Job is cancelled.")
    if job.price_accepted_at is not None or job.final_price is not None:
        raise HTTPException(status_code=409, detail="Price is locked.")

    prev = _as_decimal(job.price_offer) if job.price_offer is not None else None
    changed = prev is None or _as_decimal(prev) != _as_decimal(new_offer)
    if prev is not None and changed:
        job.negotiation_occurred = True

    job.price_offer = _as_decimal(new_offer)
    job.last_offer_by_role = _role_key(actor)
    job.offer_updated_at = datetime.utcnow()
    job.offer_version = int(getattr(job, "offer_version", 0) or 0) + 1

    # Any new offer resets acceptance (until final lock).
    job.admin_accepted_at = None
    job.employee_accepted_at = None


def _is_ready_to_lock(job: models.ContractJob) -> bool:
    if job.price_offer is None or _as_decimal(job.price_offer) <= 0:
        return False
    if job.price_accepted_at is not None or job.final_price is not None:
        return True

    if bool(getattr(job, "negotiation_occurred", False)):
        return bool(getattr(job, "admin_accepted_at", None)) and bool(getattr(job, "employee_accepted_at", None))

    last_by = (getattr(job, "last_offer_by_role", None) or "").strip()
    # No negotiation: only the counter-party acceptance is required.
    if last_by == "admin":
        return bool(getattr(job, "employee_accepted_at", None))
    if last_by == "contract_employee":
        return bool(getattr(job, "admin_accepted_at", None))
    # Fallback (unknown): require both.
    return bool(getattr(job, "admin_accepted_at", None)) and bool(getattr(job, "employee_accepted_at", None))


def _lock_price_if_ready(db: Session, job: models.ContractJob, ce: models.ContractEmployee, actor: models.User) -> None:
    if job.price_accepted_at is not None or job.final_price is not None:
        return
    if not _is_ready_to_lock(job):
        return
    now = datetime.utcnow()
    job.final_price = _as_decimal(job.price_offer)
    job.price_accepted_at = now
    db.flush()
    _create_owed_increase_for_job(db, ce, job, actor)


def _create_owed_increase_for_job(db: Session, ce: models.ContractEmployee, job: models.ContractJob, actor: models.User) -> None:
    """When job price is accepted (locked), increase Total Owed and write a paid owed_increase txn linked to the job."""
    if job.final_price is None or _as_decimal(job.final_price) <= 0:
        raise HTTPException(status_code=400, detail="Job has no final_price")
    amt = _as_decimal(job.final_price)

    # Prevent duplicate owed triggers.
    existing = (
        db.query(models.EmployeeTransaction)
        .filter(
            models.EmployeeTransaction.contract_job_id == job.id,
            models.EmployeeTransaction.contract_employee_id == ce.id,
            models.EmployeeTransaction.txn_type == "owed_increase",
            models.EmployeeTransaction.status == "paid",
        )
        .first()
    )
    if existing:
        return

    now = datetime.utcnow()
    # `total_owed` is the live/net amount owed to the employee (can go negative after overpayment).
    # `balance` is kept in sync for backward compatibility with older UI fields.
    ce.total_owed = _as_decimal(ce.total_owed) + amt
    ce.balance = _as_decimal(ce.total_owed)
    ce.updated_at = now

    txn = models.EmployeeTransaction(
        contract_employee_id=ce.id,
        contract_job_id=job.id,
        txn_type="owed_increase",
        amount=amt,
        status="paid",
        note=f"Job #{job.id} accepted",
        created_by_id=getattr(actor, "id", None),
        processed_by_id=getattr(actor, "id", None),
        processed_by_role=normalize_role(getattr(actor, "role", None)),
        paid_at=now,
        running_balance=ce.balance,
    )
    db.add(txn)
    db.flush()
    log_financial_action(
        db,
        action="owed_increase",
        entity_type="employee_transaction",
        entity_id=txn.id,
        actor_user=actor,
        meta={"contract_employee_id": ce.id, "contract_job_id": job.id, "amount": str(amt)},
    )


def _reverse_owed_increase_for_job(db: Session, job: models.ContractJob, actor: models.User, note: str) -> None:
    """If job was accepted, cancel removes job value from owed by creating a reversal row."""
    orig = (
        db.query(models.EmployeeTransaction)
        .filter(
            models.EmployeeTransaction.contract_job_id == job.id,
            models.EmployeeTransaction.txn_type == "owed_increase",
            models.EmployeeTransaction.status == "paid",
            models.EmployeeTransaction.reversal_of_id.is_(None),
        )
        .order_by(models.EmployeeTransaction.id.asc())
        .first()
    )
    if not orig:
        return

    # If already reversed, nothing to do.
    existing_rev = db.query(models.EmployeeTransaction).filter(models.EmployeeTransaction.reversal_of_id == orig.id).first()
    if existing_rev:
        return

    now = datetime.utcnow()
    role = normalize_role(getattr(actor, "role", None))
    amt = _as_decimal(orig.amount)

    rev = models.EmployeeTransaction(
        contract_employee_id=orig.contract_employee_id,
        contract_job_id=job.id,
        txn_type="reversal",
        amount=amt,
        status="paid",
        note=(note or "").strip() or None,
        receipt_url=None,
        created_at=now,
        paid_at=now,
        created_by_id=getattr(actor, "id", None),
        processed_by_id=getattr(actor, "id", None),
        processed_by_role=role,
        reversal_of_id=orig.id,
    )
    db.add(rev)
    db.flush()

    ce = (
        db.query(models.ContractEmployee)
        .filter(models.ContractEmployee.id == orig.contract_employee_id)
        .first()
    )
    if ce:
        ce.total_owed = _as_decimal(ce.total_owed) - amt
        ce.balance = _as_decimal(ce.total_owed)
        ce.updated_at = now
        rev.running_balance = ce.balance

    log_financial_action(
        db,
        action="job_cancelled_owed_reversal",
        entity_type="employee_transaction",
        entity_id=rev.id,
        actor_user=actor,
        meta={"original_transaction_id": orig.id, "contract_job_id": job.id, "amount": str(amt)},
    )


def _reverse_paid_allocations_for_job(db: Session, job: models.ContractJob, actor: models.User, note: str) -> None:
    """Cancel job should also reverse any PAID payment allocations tied to it.

    This is audit-safe (append-only) and idempotent:
    - allocations are soft-voided (not deleted)
    - each originating payment txn gets at most one reversal row for this job
    """
    # Find allocation sums per paid payment txn for this job.
    rows = (
        db.query(
            models.EmployeePaymentAllocation.transaction_id,
            func.coalesce(func.sum(models.EmployeePaymentAllocation.amount), 0),
        )
        .join(models.EmployeeTransaction, models.EmployeeTransaction.id == models.EmployeePaymentAllocation.transaction_id)
        .filter(
            models.EmployeePaymentAllocation.contract_job_id == job.id,
            models.EmployeePaymentAllocation.voided_at.is_(None),
            models.EmployeeTransaction.txn_type == "payment",
            models.EmployeeTransaction.status == "paid",
        )
        .group_by(models.EmployeePaymentAllocation.transaction_id)
        .all()
    )
    if not rows:
        return

    now = datetime.utcnow()
    role = normalize_role(getattr(actor, "role", None))

    # Soft-void allocation lines (audit retention).
    alloc_lines = (
        db.query(models.EmployeePaymentAllocation)
        .filter(models.EmployeePaymentAllocation.contract_job_id == job.id, models.EmployeePaymentAllocation.voided_at.is_(None))
        .all()
    )
    for a in alloc_lines:
        a.voided_at = now
        a.voided_by_id = getattr(actor, "id", None)
        a.void_reason = (note or "").strip() or "Voided due to job cancellation"

    # Reverse the financial effect of the allocated portions.
    # Payment confirmation rule (contract employees): total_paid += amt and total_owed -= amt.
    # Reversal undoes that: total_paid -= amt and total_owed += amt.
    for txn_id, amt_sum in rows:
        amt = _as_decimal(amt_sum)
        if amt <= 0:
            continue
        # Idempotency: avoid duplicate reversal for same payment txn + job.
        existing = (
            db.query(models.EmployeeTransaction)
            .filter(
                models.EmployeeTransaction.reversal_of_id == int(txn_id),
                models.EmployeeTransaction.contract_job_id == job.id,
                models.EmployeeTransaction.txn_type == "reversal",
                models.EmployeeTransaction.status == "paid",
            )
            .first()
        )
        if existing:
            continue

        orig = db.query(models.EmployeeTransaction).filter(models.EmployeeTransaction.id == int(txn_id)).first()
        if orig is None or orig.contract_employee_id is None:
            continue

        emp = db.query(models.ContractEmployee).filter(models.ContractEmployee.id == orig.contract_employee_id).first()
        if emp is None:
            continue

        rev = models.EmployeeTransaction(
            contract_employee_id=orig.contract_employee_id,
            contract_job_id=job.id,
            txn_type="reversal",
            amount=amt,
            status="paid",
            note=(note or "").strip() or None,
            receipt_url=None,
            created_at=now,
            paid_at=now,
            created_by_id=getattr(actor, "id", None),
            processed_by_id=getattr(actor, "id", None),
            processed_by_role=role,
            reversal_of_id=int(txn_id),
        )
        db.add(rev)
        db.flush()

        emp.total_paid = _as_decimal(emp.total_paid) - amt
        emp.total_owed = _as_decimal(emp.total_owed) + amt
        emp.balance = _as_decimal(emp.total_owed) - _as_decimal(emp.total_paid)
        emp.updated_at = now
        rev.running_balance = emp.balance

        log_financial_action(
            db,
            action="job_cancelled_payment_reversal",
            entity_type="employee_transaction",
            entity_id=rev.id,
            actor_user=actor,
            meta={"original_transaction_id": int(txn_id), "contract_job_id": job.id, "amount": str(amt)},
        )


@router.get("", response_model=list[ContractJobOut])
def list_jobs_admin(
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
    employee_id: Optional[int] = Query(None, gt=0),
    status: Optional[str] = Query(None, description="pending | in_progress | completed | cancelled"),
):
    q = db.query(models.ContractJob)
    if employee_id:
        q = q.filter(models.ContractJob.contract_employee_id == int(employee_id))
    if status:
        q = q.filter(models.ContractJob.status == status)
    rows = q.order_by(models.ContractJob.id.desc()).all()
    ce_ids = sorted({int(j.contract_employee_id) for j in rows})
    name_map: dict[int, str] = {}
    if ce_ids:
        for ce_id, full_name in (
            db.query(models.ContractEmployee.id, models.ContractEmployee.full_name)
            .filter(models.ContractEmployee.id.in_(ce_ids))
            .all()
        ):
            name_map[int(ce_id)] = (full_name or "").strip() or f"Employee #{int(ce_id)}"
    return [_job_out(db, j, employee_name=name_map.get(int(j.contract_employee_id))) for j in rows]


@router.get("/summary")
def admin_jobs_summary(
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    total_jobs = db.query(models.ContractJob).count()
    total_completed = db.query(models.ContractJob).filter(models.ContractJob.status == "completed").count()
    total_pending = db.query(models.ContractJob).filter(models.ContractJob.status == "pending").count()
    total_in_progress = db.query(models.ContractJob).filter(models.ContractJob.status == "in_progress").count()

    # Financial totals are derived from valid jobs + finance-confirmed payments only.
    total_owed = Decimal("0")
    total_paid = Decimal("0")
    for (cid,) in db.query(models.ContractEmployee.id).all():
        derived, _debug = compute_contract_employee_financials(db, int(cid), debug=False)
        total_owed += derived.total_owed
        total_paid += derived.total_paid
    balance = total_owed - total_paid
    return {
        "jobs": {
            "total": int(total_jobs),
            "completed": int(total_completed),
            "pending": int(total_pending),
            "in_progress": int(total_in_progress),
        },
        "financials": {
            "total_paid": total_paid,
            "total_owed": total_owed,
            "balance": balance,
        },
    }


@router.post("", response_model=ContractJobOut)
def create_job_admin(
    body: ContractJobCreateAdmin,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    ce = (
        db.query(models.ContractEmployee)
        .filter(models.ContractEmployee.id == body.contract_employee_id)
        .first()
    )
    if ce is None:
        raise HTTPException(status_code=404, detail="Contract employee not found")
    desc = (body.description or "").strip()
    if not desc:
        raise HTTPException(status_code=422, detail="description is required")
    j = models.ContractJob(
        contract_employee_id=ce.id,
        created_by_id=current_user.id,
        created_by_role="admin",
        description=desc,
        image_url=body.image_url,
        price_offer=(Decimal(str(body.price_offer)) if body.price_offer is not None else None),
        last_offer_by_role=("admin" if body.price_offer is not None else None),
        offer_updated_at=(datetime.utcnow() if body.price_offer is not None else None),
        offer_version=(1 if body.price_offer is not None else 0),
        negotiation_occurred=False,
        admin_accepted_at=None,
        employee_accepted_at=None,
        status="pending",
        created_at=datetime.utcnow(),
    )
    db.add(j)
    db.commit()
    db.refresh(j)
    # Notify employee (if linked to a user account).
    if ce.user_id:
        create_notifications(
            db,
            recipient_user_ids=[int(ce.user_id)],
            kind="job_assigned",
            title=f"New job assigned (#{j.id})",
            message="A new job has been assigned to you.",
            entity_type="contract_job",
            entity_id=int(j.id),
        )
        db.commit()
    return _job_out(db, j, employee_name=(ce.full_name if ce else None))


@router.patch("/{job_id}/offer", response_model=ContractJobOut)
def admin_set_offer(
    job_id: int,
    body: ContractJobOfferUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    j = _get_job_or_404(db, job_id)
    _set_offer(db, j, new_offer=Decimal(str(body.price_offer)), actor=current_user)
    db.commit()
    db.refresh(j)
    ce = db.query(models.ContractEmployee).filter(models.ContractEmployee.id == j.contract_employee_id).first()
    if ce and ce.user_id:
        create_notifications(
            db,
            recipient_user_ids=[int(ce.user_id)],
            kind="price_updated",
            title=f"Job price updated (#{j.id})",
            message=f"New offer: {str(body.price_offer)}",
            entity_type="contract_job",
            entity_id=int(j.id),
        )
        db.commit()
    return _job_out(db, j)


@router.get("/me", response_model=list[ContractJobOut])
def list_jobs_me(
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["contract_employee"])),
    status: Optional[str] = Query(None, description="pending | in_progress | completed | cancelled"),
):
    ce = db.query(models.ContractEmployee).filter(models.ContractEmployee.user_id == current_user.id).first()
    if ce is None:
        raise HTTPException(status_code=404, detail="No contract employee profile linked to your account.")
    _assert_contract_employee_ready(ce, current_user)
    q = db.query(models.ContractJob).filter(models.ContractJob.contract_employee_id == ce.id)
    if status:
        q = q.filter(models.ContractJob.status == status)
    rows = q.order_by(models.ContractJob.id.desc()).all()
    return [_job_out(db, j) for j in rows]


@router.post("/me", response_model=ContractJobOut)
def create_job_me(
    body: ContractJobCreateEmployee,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["contract_employee"])),
):
    ce = db.query(models.ContractEmployee).filter(models.ContractEmployee.user_id == current_user.id).first()
    if ce is None:
        raise HTTPException(status_code=404, detail="No contract employee profile linked to your account.")
    _assert_contract_employee_ready(ce, current_user)
    desc = (body.description or "").strip()
    if not desc:
        raise HTTPException(status_code=422, detail="description is required")
    offer = (Decimal(str(body.price_offer)) if body.price_offer is not None else None)
    j = models.ContractJob(
        contract_employee_id=ce.id,
        created_by_id=current_user.id,
        created_by_role="contract_employee",
        description=desc,
        image_url=body.image_url,
        price_offer=offer,
        last_offer_by_role=("contract_employee" if offer is not None else None),
        offer_updated_at=(datetime.utcnow() if offer is not None else None),
        offer_version=(1 if offer is not None else 0),
        negotiation_occurred=False,
        admin_accepted_at=None,
        employee_accepted_at=None,
        status="pending",
        created_at=datetime.utcnow(),
    )
    db.add(j)
    db.commit()
    db.refresh(j)
    # Notify admins when an employee creates a job (so it shows up centrally).
    admin_ids = [
        int(uid)
        for (uid,) in (db.query(models.User.id).filter(models.User.role == "admin").all())
        if uid is not None
    ]
    if admin_ids:
        create_notifications(
            db,
            recipient_user_ids=admin_ids,
            kind="job_assigned",
            title=f"New job created (#{j.id})",
            message="A contract employee created a new job.",
            entity_type="contract_job",
            entity_id=int(j.id),
        )
        db.commit()
    return _job_out(db, j)


@router.post("/upload-image")
def upload_contract_job_image(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "contract_employee"])),
):
    # Upload is allowed for admin + contract employees; caller gets back a Cloudinary URL.
    url = upload_image(file)
    return {"image_url": url}


@router.get("/pending-negotiations-count")
def pending_negotiations_count(
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    """Count jobs awaiting admin review/response for price negotiation.

    Note: this route MUST be declared before `/{job_id}` so it isn't parsed as a job_id path param.
    """
    count = (
        db.query(models.ContractJob)
        .filter(
            models.ContractJob.status == "pending",
            models.ContractJob.price_accepted_at.is_(None),
            models.ContractJob.final_price.is_(None),
            models.ContractJob.price_offer.isnot(None),
            models.ContractJob.last_offer_by_role == "contract_employee",
        )
        .count()
    )
    return {"count": int(count or 0)}


@router.get("/{job_id}", response_model=ContractJobOut)
def get_job_detail(
    job_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    j = _get_job_or_404(db, job_id)
    role = normalize_role(getattr(current_user, "role", None))
    if role == "contract_employee":
        _assert_job_belongs_to_user(db, current_user, j)
    elif role != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")
    ce = db.query(models.ContractEmployee).filter(models.ContractEmployee.id == j.contract_employee_id).first()
    return _job_out(db, j, employee_name=(ce.full_name if ce else None))


@router.post("/{job_id}/set-price", response_model=ContractJobOut)
def set_price_me(
    job_id: int,
    body: ContractJobOfferUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["contract_employee"])),
):
    j = _get_job_or_404(db, job_id)
    _assert_job_belongs_to_user(db, current_user, j)
    ce = db.query(models.ContractEmployee).filter(models.ContractEmployee.id == j.contract_employee_id).first()
    if ce is not None:
        _assert_contract_employee_ready(ce, current_user)
    if j.status == "cancelled":
        raise HTTPException(status_code=409, detail="Job is cancelled.")
    _set_offer(db, j, new_offer=Decimal(str(body.price_offer)), actor=current_user)
    db.commit()
    db.refresh(j)
    # Notify admins so renegotiations are visible on the admin side.
    admin_ids = [
        int(uid)
        for (uid,) in (
            db.query(models.User.id).filter(models.User.role == "admin").all()
        )
        if uid is not None
    ]
    if admin_ids:
        create_notifications(
            db,
            recipient_user_ids=admin_ids,
            kind="price_updated",
            title=f"Job price renegotiated (#{j.id})",
            message=f"Employee proposed: {str(body.price_offer)}",
            entity_type="contract_job",
            entity_id=int(j.id),
        )
        db.commit()
    return _job_out(db, j)


@router.post("/{job_id}/accept-price", response_model=ContractJobOut)
def accept_price_me(
    job_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["contract_employee"])),
):
    j = _get_job_or_404(db, job_id)
    ce = _assert_job_belongs_to_user(db, current_user, j)
    _assert_contract_employee_ready(ce, current_user)
    if j.status == "cancelled":
        raise HTTPException(status_code=409, detail="Job is cancelled.")
    if j.price_accepted_at is not None or j.final_price is not None:
        raise HTTPException(status_code=409, detail="Price is already locked.")
    if j.price_offer is None or _as_decimal(j.price_offer) <= 0:
        raise HTTPException(status_code=400, detail="No price offer to accept.")

    now = datetime.utcnow()
    # No negotiation: employee cannot "accept" their own last offer.
    if not bool(getattr(j, "negotiation_occurred", False)) and (getattr(j, "last_offer_by_role", None) == "contract_employee"):
        raise HTTPException(status_code=409, detail="Waiting for admin to accept this offer.")

    j.employee_accepted_at = now
    _lock_price_if_ready(db, j, ce, current_user)
    # Keep cached contract-employee balances consistent (prevents stale running_balance in the UI).
    recalculate_contract_employee_financials(
        db,
        int(j.contract_employee_id),
        actor_user=None,
        debug=False,
        commit=False,
    )
    db.commit()
    db.refresh(j)
    # Notify admins when employee accepts (price accepted event).
    admin_ids = [
        int(uid)
        for (uid,) in (db.query(models.User.id).filter(models.User.role == "admin").all())
        if uid is not None
    ]
    if admin_ids:
        create_notifications(
            db,
            recipient_user_ids=admin_ids,
            kind="price_accepted",
            title=f"Offer accepted (Job #{j.id})",
            message="Employee accepted the current offer.",
            entity_type="contract_job",
            entity_id=int(j.id),
        )
        db.commit()
    return _job_out(db, j)


@router.post("/{job_id}/admin/accept-offer", response_model=ContractJobOut)
def admin_accept_offer(
    job_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    j = _get_job_or_404(db, job_id)
    if j.status == "cancelled":
        raise HTTPException(status_code=409, detail="Job is cancelled.")
    if j.price_accepted_at is not None or j.final_price is not None:
        raise HTTPException(status_code=409, detail="Price is already locked.")
    if j.price_offer is None or _as_decimal(j.price_offer) <= 0:
        raise HTTPException(status_code=400, detail="No price offer to accept.")

    # No negotiation: admin cannot "accept" their own last offer.
    if not bool(getattr(j, "negotiation_occurred", False)) and (getattr(j, "last_offer_by_role", None) == "admin"):
        raise HTTPException(status_code=409, detail="Waiting for employee to accept this offer.")

    ce = db.query(models.ContractEmployee).filter(models.ContractEmployee.id == j.contract_employee_id).first()
    if ce is None:
        raise HTTPException(status_code=404, detail="Contract employee not found")

    j.admin_accepted_at = datetime.utcnow()
    _lock_price_if_ready(db, j, ce, current_user)
    # Keep cached contract-employee balances consistent (prevents stale running_balance in the UI).
    recalculate_contract_employee_financials(
        db,
        int(j.contract_employee_id),
        actor_user=None,
        debug=False,
        commit=False,
    )
    db.commit()
    db.refresh(j)
    # Notify employee when admin accepts.
    if ce.user_id:
        create_notifications(
            db,
            recipient_user_ids=[int(ce.user_id)],
            kind="price_accepted",
            title=f"Offer accepted (Job #{j.id})",
            message="Admin accepted the current offer.",
            entity_type="contract_job",
            entity_id=int(j.id),
        )
        db.commit()
    return _job_out(db, j, employee_name=(ce.full_name if ce else None))


@router.post("/{job_id}/start", response_model=ContractJobOut)
def start_job_me(
    job_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["contract_employee"])),
):
    j = _get_job_or_404(db, job_id)
    _assert_job_belongs_to_user(db, current_user, j)
    ce = db.query(models.ContractEmployee).filter(models.ContractEmployee.id == j.contract_employee_id).first()
    if ce is not None:
        _assert_contract_employee_ready(ce, current_user)
    if j.status == "cancelled":
        raise HTTPException(status_code=409, detail="Job is cancelled.")
    if j.status != "pending":
        raise HTTPException(status_code=409, detail="Job cannot be started from this state.")
    if j.price_accepted_at is None or j.final_price is None:
        raise HTTPException(status_code=409, detail="Accept price before starting job.")
    j.status = "in_progress"
    j.started_at = datetime.utcnow()
    db.commit()
    db.refresh(j)
    return _job_out(db, j)


@router.post("/{job_id}/complete", response_model=ContractJobOut)
def complete_job_me(
    job_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["contract_employee"])),
):
    j = _get_job_or_404(db, job_id)
    _assert_job_belongs_to_user(db, current_user, j)
    ce = db.query(models.ContractEmployee).filter(models.ContractEmployee.id == j.contract_employee_id).first()
    if ce is not None:
        _assert_contract_employee_ready(ce, current_user)
    if j.status == "cancelled":
        raise HTTPException(status_code=409, detail="Job is cancelled.")
    if j.status != "in_progress":
        raise HTTPException(status_code=409, detail="Job cannot be completed from this state.")
    j.status = "completed"
    j.completed_at = datetime.utcnow()
    db.commit()
    db.refresh(j)
    return _job_out(db, j)


@router.post("/{job_id}/mark-paid-flag", response_model=ContractJobOut)
def mark_job_paid_flag(
    job_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Informational paid flag (does not affect money)."""
    j = _get_job_or_404(db, job_id)
    role = normalize_role(getattr(current_user, "role", None))
    if role == "contract_employee":
        _assert_job_belongs_to_user(db, current_user, j)
    elif role != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")

    if j.status != "completed":
        raise HTTPException(status_code=409, detail="Only completed jobs can be marked paid.")
    if getattr(j, "paid_flag", False):
        raise HTTPException(status_code=409, detail="Job already marked paid.")

    j.paid_flag = True
    db.commit()
    db.refresh(j)
    return _job_out(db, j)


@router.post("/{job_id}/cancel", response_model=ContractJobOut)
def cancel_job(
    job_id: int,
    body: ContractJobCancelBody,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    j = _get_job_or_404(db, job_id)
    role = normalize_role(getattr(current_user, "role", None))
    if role not in ("admin", "contract_employee"):
        raise HTTPException(status_code=403, detail="Not authorized")
    if role == "contract_employee":
        _assert_job_belongs_to_user(db, current_user, j)

    if j.status == "cancelled":
        raise HTTPException(status_code=409, detail="Job already cancelled.")

    now = datetime.utcnow()
    j.status = "cancelled"
    j.cancelled_at = now
    j.cancelled_by_id = getattr(current_user, "id", None)
    j.cancelled_note = (body.note or "").strip() or None

    # If accepted, remove from owed by reversing its owed_increase.
    _reverse_owed_increase_for_job(db, j, current_user, note=f"Job #{j.id} cancelled. {j.cancelled_note or ''}".strip())
    # If paid allocations exist, void them and reverse their payment impact for this job.
    _reverse_paid_allocations_for_job(db, j, current_user, note=f"Job #{j.id} cancelled. {j.cancelled_note or ''}".strip())

    # Keep cached contract-employee balances consistent.
    recalculate_contract_employee_financials(
        db,
        int(j.contract_employee_id),
        actor_user=None,
        debug=False,
        commit=False,
    )

    db.commit()
    db.refresh(j)

    # Notify the other party when job is cancelled.
    ce = db.query(models.ContractEmployee).filter(models.ContractEmployee.id == j.contract_employee_id).first()
    admin_ids = [
        int(uid)
        for (uid,) in (db.query(models.User.id).filter(models.User.role == "admin").all())
        if uid is not None
    ]
    if role == "admin":
        if ce and ce.user_id:
            create_notifications(
                db,
                recipient_user_ids=[int(ce.user_id)],
                kind="job_cancelled",
                title=f"Job cancelled (#{j.id})",
                message=(j.cancelled_note or "This job has been cancelled."),
                entity_type="contract_job",
                entity_id=int(j.id),
            )
            db.commit()
    else:
        if admin_ids:
            create_notifications(
                db,
                recipient_user_ids=admin_ids,
                kind="job_cancelled",
                title=f"Job cancelled (#{j.id})",
                message=(j.cancelled_note or "This job has been cancelled."),
                entity_type="contract_job",
                entity_id=int(j.id),
            )
            db.commit()
    return _job_out(db, j)


## NOTE: moved to be declared before `/{job_id}` to avoid FastAPI path-param matching.

