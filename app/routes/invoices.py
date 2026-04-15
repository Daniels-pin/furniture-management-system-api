from datetime import datetime
from decimal import Decimal
from html import escape
import os
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

import logging
import smtplib

from app import models
from app.auth.auth import get_current_user, require_role
from app.auth.pdf_access import require_invoice_reader
from app.database import get_db
from app.db.alive import invoice_alive, order_alive
from app.schemas import InvoiceDetailResponse, InvoiceListItem
from app.constants import APP_NAME, COMPANY_ADDRESSES, company_contact_line_html, company_payment_details_html
from app.utils.emailer import EmailConfigError, send_email_html_with_pdf_attachment
from app.utils.pdf_job import document_pdf_bytes_via_ui
from app.utils.order_item_amounts import compute_subtotal, display_unit_amounts
from app.utils.activity_log import (
    log_activity,
    username_from_email,
    INVOICE_DELETED,
    INVOICE_DOWNLOADED,
    INVOICE_EMAIL_SENT,
    INVOICE_GENERATED,
    INVOICE_PRINTED,
)
from app.utils.invoices import create_invoice_for_order, sync_invoice_from_order
from types import SimpleNamespace

router = APIRouter()
logger = logging.getLogger(__name__)

TWOPLACES = Decimal("0.01")


def _money(v: object) -> str:
    if v is None or v == "":
        return "—"
    try:
        d = Decimal(str(v)).quantize(TWOPLACES)
        s = f"{d:,.2f}"
        if s.endswith(".00"):
            return s[:-3]
        return s.rstrip("0").rstrip(".")
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
    tax_percent = getattr(order, "tax_percent", None) if order else None
    tax_row_label = f"Tax ({escape(str(tax_percent))}%):" if tax_percent is not None else "Tax:"
    base_price = final_price if final_price is not None else original_total
    total = None
    if base_price is not None:
        total = (base_price or Decimal("0")) + (Decimal(str(tax)) if tax is not None else Decimal("0"))

    # Canonical logo URL used in invoice emails.
    # Prefer INVOICE_LOGO_URL, fallback to PUBLIC_LOGO_URL (keeps branding consistent across app surfaces).
    logo_url = (os.getenv("INVOICE_LOGO_URL", "") or "").strip() or (os.getenv("PUBLIC_LOGO_URL", "") or "").strip()
    logo_html = (
        f"<img src='{escape(logo_url)}' alt='{escape(APP_NAME)} logo' style='width:160px;height:160px;max-width:100%;object-fit:contain;object-position:left top'/>"
        if logo_url
        else ""
    )

    # Build rows (supports optional unit amount + inferred amounts from order total)
    units = display_unit_amounts(order, items)
    rows = []
    for i, it in enumerate(items):
        line_type = getattr(it, "line_type", "item") or "item"
        if line_type == "subheading":
            rows.append(
                f"""
            <tr>
              <td colspan="5" style="padding:10px 12px;border-bottom:1px solid #e5e5e5;font-weight:900;color:#111;letter-spacing:0.06em;text-transform:uppercase;background:#fafafa">
                {escape(it.item_name or '')}
              </td>
            </tr>
            """
            )
            continue
        unit = units[i] if i < len(units) else None
        line_total = None
        if unit is not None and it.quantity is not None:
            try:
                line_total = (Decimal(str(unit)) * Decimal(int(it.quantity))).quantize(TWOPLACES)
            except Exception:
                line_total = None
        rows.append(
            f"""
            <tr>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e5e5;font-weight:600;color:#111">{escape(it.item_name or '')}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e5e5;color:#111;white-space:normal;word-break:break-word;overflow-wrap:anywhere;line-height:1.25">{escape((it.description or '—'))}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e5e5;text-align:right;color:#111">{escape(str(it.quantity if it.quantity is not None else '—'))}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e5e5;text-align:right;color:#111">{escape(_money(unit))}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e5e5;text-align:right;color:#111">{escape(_money(line_total))}</td>
            </tr>
            """
        )
    rows_html = "\n".join(rows) if rows else "<tr><td colspan='5' style='padding:10px 12px;color:#666'>No items</td></tr>"

    # Always show the standardized pricing structure
    discount_display = _money(discount_amount if discount_amount is not None else Decimal("0.00"))
    tax_display = _money(tax if tax is not None else Decimal("0.00"))

    company_lines = "\n".join(
        f"<div>{escape(addr)}</div>" for addr in COMPANY_ADDRESSES
    )
    company_lines += (
        f'\n<div style="margin-top:2px;word-break:break-word">'
        f"{company_contact_line_html(escape)}</div>"
    )

    return f"""
    <div style="margin:0;padding:0;background:#f6f6f6">
      <div style="max-width:860px;margin:0 auto;padding:24px">
        <div style="background:#ffffff;border:1px solid #e5e5e5;overflow:hidden">
          <div style="padding:18px 22px;border-bottom:1px solid #e5e5e5">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:18px;font-family:Inter,Arial,sans-serif">
              <div style="display:flex;flex-direction:column;align-items:flex-start;gap:10px">
                <div style="width:160px;height:160px;max-width:100%">{logo_html}</div>
                <div style="font-size:11px;font-style:italic;font-weight:500;color:#666;letter-spacing:0.02em;line-height:1.35;max-width:280px">Furniture Nig Ltd</div>
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
            <div style="display:flex;gap:24px;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #e5e5e5;padding-bottom:12px">
              <div style="flex:1;min-width:0">
                <div style="font-weight:800;color:#111">Bill From:</div>
                <div style="margin-top:6px;color:#333;font-size:13px;line-height:1.4">
                  <div><strong>{escape(APP_NAME)}</strong></div>
                  {company_lines}
                </div>
              </div>
              <div style="flex:1;min-width:0;padding-left:20px;box-sizing:border-box">
                <div style="font-weight:800;color:#111">Bill To:</div>
                <div style="margin-top:6px;color:#333;font-size:13px;line-height:1.4">
                  <div><strong>{escape(c.name or '')}</strong></div>
                  <div>{escape(c.address or '—')}</div>
                  <div>{escape(c.phone or '—')}</div>
                  <div>{escape(c.email or '—')}</div>
                </div>
              </div>
            </div>

            <div style="margin-top:14px;border:1px solid #d9d9d9">
              <table style="width:100%;border-collapse:collapse;font-size:13px;table-layout:fixed">
                <colgroup>
                  <col style="width:24%"/>
                  <col style="width:46%"/>
                  <col style="width:8%"/>
                  <col style="width:11%"/>
                  <col style="width:11%"/>
                </colgroup>
                <thead>
                  <tr style="background:#f3f3f3;color:#111">
                    <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #d9d9d9;font-weight:800">Item</th>
                    <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #d9d9d9;font-weight:800">Description</th>
                    <th style="text-align:right;padding:10px 12px;border-bottom:1px solid #d9d9d9;font-weight:800">Qty</th>
                    <th style="text-align:right;padding:10px 12px;border-bottom:1px solid #d9d9d9;font-weight:800">Amount</th>
                    <th style="text-align:right;padding:10px 12px;border-bottom:1px solid #d9d9d9;font-weight:800">Total</th>
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
                  <div style="color:#444">{tax_row_label}</div>
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
            {company_payment_details_html(escape)}
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
    tax_percent = getattr(order, "tax_percent", None) if order else None
    base_price = after_discount if after_discount is not None else subtotal
    total = None
    if base_price is not None:
        total = (base_price or Decimal("0")) + (tax or Decimal("0"))

    created_by_username = None
    if getattr(order, "created_by", None) and getattr(user, "role", None) in ("admin", "showroom"):
        u = db.query(models.User).filter(models.User.id == order.created_by).first()
        created_by_username = username_from_email(getattr(u, "email", None)) if u else None
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
        "tax_percent": tax_percent,
        "tax": tax,
        "total": total,
        "created_by": created_by_username,
    }


@router.get("/invoices", response_model_exclude_none=True)
def list_invoices(
    limit: int = 20,
    offset: int = 0,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin", "showroom"])),
):
    lim = max(1, min(int(limit or 20), 100))
    off = max(0, int(offset or 0))
    q = (
        db.query(models.Invoice)
        .join(models.Order, models.Invoice.order_id == models.Order.id)
        .options(joinedload(models.Invoice.customer), joinedload(models.Invoice.order))
        .filter(invoice_alive())
        .filter(order_alive())
    )
    total = q.count()
    rows = q.order_by(models.Invoice.id.desc()).offset(off).limit(lim).all()
    return {"items": [_invoice_to_list_item(db, inv, user) for inv in rows], "total": total}


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
        .filter(invoice_alive())
        .first()
    )
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found for this order")

    order = inv.order
    if not order or order.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Order not found")
    items = (
        db.query(models.OrderItem)
        .filter(models.OrderItem.order_id == order.id)
        .all()
    )
    base = _invoice_to_list_item(db, inv, user)
    subtotal_from_items = compute_subtotal(items)
    effective_total_price = (
        getattr(order, "total_price", None)
        if order is not None and getattr(order, "total_price", None) is not None
        else (subtotal_from_items if subtotal_from_items is not None else base.get("total_price"))
    )
    units = display_unit_amounts(SimpleNamespace(total_price=effective_total_price), items)
    base["items"] = [
        {
            "id": it.id,
            "item_name": it.item_name,
            "description": it.description,
            "quantity": it.quantity,
            "amount": units[i] if i < len(units) else getattr(it, "amount", None),
        }
        for i, it in enumerate(items)
    ]
    if base.get("total_price") is None and subtotal_from_items is not None:
        base["total_price"] = subtotal_from_items
    return base


@router.post("/invoices/order/{order_id}")
def issue_invoice_for_order(
    order_id: int,
    order_edited_before_invoice: bool = Query(False),
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin", "showroom"])),
):
    """Create an invoice for an order that does not already have one (e.g. after invoice-only delete)."""
    order = db.query(models.Order).filter(models.Order.id == order_id).filter(order_alive()).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.customer_id is None:
        raise HTTPException(status_code=400, detail="Order has no customer")

    existing = (
        db.query(models.Invoice)
        .filter(models.Invoice.order_id == order_id)
        .filter(invoice_alive())
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="This order already has an invoice")

    inv = create_invoice_for_order(db, order, order.customer_id)
    sync_invoice_from_order(db, order)
    log_activity(
        db,
        action=INVOICE_GENERATED,
        entity_type="invoice",
        entity_id=inv.id,
        actor_user=user,
        meta={
            "order_id": order_id,
            "invoice_number": inv.invoice_number,
            "reissue": True,
            "order_edited_before_invoice": bool(order_edited_before_invoice),
        },
    )
    db.commit()
    db.refresh(inv)
    return {
        "message": "Invoice created",
        "invoice_id": inv.id,
        "invoice_number": inv.invoice_number,
        "order_id": order_id,
    }


@router.get("/invoices/{invoice_id}", response_model=InvoiceDetailResponse, response_model_exclude_none=True)
def get_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_invoice_reader),
):
    inv = (
        db.query(models.Invoice)
        .options(joinedload(models.Invoice.customer), joinedload(models.Invoice.order))
        .filter(models.Invoice.id == invoice_id)
        .filter(invoice_alive())
        .first()
    )
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")

    order = inv.order
    if not order or order.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Order not found")

    items = (
        db.query(models.OrderItem)
        .filter(models.OrderItem.order_id == order.id)
        .all()
    )

    base = _invoice_to_list_item(db, inv, user)
    subtotal_from_items = compute_subtotal(items)
    effective_total_price = (
        getattr(order, "total_price", None)
        if order is not None and getattr(order, "total_price", None) is not None
        else (subtotal_from_items if subtotal_from_items is not None else base.get("total_price"))
    )
    units = display_unit_amounts(SimpleNamespace(total_price=effective_total_price), items)
    base["items"] = [
        {
            "id": it.id,
            "item_name": it.item_name,
            "description": it.description,
            "quantity": it.quantity,
            "amount": units[i] if i < len(units) else getattr(it, "amount", None),
        }
        for i, it in enumerate(items)
    ]
    if base.get("total_price") is None and subtotal_from_items is not None:
        base["total_price"] = subtotal_from_items
    return base


@router.delete("/invoices/{invoice_id}")
def delete_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin"])),
):
    """Soft-delete invoice only; linked order and line items are kept. Admin only."""
    inv = (
        db.query(models.Invoice)
        .filter(models.Invoice.id == invoice_id)
        .filter(invoice_alive())
        .first()
    )
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")

    iid = inv.id
    inv_num = inv.invoice_number
    oid = inv.order_id
    log_activity(
        db,
        action=INVOICE_DELETED,
        entity_type="invoice",
        entity_id=iid,
        actor_user=user,
        meta={"invoice_number": inv_num, "order_id": oid, "soft_delete": True},
    )
    now = datetime.utcnow()
    inv.deleted_at = now
    inv.deleted_by_id = user.id

    # If this invoice originated from a quotation conversion, clear the pointer so the quotation can be reconverted.
    for q in (
        db.query(models.Quotation)
        .filter(models.Quotation.converted_order_id == oid)
        .filter(models.Quotation.deleted_at.is_(None))
        .all()
    ):
        q.converted_order_id = None
        if q.status == "converted":
            q.status = "finalized"
        q.updated_at = now
        q.updated_by = user.id

    db.commit()
    return {"message": "Invoice moved to Trash", "order_id": oid}


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
        .filter(invoice_alive())
        .first()
    )
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if not inv.customer or not (inv.customer.email or "").strip():
        raise HTTPException(status_code=400, detail="Customer has no email")

    order = inv.order
    if not order or order.deleted_at is not None:
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
        pdf_bytes = document_pdf_bytes_via_ui("invoice", "invoice", inv.id)
    except RuntimeError as e:
        logger.exception("Invoice PDF generation failed for email")
        raise HTTPException(status_code=500, detail=str(e)) from e
    except Exception as e:
        logger.exception("Invoice PDF generation failed for email")
        raise HTTPException(status_code=500, detail="Could not generate PDF attachment") from e

    safe_inv = re.sub(r"[^\w.\-]+", "_", inv.invoice_number or "invoice")
    try:
        send_email_html_with_pdf_attachment(
            to_email,
            subject,
            html,
            pdf_bytes,
            f"invoice-{safe_inv}.pdf",
        )
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
        log_activity(
            db,
            action=INVOICE_EMAIL_SENT,
            entity_type="invoice",
            entity_id=inv.id,
            actor_user=user,
            meta={"to": to_email},
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Failed to write action log for invoice email")

    return {"message": "Invoice sent"}


@router.post("/invoices/{invoice_id}/print")
def record_invoice_print(
    invoice_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin", "showroom"])),
):
    inv = (
        db.query(models.Invoice)
        .filter(models.Invoice.id == invoice_id)
        .filter(invoice_alive())
        .first()
    )
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    log_activity(
        db,
        action=INVOICE_PRINTED,
        entity_type="invoice",
        entity_id=inv.id,
        actor_user=user,
        meta={"invoice_number": inv.invoice_number},
    )
    db.commit()
    return {"message": "Recorded"}


@router.post("/invoices/{invoice_id}/download")
def download_invoice_pdf(
    invoice_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin", "showroom"])),
):
    inv = (
        db.query(models.Invoice)
        .filter(models.Invoice.id == invoice_id)
        .filter(invoice_alive())
        .first()
    )
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    try:
        pdf_bytes = document_pdf_bytes_via_ui("invoice", "invoice", inv.id)
    except RuntimeError as e:
        logger.exception("Invoice PDF download failed")
        raise HTTPException(status_code=500, detail=str(e)) from e
    except Exception as e:
        logger.exception("Invoice PDF download failed")
        raise HTTPException(status_code=500, detail="Could not generate PDF") from e

    log_activity(
        db,
        action=INVOICE_DOWNLOADED,
        entity_type="invoice",
        entity_id=inv.id,
        actor_user=user,
        meta={"invoice_number": inv.invoice_number},
    )
    db.commit()

    safe = re.sub(r"[^\w.\-]+", "_", inv.invoice_number or "invoice")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="invoice-{safe}.pdf"'},
    )
