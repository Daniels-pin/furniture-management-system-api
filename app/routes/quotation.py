from __future__ import annotations

import logging
import os
import re
import smtplib
from datetime import datetime
from decimal import Decimal
from html import escape
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app import models
from app.auth.auth import require_role
from app.auth.pdf_access import require_quotation_reader
from app.constants import APP_NAME, COMPANY_ADDRESSES, company_contact_line_html, company_payment_details_html
from app.database import get_db
from app.db.alive import customer_alive, invoice_alive, order_alive, proforma_alive, quotation_alive
from app.schemas import (
    ConvertPresalesToInvoiceRequest,
    QuotationCreate,
    QuotationDetailResponse,
    QuotationItemIn,
    QuotationUpdate,
)
from app.utils.activity_log import (
    QUOTATION_CONVERTED_TO_INVOICE,
    QUOTATION_CONVERTED_TO_PROFORMA,
    QUOTATION_CREATED,
    QUOTATION_DELETED,
    QUOTATION_DOWNLOADED,
    QUOTATION_DRAFT_UPDATED,
    QUOTATION_FINALIZED,
    QUOTATION_PRINTED,
    QUOTATION_SENT,
    QUOTATION_UPDATED,
    log_activity,
    username_from_email,
)
from app.utils.emailer import EmailConfigError, send_email_html_with_pdf_attachment
from app.utils.pdf_job import document_pdf_bytes_via_ui
from app.utils.presales_order import (
    create_order_and_invoice_from_presales_items,
    get_or_create_customer_for_presales,
    next_proforma_number,
    next_quotation_number,
    presales_to_invoice_activity_meta,
    store_computed_totals,
)

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


def _user_label(db: Session, user_id: int | None) -> str | None:
    if user_id is None:
        return None
    u = db.query(models.User).filter(models.User.id == user_id).first()
    return username_from_email(getattr(u, "email", None)) if u else None


def _reset_quotation_conversion_if_link_missing(db: Session, q: models.Quotation, *, actor_user_id: int | None) -> bool:
    """
    Quotations store conversion pointers; if the linked proforma/order/invoice is deleted,
    clear the pointer(s) and revert status so the user can convert again.
    """
    changed = False
    now = datetime.utcnow()

    if getattr(q, "converted_proforma_id", None) is not None:
        pf = (
            db.query(models.ProformaInvoice)
            .filter(models.ProformaInvoice.id == q.converted_proforma_id)
            .filter(proforma_alive())
            .first()
        )
        if pf is None:
            q.converted_proforma_id = None
            changed = True

    if getattr(q, "converted_order_id", None) is not None:
        order = (
            db.query(models.Order)
            .filter(models.Order.id == q.converted_order_id)
            .filter(order_alive())
            .first()
        )
        inv_ok = False
        if order is not None:
            inv_ok = (
                db.query(models.Invoice)
                .filter(models.Invoice.order_id == order.id)
                .filter(invoice_alive())
                .first()
                is not None
            )
        if order is None or not inv_ok:
            q.converted_order_id = None
            changed = True

    if changed:
        if q.status == "converted":
            # Only finalized quotations are allowed to convert; revert to finalized.
            q.status = "finalized"
        q.updated_at = now
        if actor_user_id is not None:
            q.updated_by = actor_user_id
        db.commit()
        db.refresh(q)
    return changed


def _quotation_to_detail(db: Session, p: models.Quotation) -> dict:
    items = sorted(p.items or [], key=lambda x: x.id)
    return {
        "id": p.id,
        "quote_number": p.quote_number,
        "status": p.status,
        "customer_name": p.customer_name,
        "phone": p.phone,
        "address": p.address,
        "email": p.email,
        "due_date": p.due_date,
        "items": [
            {
                "id": it.id,
                "line_type": getattr(it, "line_type", "item") or "item",
                "item_name": it.item_name,
                "description": it.description,
                "quantity": it.quantity,
                "amount": it.amount,
            }
            for it in items
        ],
        "discount_type": p.discount_type,
        "discount_value": p.discount_value,
        "discount_amount": p.discount_amount,
        "tax_percent": p.tax_percent,
        "tax": p.tax,
        "subtotal": p.subtotal,
        "final_price": p.final_price,
        "grand_total": p.grand_total,
        "created_at": p.created_at,
        "updated_at": p.updated_at,
        "created_by": _user_label(db, p.created_by),
        "updated_by": _user_label(db, p.updated_by),
        "converted_order_id": p.converted_order_id,
        "converted_proforma_id": p.converted_proforma_id,
    }


def _link_customer(db: Session, phone: str, email: str | None) -> int | None:
    phone = phone.strip()
    c = (
        db.query(models.Customer)
        .filter(models.Customer.phone == phone)
        .filter(customer_alive())
        .first()
    )
    if c:
        if email and not (c.email or "").strip():
            c.email = str(email).strip()
        return c.id
    return None


def _render_quotation_email_html(p: models.Quotation) -> str:
    issued = p.created_at.strftime("%B %d, %Y") if p.created_at else "—"
    logo_url = (os.getenv("INVOICE_LOGO_URL", "") or "").strip() or (os.getenv("PUBLIC_LOGO_URL", "") or "").strip()
    logo_html = (
        f"<img src='{escape(logo_url)}' alt='{escape(APP_NAME)} logo' style='width:160px;height:160px;max-width:100%;object-fit:contain;object-position:left top'/>"
        if logo_url
        else ""
    )
    company_lines = "\n".join(f"<div>{escape(addr)}</div>" for addr in COMPANY_ADDRESSES)
    company_lines += (
        f'\n<div style="margin-top:2px;word-break:break-word">'
        f"{company_contact_line_html(escape)}</div>"
    )

    rows = []
    for it in sorted(p.items or [], key=lambda x: x.id):
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
        unit = it.amount
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

    discount_display = _money(p.discount_amount if p.discount_amount is not None else Decimal("0.00"))
    tax_display = _money(p.tax if p.tax is not None else Decimal("0.00"))
    tax_row_label = f"Tax ({escape(str(p.tax_percent))}%):" if p.tax_percent is not None else "Tax:"
    grand = _money(p.grand_total)

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
                <div style="display:inline-block;background:#111;color:#fff;padding:10px 14px;font-weight:800;letter-spacing:0.22em">QUOTATION</div>
                <div style="margin-top:10px;font-size:13px;color:#111">
                  <div><span style="color:#666">Quote number:</span> <strong>#{escape(p.quote_number)}</strong></div>
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
                  <div><strong>{escape(p.customer_name or '')}</strong></div>
                  <div>{escape(p.address or '—')}</div>
                  <div>{escape(p.phone or '—')}</div>
                  <div>{escape(p.email or '—')}</div>
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
                  <div style="font-weight:800;color:#111">{_money(p.subtotal)}</div>
                </div>
                <div style="display:flex;justify-content:space-between;padding:6px 0">
                  <div style="color:#444">Discount</div>
                  <div style="font-weight:800;color:#111">-{discount_display}</div>
                </div>
                <div style="display:flex;justify-content:space-between;padding:6px 0">
                  <div style="color:#444">{tax_row_label}</div>
                  <div style="font-weight:800;color:#111">{tax_display}</div>
                </div>
                <div style="margin-top:10px;background:#111;color:#fff;padding:10px 14px;display:flex;justify-content:space-between;align-items:center">
                  <div style="font-size:16px;font-weight:900">Total</div>
                  <div style="font-size:16px;font-weight:900">{grand}</div>
                </div>
              </div>
            </div>

            <div style="margin-top:16px;border-top:1px solid #e5e5e5;padding-top:10px">
              <div style="font-weight:800;color:#111">Terms &amp; Conditions:</div>
              <div style="margin-top:6px;color:#333">This quotation is for pricing discussion only and is not a tax invoice.</div>
            </div>
            {company_payment_details_html(escape)}
          </div>
        </div>
      </div>
    </div>
    """


@router.get("/quotations")
def list_quotations(
    limit: int = 20,
    offset: int = 0,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin", "showroom", "finance"])),
):
    lim = max(1, min(int(limit or 20), 100))
    off = max(0, int(offset or 0))
    q = (
        db.query(models.Quotation)
        .options(joinedload(models.Quotation.items))
        .filter(quotation_alive())
    )
    total = q.count()
    rows = q.order_by(models.Quotation.id.desc()).offset(off).limit(lim).all()
    out = []
    for p in rows:
        out.append(
            {
                "id": p.id,
                "quote_number": p.quote_number,
                "status": p.status,
                "customer_name": p.customer_name,
                "grand_total": p.grand_total,
                "created_at": p.created_at,
                "created_by": _user_label(db, p.created_by),
            }
        )
    return {"items": out, "total": total}


@router.post("/quotations", response_model=QuotationDetailResponse)
def create_quotation(
    payload: QuotationCreate,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin", "showroom", "finance"])),
):
    email_val = str(payload.email).strip() if payload.email else None
    cid = _link_customer(db, payload.phone, email_val)

    status = "draft" if payload.save_as_draft else "finalized"
    p = models.Quotation(
        quote_number=next_quotation_number(db),
        status=status,
        customer_name=payload.customer_name.strip(),
        phone=payload.phone.strip(),
        address=payload.address.strip(),
        email=email_val,
        customer_id=cid,
        due_date=payload.due_date,
        created_by=user.id,
        updated_by=user.id,
        updated_at=datetime.utcnow(),
    )
    db.add(p)
    db.flush()

    for it in payload.items:
        lt = getattr(it, "line_type", "item") or "item"
        db.add(
            models.QuotationItem(
                quotation_id=p.id,
                line_type=lt,
                item_name=it.item_name.strip(),
                description=(it.description or "").strip() or None,
                quantity=(it.quantity or 0) if lt != "subheading" else 0,
                amount=it.amount if lt != "subheading" else None,
            )
        )
    db.flush()
    db.refresh(p)
    items = db.query(models.QuotationItem).filter(models.QuotationItem.quotation_id == p.id).all()
    store_computed_totals(
        p,
        items,
        payload.discount_type,
        payload.discount_value,
        payload.tax,
    )

    log_activity(
        db,
        action=QUOTATION_CREATED,
        entity_type="quotation",
        entity_id=p.id,
        actor_user=user,
        meta={"status": status, "draft": payload.save_as_draft},
    )
    db.commit()
    db.refresh(p)
    return _quotation_to_detail(db, p)


@router.get("/quotations/{quotation_id}", response_model=QuotationDetailResponse)
def get_quotation(
    quotation_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_quotation_reader),
):
    p = (
        db.query(models.Quotation)
        .options(joinedload(models.Quotation.items))
        .filter(models.Quotation.id == quotation_id)
        .filter(quotation_alive())
        .first()
    )
    if not p:
        raise HTTPException(status_code=404, detail="Quotation not found")
    _reset_quotation_conversion_if_link_missing(db, p, actor_user_id=getattr(user, "id", None))
    return _quotation_to_detail(db, p)


@router.put("/quotations/{quotation_id}", response_model=QuotationDetailResponse)
def update_quotation(
    quotation_id: int,
    payload: QuotationUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin", "showroom", "finance"])),
):
    p = (
        db.query(models.Quotation)
        .filter(models.Quotation.id == quotation_id)
        .filter(quotation_alive())
        .first()
    )
    if not p:
        raise HTTPException(status_code=404, detail="Quotation not found")
    if p.status == "converted":
        raise HTTPException(status_code=400, detail="Cannot edit a converted quotation")

    old_status = p.status
    email_val = str(payload.email).strip() if payload.email else None
    p.customer_name = payload.customer_name.strip()
    p.phone = payload.phone.strip()
    p.address = payload.address.strip()
    p.email = email_val
    p.due_date = payload.due_date
    p.updated_by = user.id
    p.updated_at = datetime.utcnow()
    p.customer_id = _link_customer(db, payload.phone, email_val)

    if payload.save_as_draft:
        p.status = "draft"
    else:
        p.status = "finalized"

    db.query(models.QuotationItem).filter(models.QuotationItem.quotation_id == p.id).delete()
    for it in payload.items:
        lt = getattr(it, "line_type", "item") or "item"
        db.add(
            models.QuotationItem(
                quotation_id=p.id,
                line_type=lt,
                item_name=it.item_name.strip(),
                description=(it.description or "").strip() or None,
                quantity=(it.quantity or 0) if lt != "subheading" else 0,
                amount=it.amount if lt != "subheading" else None,
            )
        )
    db.flush()
    items = db.query(models.QuotationItem).filter(models.QuotationItem.quotation_id == p.id).all()
    store_computed_totals(
        p,
        items,
        payload.discount_type,
        payload.discount_value,
        payload.tax,
    )

    if old_status == "draft" and p.status == "finalized":
        log_activity(
            db,
            action=QUOTATION_FINALIZED,
            entity_type="quotation",
            entity_id=p.id,
            actor_user=user,
        )
    elif p.status == "draft":
        log_activity(
            db,
            action=QUOTATION_DRAFT_UPDATED,
            entity_type="quotation",
            entity_id=p.id,
            actor_user=user,
        )
    else:
        log_activity(
            db,
            action=QUOTATION_UPDATED,
            entity_type="quotation",
            entity_id=p.id,
            actor_user=user,
            meta={"status": p.status},
        )
    db.commit()
    db.refresh(p)
    return _quotation_to_detail(db, p)


@router.patch("/quotations/{quotation_id}/finalize", response_model=QuotationDetailResponse)
def finalize_quotation(
    quotation_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin", "showroom", "finance"])),
):
    p = (
        db.query(models.Quotation)
        .filter(models.Quotation.id == quotation_id)
        .filter(quotation_alive())
        .first()
    )
    if not p:
        raise HTTPException(status_code=404, detail="Quotation not found")
    if p.status == "converted":
        raise HTTPException(status_code=400, detail="Already converted")
    if p.status != "draft":
        raise HTTPException(status_code=400, detail="Only drafts can be finalized via this action")

    p.status = "finalized"
    p.updated_by = user.id
    p.updated_at = datetime.utcnow()
    log_activity(
        db,
        action=QUOTATION_FINALIZED,
        entity_type="quotation",
        entity_id=p.id,
        actor_user=user,
    )
    db.commit()
    db.refresh(p)
    return _quotation_to_detail(db, p)


@router.post("/quotations/{quotation_id}/send-email")
def send_quotation_email(
    quotation_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin", "showroom"])),
):
    p = (
        db.query(models.Quotation)
        .options(joinedload(models.Quotation.items))
        .filter(models.Quotation.id == quotation_id)
        .filter(quotation_alive())
        .first()
    )
    if not p:
        raise HTTPException(status_code=404, detail="Quotation not found")
    if not (p.email or "").strip():
        raise HTTPException(status_code=400, detail="Customer has no email")

    to_email = p.email.strip()
    subject = f"{APP_NAME} - Quotation {p.quote_number}"
    html = _render_quotation_email_html(p)
    try:
        pdf_bytes = document_pdf_bytes_via_ui("quotation", "quotation", p.id)
    except RuntimeError as e:
        logger.exception("Quotation PDF generation failed for email")
        raise HTTPException(status_code=500, detail=str(e)) from e
    except Exception as e:
        logger.exception("Quotation PDF generation failed for email")
        raise HTTPException(status_code=500, detail="Could not generate PDF attachment") from e

    safe_n = re.sub(r"[^\w.\-]+", "_", p.quote_number or "quotation")
    try:
        send_email_html_with_pdf_attachment(
            to_email,
            subject,
            html,
            pdf_bytes,
            f"quotation-{safe_n}.pdf",
        )
    except EmailConfigError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    except smtplib.SMTPAuthenticationError as e:
        logger.exception("SMTP auth failed for proforma email")
        raise HTTPException(status_code=502, detail="SMTP authentication failed") from e
    except (smtplib.SMTPConnectError, smtplib.SMTPServerDisconnected, TimeoutError) as e:
        logger.exception("SMTP connection failed for proforma email")
        raise HTTPException(status_code=502, detail="SMTP connection failed") from e
    except smtplib.SMTPException as e:
        logger.exception("SMTP error for proforma email")
        raise HTTPException(status_code=502, detail="SMTP error") from e
    except Exception as e:
        logger.exception("Failed to send proforma email")
        raise HTTPException(status_code=502, detail="Failed to send email") from e

    log_activity(
        db,
        action=QUOTATION_SENT,
        entity_type="quotation",
        entity_id=p.id,
        actor_user=user,
        meta={"to": to_email},
    )
    db.commit()
    return {"message": "Quotation sent"}


@router.post("/quotations/{quotation_id}/print")
def record_quotation_print(
    quotation_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin", "showroom"])),
):
    p = (
        db.query(models.Quotation)
        .filter(models.Quotation.id == quotation_id)
        .filter(quotation_alive())
        .first()
    )
    if not p:
        raise HTTPException(status_code=404, detail="Quotation not found")
    log_activity(
        db,
        action=QUOTATION_PRINTED,
        entity_type="quotation",
        entity_id=p.id,
        actor_user=user,
        meta={"quote_number": p.quote_number},
    )
    db.commit()
    return {"message": "Recorded"}


@router.post("/quotations/{quotation_id}/download")
def download_quotation_pdf(
    quotation_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin", "showroom"])),
):
    p = (
        db.query(models.Quotation)
        .options(joinedload(models.Quotation.items))
        .filter(models.Quotation.id == quotation_id)
        .filter(quotation_alive())
        .first()
    )
    if not p:
        raise HTTPException(status_code=404, detail="Quotation not found")

    try:
        pdf_bytes = document_pdf_bytes_via_ui("quotation", "quotation", p.id)
    except RuntimeError as e:
        logger.exception("Quotation PDF download failed")
        raise HTTPException(status_code=500, detail=str(e)) from e
    except Exception as e:
        logger.exception("Quotation PDF download failed")
        raise HTTPException(status_code=500, detail="Could not generate PDF") from e

    log_activity(
        db,
        action=QUOTATION_DOWNLOADED,
        entity_type="quotation",
        entity_id=p.id,
        actor_user=user,
        meta={"quote_number": p.quote_number},
    )
    db.commit()

    safe = re.sub(r"[^\w.\-]+", "_", p.quote_number or "quotation")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="quotation-{safe}.pdf"'},
    )


@router.post("/quotations/{quotation_id}/convert-to-proforma")
def convert_quotation_to_proforma(
    quotation_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin", "showroom"])),
):
    q = (
        db.query(models.Quotation)
        .options(joinedload(models.Quotation.items))
        .filter(models.Quotation.id == quotation_id)
        .first()
    )
    if not q:
        raise HTTPException(status_code=404, detail="Quotation not found")
    # If the previously converted document was deleted, clear pointers so this can be reconverted.
    _reset_quotation_conversion_if_link_missing(db, q, actor_user_id=getattr(user, "id", None))
    if q.status == "converted" or q.converted_proforma_id is not None or q.converted_order_id is not None:
        raise HTTPException(status_code=400, detail="Already converted")

    cid = _link_customer(db, q.phone, q.email)

    pf = models.ProformaInvoice(
        proforma_number=next_proforma_number(db),
        status="finalized",
        customer_name=q.customer_name,
        phone=q.phone.strip(),
        address=q.address.strip(),
        email=q.email,
        customer_id=cid or q.customer_id,
        due_date=q.due_date,
        created_by=user.id,
        updated_by=user.id,
        updated_at=datetime.utcnow(),
    )
    db.add(pf)
    db.flush()
    for qi in sorted(q.items or [], key=lambda x: x.id):
        lt = (getattr(qi, "line_type", None) or "item").lower()
        db.add(
            models.ProformaItem(
                proforma_id=pf.id,
                line_type=lt,
                item_name=qi.item_name,
                description=qi.description,
                quantity=qi.quantity,
                amount=qi.amount,
            )
        )
    db.flush()
    items = db.query(models.ProformaItem).filter(models.ProformaItem.proforma_id == pf.id).all()
    store_computed_totals(
        pf,
        items,
        q.discount_type,
        q.discount_value,
        q.tax_percent,
    )
    q.converted_proforma_id = pf.id
    q.status = "converted"
    q.updated_by = user.id
    q.updated_at = datetime.utcnow()

    log_activity(
        db,
        action=QUOTATION_CONVERTED_TO_PROFORMA,
        entity_type="quotation",
        entity_id=q.id,
        actor_user=user,
        meta={"proforma_id": pf.id},
    )
    db.commit()

    return {"message": "Converted to proforma", "proforma_id": pf.id}


@router.post("/quotations/{quotation_id}/convert-to-invoice")
def convert_quotation_to_invoice(
    quotation_id: int,
    payload: ConvertPresalesToInvoiceRequest = Body(default_factory=ConvertPresalesToInvoiceRequest),
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin", "showroom"])),
):
    p = (
        db.query(models.Quotation)
        .options(joinedload(models.Quotation.items))
        .filter(models.Quotation.id == quotation_id)
        .filter(quotation_alive())
        .first()
    )
    if not p:
        raise HTTPException(status_code=404, detail="Quotation not found")
    _reset_quotation_conversion_if_link_missing(db, p, actor_user_id=getattr(user, "id", None))
    if p.converted_order_id is not None:
        raise HTTPException(status_code=400, detail="Already converted")
    if p.status == "converted":
        raise HTTPException(status_code=400, detail="Already converted")

    customer = get_or_create_customer_for_presales(
        db,
        customer_name=p.customer_name,
        phone=p.phone,
        address=p.address,
        email=p.email,
        creator_id=user.id,
    )
    items = sorted(p.items or [], key=lambda x: x.id)
    new_order, inv, totals = create_order_and_invoice_from_presales_items(
        db,
        user=user,
        customer=customer,
        due_date=p.due_date,
        items=items,
        discount_type=p.discount_type,
        discount_value=p.discount_value,
        tax_percent=p.tax_percent,
        amount_paid_in=payload.amount_paid,
    )
    p.converted_order_id = new_order.id
    p.status = "converted"
    p.customer_id = customer.id
    p.updated_by = user.id
    p.updated_at = datetime.utcnow()

    paid = totals.paid or Decimal("0")
    gtot = totals.total or Decimal("0")
    bal = totals.balance if totals.balance is not None else (gtot - paid)
    log_activity(
        db,
        action=QUOTATION_CONVERTED_TO_INVOICE,
        entity_type="quotation",
        entity_id=p.id,
        actor_user=user,
        meta=presales_to_invoice_activity_meta(
            source="quotation",
            document_number=p.quote_number,
            actor_user=user,
            order_id=new_order.id,
            invoice_id=inv.id,
            totals=totals,
        ),
    )
    db.commit()

    return {
        "message": "Converted to invoice",
        "order_id": new_order.id,
        "invoice_id": inv.id,
        "amount_paid": str(paid),
        "grand_total": str(gtot),
        "balance": str(bal),
        "payment_status": totals.payment_status,
    }


@router.delete("/quotations/{quotation_id}")
def delete_quotation(
    quotation_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin", "showroom"])),
):
    p = (
        db.query(models.Quotation)
        .filter(models.Quotation.id == quotation_id)
        .filter(quotation_alive())
        .first()
    )
    if not p:
        raise HTTPException(status_code=404, detail="Quotation not found")
    pid = p.id
    meta_num = p.quote_number
    log_activity(
        db,
        action=QUOTATION_DELETED,
        entity_type="quotation",
        entity_id=pid,
        actor_user=user,
        meta={"quote_number": meta_num, "soft_delete": True},
    )
    p.deleted_at = datetime.utcnow()
    p.deleted_by_id = user.id
    db.commit()
    return {"message": "Quotation moved to Trash"}
