from typing import List

from decimal import Decimal
from html import escape
import os

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

import logging
import smtplib

from app import models
from app.auth.auth import get_current_user, require_role
from app.database import get_db
from app.schemas import InvoiceDetailResponse, InvoiceListItem
from app.constants import APP_NAME
from app.utils.emailer import EmailConfigError, send_email

router = APIRouter()
logger = logging.getLogger(__name__)

TWOPLACES = Decimal("0.01")

def _username_from_email(email: str | None) -> str | None:
    s = (email or "").strip()
    if not s:
        return None
    return s.split("@")[0] or None


def _money(v: object) -> str:
    if v is None or v == "":
        return "—"
    try:
        return f"{Decimal(str(v)).quantize(TWOPLACES):,}"
    except Exception:
        return escape(str(v))


def _render_invoice_email(inv: models.Invoice, items: list[models.OrderItem]) -> str:
    c = inv.customer
    due = inv.due_date.strftime("%B %d, %Y") if inv.due_date else "—"
    issued = inv.created_at.strftime("%B %d, %Y") if inv.created_at else "—"
    order = inv.order
    discount_type = getattr(order, "discount_type", None) if order else None
    discount_value = getattr(order, "discount_value", None) if order else None
    discount_amount = getattr(order, "discount_amount", None) if order else None
    original_total = getattr(order, "total_price", None) if order else inv.total_price
    final_price = getattr(order, "final_price", None) if order else None
    tax = getattr(order, "tax", None) if order else None
    base_price = final_price if final_price is not None else original_total
    total = None
    if base_price is not None:
        total = (base_price or Decimal("0")) + (Decimal(str(tax)) if tax is not None else Decimal("0"))

    logo_url = (os.getenv("INVOICE_LOGO_URL", "") or "").strip()
    logo_html = (
        f"<img src='{escape(logo_url)}' alt='{escape(APP_NAME)} logo' style='width:56px;height:56px;object-fit:contain'/>"
        if logo_url
        else ""
    )

    # Build rows
    rows = []
    for it in items:
        rows.append(
            f"""
            <tr>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e5e5;font-weight:600;color:#111">{escape(it.item_name or '')}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e5e5;color:#111">{escape((it.description or '—'))}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e5e5;text-align:right;color:#111">{escape(str(it.quantity if it.quantity is not None else '—'))}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e5e5;text-align:right;color:#666">—</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e5e5;text-align:right;color:#666">—</td>
            </tr>
            """
        )
    rows_html = "\n".join(rows) if rows else "<tr><td colspan='5' style='padding:10px 12px;color:#666'>No items</td></tr>"

    # Always show the standardized pricing structure
    discount_display = _money(discount_amount if discount_amount is not None else Decimal("0.00"))
    tax_display = _money(tax if tax is not None else Decimal("0.00"))

    return f"""
    <div style="margin:0;padding:0;background:#f6f6f6">
      <div style="max-width:860px;margin:0 auto;padding:24px">
        <div style="background:#ffffff;border:1px solid #e5e5e5;overflow:hidden">
          <div style="padding:18px 22px;border-bottom:1px solid #e5e5e5">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:18px;font-family:Inter,Arial,sans-serif">
              <div style="display:flex;align-items:flex-start;gap:12px">
                <div style="width:56px;height:56px">{logo_html}</div>
                <div>
                  <div style="font-size:16px;font-weight:800;color:#111">{escape(APP_NAME)}</div>
                </div>
              </div>
              <div style="min-width:240px;text-align:right">
                <div style="display:inline-block;background:#111;color:#fff;padding:10px 14px;font-weight:800;letter-spacing:0.28em">INVOICE</div>
                <div style="margin-top:10px;font-size:13px;color:#111">
                  <div><span style="color:#666">Invoice Number:</span> <strong>#{escape(inv.invoice_number)}</strong></div>
                  <div style="margin-top:4px"><span style="color:#666">Date Issued:</span> <strong>{escape(issued)}</strong></div>
                </div>
              </div>
            </div>
          </div>

          <div style="padding:18px 22px;font-family:Inter,Arial,sans-serif">
            <div style="display:flex;gap:22px;justify-content:space-between;border-bottom:1px solid #e5e5e5;padding-bottom:14px">
              <div style="flex:1">
                <div style="font-weight:800;color:#111">Bill From:</div>
                <div style="margin-top:8px;color:#333;font-size:13px;line-height:1.55">
                  <div><strong>{escape(APP_NAME)}</strong></div>
                  <div>Address</div>
                  <div>Phone Number</div>
                  <div>Email</div>
                </div>
              </div>
              <div style="flex:1">
                <div style="font-weight:800;color:#111">Bill To:</div>
                <div style="margin-top:8px;color:#333;font-size:13px;line-height:1.55">
                  <div><strong>{escape(c.name or '')}</strong></div>
                  <div>{escape(c.address or '—')}</div>
                  <div>{escape(c.phone or '—')}</div>
                  <div>{escape(c.email or '—')}</div>
                </div>
              </div>
            </div>

            <div style="margin-top:14px;border:1px solid #d9d9d9">
              <table style="width:100%;border-collapse:collapse;font-size:13px">
                <thead>
                  <tr style="background:#f3f3f3;color:#111">
                    <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #d9d9d9;font-weight:800">Item</th>
                    <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #d9d9d9;font-weight:800">Description</th>
                    <th style="text-align:right;padding:10px 12px;border-bottom:1px solid #d9d9d9;font-weight:800">Quantity</th>
                    <th style="text-align:right;padding:10px 12px;border-bottom:1px solid #d9d9d9;font-weight:800">Rate</th>
                    <th style="text-align:right;padding:10px 12px;border-bottom:1px solid #d9d9d9;font-weight:800">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rows_html}
                </tbody>
              </table>
            </div>

            <div style="margin-top:14px;display:flex;justify-content:flex-end">
              <div style="width:320px;font-size:13px">
                <div style="display:flex;justify-content:space-between;padding:6px 0">
                  <div style="color:#444">Subtotal:</div>
                  <div style="font-weight:800;color:#111">{_money(original_total)}</div>
                </div>
                <div style="display:flex;justify-content:space-between;padding:6px 0">
                  <div style="color:#444">Discount</div>
                  <div style="font-weight:800;color:#111">-{discount_display}</div>
                </div>
                <div style="display:flex;justify-content:space-between;padding:6px 0">
                  <div style="color:#444">Tax:</div>
                  <div style="font-weight:800;color:#111">{tax_display}</div>
                </div>
                <div style="display:flex;justify-content:space-between;padding:6px 0">
                  <div style="color:#444">Paid:</div>
                  <div style="font-weight:800;color:#111">{_money(inv.deposit_paid)}</div>
                </div>
                <div style="display:flex;justify-content:space-between;padding:6px 0">
                  <div style="color:#444">Balance:</div>
                  <div style="font-weight:800;color:#111">{_money(inv.balance)}</div>
                </div>
                <div style="margin-top:10px;background:#111;color:#fff;padding:10px 14px;display:flex;justify-content:space-between;align-items:center">
                  <div style="font-size:16px;font-weight:900">Total</div>
                  <div style="font-size:16px;font-weight:900">{_money(total)}</div>
                </div>
              </div>
            </div>

            <div style="margin-top:14px;font-size:13px;color:#111">
              <span style="color:#666">Due date:</span> <strong>{escape(due)}</strong>
            </div>

            <div style="margin-top:16px;border-top:1px solid #e5e5e5;padding-top:10px">
              <div style="font-weight:800;color:#111">Terms &amp; Conditions:</div>
              <div style="margin-top:6px;color:#333">All properties belongs to the company until full payment is made.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
    """


def _invoice_to_list_item(db: Session, inv: models.Invoice, user) -> dict:
    c = inv.customer
    order = inv.order
    subtotal = getattr(order, "total_price", None) if order else inv.total_price
    after_discount = getattr(order, "final_price", None) if order else None
    tax = getattr(order, "tax", None) if order else None
    base_price = after_discount if after_discount is not None else subtotal
    total = None
    if base_price is not None:
        total = (base_price or Decimal("0")) + (tax or Decimal("0"))

    created_by_username = None
    if getattr(order, "created_by", None) and getattr(user, "role", None) == "admin":
        u = db.query(models.User).filter(models.User.id == order.created_by).first()
        created_by_username = _username_from_email(getattr(u, "email", None)) if u else None
    return {
        "id": inv.id,
        "invoice_number": inv.invoice_number,
        "order_id": inv.order_id,
        "customer_id": inv.customer_id,
        # Expose original total from the order for UI clarity
        "total_price": subtotal,
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
        "final_price": after_discount,
        "tax": tax,
        "total": total,
        "created_by": created_by_username,
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
    return [_invoice_to_list_item(db, inv, user) for inv in rows]


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
    base = _invoice_to_list_item(db, inv, user)
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

    base = _invoice_to_list_item(db, inv, user)
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

    order = inv.order
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    items = (
        db.query(models.OrderItem)
        .filter(models.OrderItem.order_id == order.id)
        .order_by(models.OrderItem.id.asc())
        .all()
    )

    to_email = inv.customer.email.strip()
    subject = f"{APP_NAME} - Invoice {inv.invoice_number}"
    html = _render_invoice_email(inv, items)
    try:
        send_email(to_email, subject, html)
    except EmailConfigError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    except smtplib.SMTPAuthenticationError as e:
        logger.exception("SMTP auth failed for invoice_email")
        raise HTTPException(status_code=502, detail="SMTP authentication failed") from e
    except (smtplib.SMTPConnectError, smtplib.SMTPServerDisconnected, TimeoutError) as e:
        logger.exception("SMTP connection failed for invoice_email")
        raise HTTPException(status_code=502, detail="SMTP connection failed") from e
    except smtplib.SMTPException as e:
        logger.exception("SMTP error for invoice_email")
        raise HTTPException(status_code=502, detail="SMTP error") from e
    except Exception as e:
        logger.exception("Failed to send invoice email")
        raise HTTPException(status_code=502, detail="Failed to send email") from e

    try:
        db.add(
            models.ActionLog(
                action="send_invoice_email",
                entity_type="invoice",
                entity_id=inv.id,
                actor_user_id=getattr(user, "id", None),
                actor_username=_username_from_email(getattr(user, "email", None)),
                meta={"to": to_email},
            )
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Failed to write action log for invoice email")

    return {"message": "Invoice sent"}
