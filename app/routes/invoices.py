from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app import models
from app.auth.auth import get_current_user
from app.database import get_db
from app.schemas import InvoiceDetailResponse, InvoiceListItem

router = APIRouter()


def _invoice_to_list_item(inv: models.Invoice, user) -> dict:
    c = inv.customer
    return {
        "id": inv.id,
        "invoice_number": inv.invoice_number,
        "order_id": inv.order_id,
        "customer_id": inv.customer_id,
        "total_price": inv.total_price,
        "deposit_paid": inv.deposit_paid,
        "balance": inv.balance,
        "status": inv.status or "unpaid",
        "created_at": inv.created_at,
        "due_date": inv.due_date,
        "customer": None
        if user.role == "manager"
        else {
            "id": c.id,
            "name": c.name,
            "phone": c.phone,
            "address": c.address,
            "email": c.email,
        },
    }


@router.get("/invoices", response_model=List[InvoiceListItem], response_model_exclude_none=True)
def list_invoices(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    rows = (
        db.query(models.Invoice)
        .options(joinedload(models.Invoice.customer), joinedload(models.Invoice.order))
        .order_by(models.Invoice.id.desc())
        .all()
    )
    return [_invoice_to_list_item(inv, user) for inv in rows]


@router.get("/invoices/order/{order_id}", response_model=InvoiceDetailResponse, response_model_exclude_none=True)
def get_invoice_by_order(
    order_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    inv = (
        db.query(models.Invoice)
        .options(joinedload(models.Invoice.customer), joinedload(models.Invoice.order))
        .filter(models.Invoice.order_id == order_id)
        .first()
    )
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found for this order")

    order = inv.order
    items = (
        db.query(models.OrderItem)
        .filter(models.OrderItem.order_id == order.id)
        .all()
    )
    base = _invoice_to_list_item(inv, user)
    base["items"] = [
        {
            "id": it.id,
            "item_name": it.item_name,
            "description": it.description,
            "quantity": it.quantity,
        }
        for it in items
    ]
    return base


@router.get("/invoices/{invoice_id}", response_model=InvoiceDetailResponse, response_model_exclude_none=True)
def get_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    inv = (
        db.query(models.Invoice)
        .options(joinedload(models.Invoice.customer), joinedload(models.Invoice.order))
        .filter(models.Invoice.id == invoice_id)
        .first()
    )
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")

    order = inv.order
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    items = (
        db.query(models.OrderItem)
        .filter(models.OrderItem.order_id == order.id)
        .all()
    )

    base = _invoice_to_list_item(inv, user)
    base["items"] = [
        {
            "id": it.id,
            "item_name": it.item_name,
            "description": it.description,
            "quantity": it.quantity,
        }
        for it in items
    ]
    return base
