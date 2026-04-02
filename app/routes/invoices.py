from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app import models
from app.auth.auth import get_current_user, require_role
from app.database import get_db
from app.schemas import InvoiceDetailResponse, InvoiceListItem
from app.constants import APP_NAME
from app.utils.emailer import EmailConfigError, send_email

router = APIRouter()


def _invoice_to_list_item(inv: models.Invoice, user) -> dict:
    c = inv.customer
    order = inv.order
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
        "customer": {
            "id": c.id,
            "name": c.name,
            "phone": c.phone,
            "address": c.address,
            "email": c.email,
        },
        "discount_type": getattr(order, "discount_type", None) if order else None,
        "discount_value": getattr(order, "discount_value", None) if order else None,
        "discount_amount": getattr(order, "discount_amount", None) if order else None,
        "final_price": getattr(order, "final_price", None) if order else None,
    }


@router.get("/invoices", response_model=List[InvoiceListItem], response_model_exclude_none=True)
def list_invoices(
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin", "showroom"])),
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
    user=Depends(require_role(["admin", "showroom"])),
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
    user=Depends(require_role(["admin", "showroom"])),
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


@router.post("/invoices/{invoice_id}/send-email")
def send_invoice_email(
    invoice_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin", "showroom"])),
):
    inv = (
        db.query(models.Invoice)
        .options(joinedload(models.Invoice.customer), joinedload(models.Invoice.order))
        .filter(models.Invoice.id == invoice_id)
        .first()
    )
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if not inv.customer or not (inv.customer.email or "").strip():
        raise HTTPException(status_code=400, detail="Customer has no email")

    to_email = inv.customer.email.strip()
    subject = f"{APP_NAME} - Invoice {inv.invoice_number}"
    html = f"""
    <div style="font-family:Inter,Arial,sans-serif;line-height:1.4">
      <h2 style="margin:0 0 8px 0">{APP_NAME}</h2>
      <div style="color:#444;margin-bottom:16px">
        Invoice <strong>{inv.invoice_number}</strong>
      </div>
      <div style="margin-bottom:8px">Customer: <strong>{inv.customer.name}</strong></div>
      <div style="margin-bottom:8px">Total: <strong>{inv.total_price or 0}</strong></div>
      <div style="margin-bottom:8px">Deposit: <strong>{inv.deposit_paid or 0}</strong></div>
      <div style="margin-bottom:16px">Balance: <strong>{inv.balance or 0}</strong></div>
      <div style="color:#666;font-size:12px">This email was sent from {APP_NAME}.</div>
    </div>
    """
    try:
        send_email(to_email, subject, html)
    except EmailConfigError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    except Exception:
        raise HTTPException(status_code=502, detail="Failed to send email")

    return {"message": "Invoice sent"}
