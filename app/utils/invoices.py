from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models


def create_invoice_for_order(db: Session, order: models.Order, customer_id: int) -> models.Invoice:
    count = db.query(func.count(models.Invoice.id)).scalar() or 0
    invoice_number = f"INV-{int(count) + 1:03d}"

    deposit = order.amount_paid if order.amount_paid is not None else Decimal("0")

    inv = models.Invoice(
        invoice_number=invoice_number,
        order_id=order.id,
        customer_id=customer_id,
        # Store the original total on the invoice row; the discounted final is derived from the order.
        total_price=order.total_price,
        deposit_paid=deposit,
        balance=order.balance,
        status=order.payment_status or "unpaid",
        due_date=order.due_date,
        created_at=datetime.utcnow(),
    )
    db.add(inv)
    return inv


def sync_invoice_from_order(db: Session, order: models.Order) -> None:
    inv = db.query(models.Invoice).filter(models.Invoice.order_id == order.id).first()
    if not inv:
        return
    # Keep invoice row as the original total; discounted final is derived from the order.
    inv.total_price = order.total_price
    inv.deposit_paid = order.amount_paid if order.amount_paid is not None else Decimal("0")
    inv.balance = order.balance
    inv.status = order.payment_status or "unpaid"
    inv.customer_id = order.customer_id
    inv.due_date = order.due_date
