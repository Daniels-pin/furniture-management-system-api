from typing import List

from decimal import Decimal
from html import escape

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

    # Build rows
    rows = []
    for it in items:
        rows.append(
            f"""
            <tr>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e5e5;font-weight:600;color:#111">{escape(it.item_name or '')}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e5e5;color:#111">{escape((it.description or '—'))}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e5e5;text-align:right;color:#111">{escape(str(it.quantity if it.quantity is not None else '—'))}</td>
            </tr>
            """
        )
    rows_html = "\n".join(rows) if rows else "<tr><td colspan='3' style='padding:10px 12px;color:#666'>No items</td></tr>"

    discount_block = ""
    if discount_type:
        dtype = "Percentage" if str(discount_type) == "percentage" else "Fixed"
        if str(discount_type) == "percentage":
            dval = f"{escape(str(discount_value))}%"
        else:
            dval = _money(discount_value)
        discount_block = f"""
                <tr>
                  <td style="padding:6px 0;color:#666;font-size:13px">Discount</td>
                  <td style="padding:6px 0;color:#111;font-size:13px;text-align:right;font-weight:800">
                    {escape(dtype)} ({dval}) • -{_money(discount_amount)}
                  </td>
                </tr>
                <tr>
                  <td style="padding:6px 0;color:#666;font-size:13px">Final price</td>
                  <td style="padding:6px 0;color:#111;font-size:13px;text-align:right;font-weight:900">{_money(final_price or original_total)}</td>
                </tr>
        """

    return f"""
    <div style="margin:0;padding:0;background:#f6f6f6">
      <div style="max-width:820px;margin:0 auto;padding:24px">
        <div style="background:#ffffff;border:1px solid #eaeaea;border-radius:18px;overflow:hidden">
          <div style="padding:22px 22px 16px 22px;border-bottom:1px solid #efefef">
            <div style="font-family:Inter,Arial,sans-serif;color:#111">
              <div style="font-size:18px;font-weight:800;letter-spacing:-0.2px">{escape(APP_NAME)}</div>
              <div style="margin-top:8px;font-size:14px;color:#333">
                <span style="font-weight:700">Invoice</span> #{escape(inv.invoice_number)}
              </div>
              <div style="margin-top:4px;font-size:13px;color:#666">Date issued: {escape(issued)}</div>
            </div>
          </div>

          <div style="padding:18px 22px;font-family:Inter,Arial,sans-serif">
            <div style="display:block;margin-bottom:14px">
              <div style="font-size:12px;font-weight:800;color:#111;letter-spacing:0.06em;text-transform:uppercase">Customer</div>
              <div style="margin-top:8px;font-size:14px;color:#111;line-height:1.5">
                <div><span style="color:#666">Name:</span> <strong>{escape(c.name or '')}</strong></div>
                <div><span style="color:#666">Phone:</span> <strong>{escape(c.phone or '—')}</strong></div>
                <div><span style="color:#666">Email:</span> <strong>{escape(c.email or '—')}</strong></div>
                <div><span style="color:#666">Address:</span> <strong>{escape(c.address or '—')}</strong></div>
              </div>
            </div>

            <div style="margin-top:10px">
              <div style="font-size:12px;font-weight:800;color:#111;letter-spacing:0.06em;text-transform:uppercase">Items</div>
              <div style="margin-top:10px;border:1px solid #eeeeee;border-radius:14px;overflow:hidden">
                <table style="width:100%;border-collapse:collapse;font-size:13px">
                  <thead>
                    <tr style="background:#fafafa;color:#444">
                      <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e5e5e5;font-weight:700">Item</th>
                      <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e5e5e5;font-weight:700">Description</th>
                      <th style="text-align:right;padding:10px 12px;border-bottom:1px solid #e5e5e5;font-weight:700">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows_html}
                  </tbody>
                </table>
              </div>
            </div>

            <div style="margin-top:16px;border-top:1px solid #efefef;padding-top:14px">
              <table style="width:100%;border-collapse:collapse;font-family:Inter,Arial,sans-serif">
                <tr>
                  <td style="padding:6px 0;color:#666;font-size:13px">Total price</td>
                  <td style="padding:6px 0;color:#111;font-size:13px;text-align:right;font-weight:800">{_money(original_total)}</td>
                </tr>
                {discount_block}
                <tr>
                  <td style="padding:6px 0;color:#666;font-size:13px">Deposit made</td>
                  <td style="padding:6px 0;color:#111;font-size:13px;text-align:right;font-weight:800">{_money(inv.deposit_paid)}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;color:#666;font-size:13px">Balance</td>
                  <td style="padding:6px 0;color:#111;font-size:13px;text-align:right;font-weight:900">{_money(inv.balance)}</td>
                </tr>
              </table>
              <div style="margin-top:10px;font-size:13px;color:#111">
                <span style="color:#666">Due date:</span> <strong>{escape(due)}</strong>
              </div>
            </div>
          </div>

          <div style="padding:14px 22px;border-top:1px solid #efefef;background:#fafafa;font-family:Inter,Arial,sans-serif">
            <div style="font-size:12px;color:#666">This invoice was sent from {escape(APP_NAME)}.</div>
          </div>
        </div>
      </div>
    </div>
    """


def _invoice_to_list_item(inv: models.Invoice, user) -> dict:
    c = inv.customer
    order = inv.order
    return {
        "id": inv.id,
        "invoice_number": inv.invoice_number,
        "order_id": inv.order_id,
        "customer_id": inv.customer_id,
        # Expose original total from the order for UI clarity
        "total_price": getattr(order, "total_price", None) if order else inv.total_price,
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

    return {"message": "Invoice sent"}
