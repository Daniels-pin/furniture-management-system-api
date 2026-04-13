"""Shared pricing and order/invoice creation for proforma and quotation conversions."""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models
from app.db.alive import customer_alive
from app.utils.activity_log import username_from_email
from app.utils.invoices import create_invoice_for_order
from app.utils.pricing import TotalsResult, compute_totals


def subtotal_from_line_items(items: list) -> Decimal | None:
    if not items:
        return None
    s = Decimal("0")
    for it in items:
        lt = (getattr(it, "line_type", None) or "item").lower()
        if lt == "subheading":
            continue
        amt_raw = getattr(it, "amount", None)
        if amt_raw is None:
            return None
        amt = Decimal(str(getattr(it, "amount")))
        q = int(getattr(it, "quantity"))
        s += amt * Decimal(q)
    return s.quantize(Decimal("0.01"))


def store_computed_totals(
    entity,
    items: list,
    discount_type,
    discount_value,
    tax_in,
) -> None:
    """Populate subtotal, discount_*, final_price, tax_percent, tax (amount), grand_total on proforma or quotation rows."""
    sub_in = subtotal_from_line_items(items)
    totals = compute_totals(sub_in, Decimal("0"), discount_type, discount_value, tax_in)
    entity.subtotal = totals.subtotal
    entity.discount_type = totals.discount_type
    entity.discount_value = totals.discount_value
    entity.discount_amount = totals.discount_amount
    entity.final_price = totals.after_discount
    entity.tax_percent = totals.tax_percent
    entity.tax = totals.tax
    entity.grand_total = totals.total


def next_proforma_number(db: Session) -> str:
    count = db.query(func.count(models.ProformaInvoice.id)).scalar() or 0
    return f"PROF-{int(count) + 1:03d}"


def next_quotation_number(db: Session) -> str:
    count = db.query(func.count(models.Quotation.id)).scalar() or 0
    return f"QUO-{int(count) + 1:03d}"


def presales_to_invoice_activity_meta(
    *,
    source: str,
    document_number: str,
    actor_user,
    order_id: int,
    invoice_id: int,
    totals: TotalsResult,
) -> dict:
    """Structured meta + human-readable summary for activity log."""
    actor_name = username_from_email(getattr(actor_user, "email", None)) or "user"
    paid = totals.paid or Decimal("0")
    gtot = totals.total or Decimal("0")
    bal = totals.balance if totals.balance is not None else (gtot - paid)
    summary = (
        f"Invoice from {source} #{document_number} by {actor_name} "
        f"(₦{paid:,.2f} paid, balance ₦{bal:,.2f})"
    )
    return {
        "order_id": order_id,
        "invoice_id": invoice_id,
        "document_number": document_number,
        "amount_paid": str(paid),
        "grand_total": str(gtot),
        "balance": str(bal),
        "payment_status": totals.payment_status,
        "summary": summary,
    }


def get_or_create_customer_for_presales(
    db: Session,
    *,
    customer_name: str,
    phone: str,
    address: str,
    email: str | None,
    creator_id: int,
) -> models.Customer:
    phone = phone.strip()
    email_val = (email or "").strip() or None
    existing = (
        db.query(models.Customer)
        .filter(models.Customer.phone == phone)
        .filter(customer_alive())
        .first()
    )
    if existing:
        if email_val and not (existing.email or "").strip():
            existing.email = email_val
        return existing
    c = models.Customer(
        name=customer_name.strip(),
        phone=phone,
        address=address.strip(),
        email=email_val,
        creator_id=creator_id,
    )
    db.add(c)
    db.flush()
    return c


def create_order_and_invoice_from_presales_items(
    db: Session,
    *,
    user,
    customer: models.Customer,
    due_date,
    items: list,
    discount_type,
    discount_value,
    tax_percent,
    amount_paid_in: object | None = None,
) -> tuple[models.Order, models.Invoice, TotalsResult]:
    sub_in = subtotal_from_line_items(items)
    totals = compute_totals(sub_in, amount_paid_in, discount_type, discount_value, tax_percent)
    new_order = models.Order(
        customer_id=customer.id,
        due_date=due_date,
        created_by=user.id,
        total_price=totals.subtotal,
        discount_type=totals.discount_type,
        discount_value=totals.discount_value,
        discount_amount=totals.discount_amount,
        final_price=totals.after_discount,
        tax_percent=totals.tax_percent,
        tax=totals.tax,
        amount_paid=totals.paid,
        balance=totals.balance,
        payment_status=totals.payment_status,
    )
    db.add(new_order)
    db.flush()
    for it in items:
        db.add(
            models.OrderItem(
                order_id=new_order.id,
                item_name=it.item_name,
                description=it.description,
                quantity=it.quantity,
                amount=it.amount,
            )
        )
    db.flush()
    inv = create_invoice_for_order(db, new_order, customer.id)
    return new_order, inv, totals
