from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

import csv
import io

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models
from app.auth.auth import normalize_role, require_role
from app.database import get_db
from app.schemas import ExpenseEntryCreate, ExpenseEntryOut, ExpenseSummaryOut, ExpenseEntryUpdate
from app.utils.cloudinary import upload_asset
from app.utils.financial_audit import log_financial_action

router = APIRouter(prefix="/expenses", tags=["Expenses"])


def _as_decimal(v) -> Decimal:
    return Decimal(str(v or 0))


@router.get("", response_model=list[ExpenseEntryOut])
def list_expenses(
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "finance"])),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    rows = (
        db.query(models.ExpenseEntry)
        .order_by(models.ExpenseEntry.entry_date.desc(), models.ExpenseEntry.id.desc())
        .offset(int(offset))
        .limit(int(limit))
        .all()
    )
    out: list[ExpenseEntryOut] = []
    for r in rows:
        processed_by = None
        if r.processed_by_user:
            processed_by = (r.processed_by_user.email or "").split("@")[0] if r.processed_by_user.email else None
        out.append(
            ExpenseEntryOut(
                id=r.id,
                entry_date=r.entry_date,
                amount=_as_decimal(r.amount),
                entry_type=r.entry_type,
                note=r.note,
                receipt_url=r.receipt_url,
                processed_by_role=r.processed_by_role,
                processed_by=processed_by,
                created_at=r.created_at,
            )
        )
    return out


@router.get("/summary", response_model=ExpenseSummaryOut)
def expense_summary(
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "finance"])),
):
    credits = (
        db.query(func.coalesce(func.sum(models.ExpenseEntry.amount), 0))
        .filter(models.ExpenseEntry.entry_type == "credit")
        .scalar()
        or 0
    )
    expenses = (
        db.query(func.coalesce(func.sum(models.ExpenseEntry.amount), 0))
        .filter(models.ExpenseEntry.entry_type == "expense")
        .scalar()
        or 0
    )
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)
    today_exp = (
        db.query(func.coalesce(func.sum(models.ExpenseEntry.amount), 0))
        .filter(
            models.ExpenseEntry.entry_type == "expense",
            models.ExpenseEntry.entry_date >= today_start,
            models.ExpenseEntry.entry_date < today_end,
        )
        .scalar()
        or 0
    )
    c = _as_decimal(credits)
    e = _as_decimal(expenses)
    return ExpenseSummaryOut(
        total_received=c,
        total_expenses=e,
        balance=c - e,
        today_total=_as_decimal(today_exp),
    )


@router.get("/export", response_class=StreamingResponse)
def export_expenses_csv(
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "finance"])),
):
    rows = (
        db.query(models.ExpenseEntry)
        .order_by(models.ExpenseEntry.entry_date.asc(), models.ExpenseEntry.id.asc())
        .all()
    )
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["ID", "Entry date", "Type", "Amount", "Note", "Processed by role", "Receipt URL", "Created at"])
    for r in rows:
        w.writerow(
            [
                r.id,
                r.entry_date.isoformat() if r.entry_date else "",
                r.entry_type,
                str(_as_decimal(r.amount)),
                r.note or "",
                r.processed_by_role or "",
                r.receipt_url or "",
                r.created_at.isoformat() if r.created_at else "",
            ]
        )
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="petty_cash_expenses.csv"'},
    )


@router.post("", response_model=ExpenseEntryOut)
def create_expense(
    body: ExpenseEntryCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "finance"])),
):
    role = normalize_role(getattr(current_user, "role", None))
    row = models.ExpenseEntry(
        entry_date=body.entry_date,
        amount=body.amount,
        entry_type=body.entry_type,
        note=(body.note or "").strip() or None,
        processed_by_id=current_user.id,
        processed_by_role=role,
        created_at=datetime.utcnow(),
    )
    db.add(row)
    db.flush()
    log_financial_action(
        db,
        action="expense_create",
        entity_type="expense_entry",
        entity_id=row.id,
        actor_user=current_user,
        meta={"entry_type": body.entry_type, "amount": str(body.amount), "entry_date": body.entry_date.isoformat()},
    )
    db.commit()
    db.refresh(row)
    processed_by = (current_user.email or "").split("@")[0] if getattr(current_user, "email", None) else None
    return ExpenseEntryOut(
        id=row.id,
        entry_date=row.entry_date,
        amount=_as_decimal(row.amount),
        entry_type=row.entry_type,
        note=row.note,
        receipt_url=row.receipt_url,
        processed_by_role=row.processed_by_role,
        processed_by=processed_by,
        created_at=row.created_at,
    )


@router.patch("/{entry_id}", response_model=ExpenseEntryOut)
def update_expense(
    entry_id: int,
    body: ExpenseEntryUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "finance"])),
):
    row = db.query(models.ExpenseEntry).filter(models.ExpenseEntry.id == entry_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Expense entry not found")

    data = body.model_dump(exclude_unset=True)
    if "amount" in data and data["amount"] is not None:
        row.amount = data["amount"]
    if "entry_type" in data and data["entry_type"] is not None:
        row.entry_type = data["entry_type"]
    if "note" in data:
        row.note = (data["note"] or "").strip() or None

    role = normalize_role(getattr(current_user, "role", None))
    row.processed_by_id = current_user.id
    row.processed_by_role = role

    log_financial_action(
        db,
        action="expense_update",
        entity_type="expense_entry",
        entity_id=row.id,
        actor_user=current_user,
        meta={"entry_type": row.entry_type, "amount": str(_as_decimal(row.amount)), "entry_date": row.entry_date.isoformat()},
    )
    db.commit()
    db.refresh(row)
    processed_by = None
    if row.processed_by_user:
        processed_by = (row.processed_by_user.email or "").split("@")[0] if row.processed_by_user.email else None
    return ExpenseEntryOut(
        id=row.id,
        entry_date=row.entry_date,
        amount=_as_decimal(row.amount),
        entry_type=row.entry_type,
        note=row.note,
        receipt_url=row.receipt_url,
        processed_by_role=row.processed_by_role,
        processed_by=processed_by,
        created_at=row.created_at,
    )


@router.delete("/{entry_id}")
def delete_expense(
    entry_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "finance"])),
):
    row = db.query(models.ExpenseEntry).filter(models.ExpenseEntry.id == entry_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Expense entry not found")

    log_financial_action(
        db,
        action="expense_delete",
        entity_type="expense_entry",
        entity_id=row.id,
        actor_user=current_user,
        meta={"entry_type": row.entry_type, "amount": str(_as_decimal(row.amount)), "entry_date": row.entry_date.isoformat()},
    )
    db.delete(row)
    db.commit()
    return {"message": "Deleted"}


@router.post("/{entry_id}/receipt", response_model=ExpenseEntryOut)
async def upload_expense_receipt(
    entry_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "finance"])),
    file: UploadFile = File(...),
):
    row = db.query(models.ExpenseEntry).filter(models.ExpenseEntry.id == entry_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Expense entry not found")
    if row.receipt_url:
        raise HTTPException(status_code=409, detail="Receipt already uploaded.")
    url = upload_asset(file, folder="expense_receipts")
    row.receipt_url = url
    log_financial_action(
        db,
        action="expense_receipt_upload",
        entity_type="expense_entry",
        entity_id=row.id,
        actor_user=current_user,
        meta={"receipt_url": url},
    )
    db.commit()
    db.refresh(row)
    processed_by = None
    if row.processed_by_user:
        processed_by = (row.processed_by_user.email or "").split("@")[0] if row.processed_by_user.email else None
    return ExpenseEntryOut(
        id=row.id,
        entry_date=row.entry_date,
        amount=_as_decimal(row.amount),
        entry_type=row.entry_type,
        note=row.note,
        receipt_url=row.receipt_url,
        processed_by_role=row.processed_by_role,
        processed_by=processed_by,
        created_at=row.created_at,
    )

