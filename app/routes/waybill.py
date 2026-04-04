from __future__ import annotations

import logging
import os
import re
import smtplib
from datetime import datetime
from html import escape
from types import SimpleNamespace

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app import models
from app.auth.auth import require_role
from app.auth.pdf_access import require_waybill_reader
from app.constants import APP_NAME, COMPANY_ADDRESSES, company_contact_line_html
from app.database import get_db
from app.schemas import WaybillCreate, WaybillLogisticsUpdate, WaybillStatusUpdate
from app.utils.activity_log import (
    WAYBILL_CREATED,
    WAYBILL_DELETED,
    WAYBILL_DOWNLOADED,
    WAYBILL_PRINTED,
    WAYBILL_SENT,
    WAYBILL_STATUS_UPDATED,
    WAYBILL_VIEWED,
    log_activity,
    username_from_email,
)
from app.utils.emailer import EmailConfigError, send_email_html_with_pdf_attachment
from app.utils.pdf_job import document_pdf_bytes_via_ui
from app.utils.order_item_amounts import display_unit_amounts

router = APIRouter()
logger = logging.getLogger(__name__)

ALLOWED_STATUS = frozenset({"pending", "shipped", "delivered"})

WAYBILL_LOGISTICS_REQUIRED = (
    "Driver name, driver phone, and vehicle plate are required before sending, "
    "downloading, or printing. Save logistics on this waybill first."
)


def _waybill_driver_ready(wb: models.Waybill) -> bool:
    return bool(
        (wb.driver_name or "").strip()
        and (wb.driver_phone or "").strip()
        and (wb.vehicle_plate or "").strip()
    )


def _user_label(db: Session, user_id: int | None) -> str | None:
    if user_id is None:
        return None
    u = db.query(models.User).filter(models.User.id == user_id).first()
    return username_from_email(getattr(u, "email", None)) if u else None


def next_waybill_number(db: Session) -> str:
    n = db.query(func.count(models.Waybill.id)).scalar() or 0
    return f"WB-{int(n) + 1:04d}"


def _waybill_items_payload(db: Session, order: models.Order) -> list[dict]:
    items = (
        db.query(models.OrderItem)
        .filter(models.OrderItem.order_id == order.id)
        .order_by(models.OrderItem.id.asc())
        .all()
    )
    effective_total = getattr(order, "total_price", None)
    units = display_unit_amounts(SimpleNamespace(total_price=effective_total), items)
    out = []
    for i, it in enumerate(items):
        unit = units[i] if i < len(units) else getattr(it, "amount", None)
        out.append(
            {
                "id": it.id,
                "item_name": it.item_name,
                "description": it.description,
                "quantity": it.quantity,
                "amount": unit,
            }
        )
    return out


def _waybill_to_detail(db: Session, wb: models.Waybill) -> dict:
    order = wb.order
    if not order:
        raise HTTPException(status_code=404, detail="Order not found for waybill")
    cust = order.customer
    items = _waybill_items_payload(db, order)
    return {
        "id": wb.id,
        "waybill_number": wb.waybill_number,
        "order_id": wb.order_id,
        "delivery_status": (wb.delivery_status or "pending").lower(),
        "driver_name": (wb.driver_name or "").strip() or None,
        "driver_phone": (wb.driver_phone or "").strip() or None,
        "vehicle_plate": (wb.vehicle_plate or "").strip() or None,
        "customer_name": cust.name if cust else "—",
        "phone": cust.phone if cust else "—",
        "address": cust.address if cust else "—",
        "email": cust.email if cust else None,
        "items": items,
        "created_at": wb.created_at,
        "updated_at": wb.updated_at,
        "created_by": _user_label(db, wb.created_by),
        "updated_by": _user_label(db, wb.updated_by),
    }


def _render_waybill_html(db: Session, wb: models.Waybill) -> str:
    order = wb.order
    if not order:
        return "<p>Missing order</p>"
    cust = order.customer
    items = (
        db.query(models.OrderItem)
        .filter(models.OrderItem.order_id == order.id)
        .order_by(models.OrderItem.id.asc())
        .all()
    )
    rows = []
    for it in items:
        rows.append(
            f"""
            <tr>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e5e5;font-weight:600;color:#111;vertical-align:top;width:26%">{escape(it.item_name or '')}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e5e5;color:#111;vertical-align:top">{escape((it.description or '—'))}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e5e5;text-align:right;white-space:nowrap;vertical-align:top;width:1%">{escape(str(it.quantity if it.quantity is not None else '—'))}</td>
            </tr>
            """
        )
    rows_html = "\n".join(rows) if rows else "<tr><td colspan='3' style='padding:10px 12px;color:#666'>No items</td></tr>"

    logo_url = (os.getenv("INVOICE_LOGO_URL", "") or "").strip() or (os.getenv("PUBLIC_LOGO_URL", "") or "").strip()
    logo_html = (
        f"<img src='{escape(logo_url)}' alt='{escape(APP_NAME)} logo' style='width:160px;max-width:100%;object-fit:contain'/>"
        if logo_url
        else ""
    )
    status_label = (wb.delivery_status or "pending").strip().capitalize()
    issued = wb.created_at.strftime("%B %d, %Y") if wb.created_at else "—"
    cname = escape(cust.name if cust else "—")
    cphone = escape(cust.phone if cust else "—")
    caddr = escape(cust.address if cust else "—")
    cemail = escape(cust.email if cust and (cust.email or "").strip() else "—")

    dn = escape((wb.driver_name or "").strip() or "—")
    dp = escape((wb.driver_phone or "").strip() or "—")
    vp = escape((wb.vehicle_plate or "").strip() or "—")

    company_lines = "\n".join(f"<div>{escape(addr)}</div>" for addr in COMPANY_ADDRESSES)
    company_lines += (
        f'\n<div style="margin-top:2px;word-break:break-word">'
        f"{company_contact_line_html(escape)}</div>"
    )

    return f"""
    <div style="margin:0;padding:0;background:#f6f6f6">
      <div style="max-width:820px;margin:0 auto;padding:24px 16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111">
        <div style="background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:22px">
          <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:16px;border-bottom:1px solid #e5e5e5;padding-bottom:16px">
            <div style="text-align:center">
              {logo_html}
              <div style="margin-top:8px;font-weight:700;font-style:italic">{escape(APP_NAME)}</div>
            </div>
            <div style="text-align:right">
              <div style="display:inline-block;background:#111;color:#fff;padding:8px 14px;font-weight:800;letter-spacing:0.15em;font-size:11px">WAYBILL</div>
              <div style="margin-top:10px;font-size:14px"><span style="color:#666">Number:</span> <strong>#{escape(wb.waybill_number)}</strong></div>
              <div style="margin-top:6px;font-size:14px"><span style="color:#666">Date:</span> <strong>{escape(issued)}</strong></div>
              <div style="margin-top:6px;font-size:14px"><span style="color:#666">Delivery:</span> <strong>{escape(status_label)}</strong></div>
            </div>
          </div>

          <div style="margin-top:18px;display:grid;grid-template-columns:1fr 1fr;gap:16px;font-size:14px;align-items:start">
            <div style="min-width:0">
              <div style="font-weight:800;margin-bottom:6px">Ship from</div>
              <div style="color:#333;line-height:1.4">{company_lines}</div>
            </div>
            <div style="min-width:0;padding-left:12px;box-sizing:border-box">
              <div style="font-weight:800;margin-bottom:6px">Ship to</div>
              <div style="color:#333;line-height:1.4">
                <div style="font-weight:700">{cname}</div>
                <div>{caddr}</div>
                <div>{cphone}</div>
                <div>{cemail}</div>
              </div>
            </div>
          </div>

          <div style="margin-top:16px;padding:12px;background:#fafafa;border:1px solid #e5e5e5;border-radius:8px;font-size:14px">
            <div style="font-weight:800;margin-bottom:8px;color:#111">Driver &amp; vehicle</div>
            <div style="color:#333;line-height:1.5">
              <div><span style="color:#666">Driver name:</span> <strong>{dn}</strong></div>
              <div><span style="color:#666">Driver phone:</span> <strong>{dp}</strong></div>
              <div><span style="color:#666">Vehicle plate:</span> <strong>{vp}</strong></div>
            </div>
          </div>

          <div style="margin-top:20px">
            <div style="font-weight:800;margin-bottom:8px">Items</div>
            <table style="width:100%;border-collapse:collapse;font-size:14px;table-layout:fixed">
              <thead>
                <tr style="background:#f3f3f3">
                  <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e5e5e5;width:26%">Item</th>
                  <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e5e5e5">Description</th>
                  <th style="text-align:right;padding:10px 12px;border-bottom:1px solid #e5e5e5;width:10%;white-space:nowrap">Qty</th>
                </tr>
              </thead>
              <tbody>{rows_html}</tbody>
            </table>
          </div>

          <div style="margin-top:18px;padding-top:14px;border-top:1px solid #e5e5e5;font-size:13px;color:#444">
            <div style="font-weight:800;color:#111">Note</div>
            <div style="margin-top:6px">This waybill documents goods for delivery. It is not a tax invoice.</div>
          </div>
        </div>
      </div>
    </div>
    """


def _paginate_params(limit: int | None, offset: int | None) -> tuple[int, int]:
    lim = max(1, min(int(limit or 20), 100))
    off = max(0, int(offset or 0))
    return lim, off


@router.get("/waybills")
def list_waybills(
    limit: int = 20,
    offset: int = 0,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin", "showroom"])),
):
    lim, off = _paginate_params(limit, offset)
    total = db.query(func.count(models.Waybill.id)).scalar() or 0
    q = db.query(models.Waybill).options(joinedload(models.Waybill.order).joinedload(models.Order.customer))
    rows = q.order_by(models.Waybill.id.desc()).offset(off).limit(lim).all()
    out = []
    for wb in rows:
        cust_name = "—"
        if wb.order and wb.order.customer:
            cust_name = wb.order.customer.name or "—"
        out.append(
            {
                "id": wb.id,
                "waybill_number": wb.waybill_number,
                "order_id": wb.order_id,
                "customer_name": cust_name,
                "delivery_status": (wb.delivery_status or "pending").lower(),
                "created_at": wb.created_at,
                "created_by": _user_label(db, wb.created_by),
            }
        )
    return {"items": out, "total": total}


@router.post("/waybills", status_code=201)
def create_waybill(
    payload: WaybillCreate,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin", "showroom"])),
):
    order = (
        db.query(models.Order)
        .options(joinedload(models.Order.customer))
        .filter(models.Order.id == payload.order_id)
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    wb = models.Waybill(
        waybill_number=next_waybill_number(db),
        order_id=order.id,
        delivery_status="pending",
        driver_name=payload.driver_name,
        driver_phone=payload.driver_phone,
        vehicle_plate=payload.vehicle_plate,
        created_by=user.id,
        updated_by=user.id,
        updated_at=datetime.utcnow(),
    )
    db.add(wb)
    db.flush()
    log_activity(
        db,
        action=WAYBILL_CREATED,
        entity_type="waybill",
        entity_id=wb.id,
        actor_user=user,
        meta={"waybill_number": wb.waybill_number, "order_id": order.id},
    )
    db.commit()
    wb = (
        db.query(models.Waybill)
        .options(joinedload(models.Waybill.order).joinedload(models.Order.customer))
        .filter(models.Waybill.id == wb.id)
        .first()
    )
    return _waybill_to_detail(db, wb)


@router.patch("/waybills/{waybill_id}/logistics")
def update_waybill_logistics(
    waybill_id: int,
    payload: WaybillLogisticsUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin", "showroom"])),
):
    wb = db.query(models.Waybill).filter(models.Waybill.id == waybill_id).first()
    if not wb:
        raise HTTPException(status_code=404, detail="Waybill not found")
    wb.driver_name = payload.driver_name
    wb.driver_phone = payload.driver_phone
    wb.vehicle_plate = payload.vehicle_plate
    wb.updated_by = user.id
    wb.updated_at = datetime.utcnow()
    db.commit()
    wb = (
        db.query(models.Waybill)
        .options(joinedload(models.Waybill.order).joinedload(models.Order.customer))
        .filter(models.Waybill.id == waybill_id)
        .first()
    )
    return _waybill_to_detail(db, wb)


@router.get("/waybills/{waybill_id}")
def get_waybill(
    waybill_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_waybill_reader),
):
    wb = (
        db.query(models.Waybill)
        .options(joinedload(models.Waybill.order).joinedload(models.Order.customer))
        .filter(models.Waybill.id == waybill_id)
        .first()
    )
    if not wb:
        raise HTTPException(status_code=404, detail="Waybill not found")
    return _waybill_to_detail(db, wb)


@router.post("/waybills/{waybill_id}/record-view")
def record_waybill_view(
    waybill_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin", "showroom"])),
):
    wb = db.query(models.Waybill).filter(models.Waybill.id == waybill_id).first()
    if not wb:
        raise HTTPException(status_code=404, detail="Waybill not found")
    log_activity(
        db,
        action=WAYBILL_VIEWED,
        entity_type="waybill",
        entity_id=wb.id,
        actor_user=user,
        meta={"waybill_number": wb.waybill_number},
    )
    db.commit()
    return {"message": "Recorded"}


@router.patch("/waybills/{waybill_id}/status")
def update_waybill_status(
    waybill_id: int,
    payload: WaybillStatusUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin", "showroom"])),
):
    wb = db.query(models.Waybill).filter(models.Waybill.id == waybill_id).first()
    if not wb:
        raise HTTPException(status_code=404, detail="Waybill not found")
    new_s = payload.delivery_status.strip().lower()
    if new_s not in ALLOWED_STATUS:
        raise HTTPException(status_code=422, detail="Invalid delivery status")
    old_s = (wb.delivery_status or "pending").lower()
    wb.delivery_status = new_s
    wb.updated_by = user.id
    wb.updated_at = datetime.utcnow()
    log_activity(
        db,
        action=WAYBILL_STATUS_UPDATED,
        entity_type="waybill",
        entity_id=wb.id,
        actor_user=user,
        meta={"waybill_number": wb.waybill_number, "from": old_s, "to": new_s},
    )
    db.commit()
    wb = (
        db.query(models.Waybill)
        .options(joinedload(models.Waybill.order).joinedload(models.Order.customer))
        .filter(models.Waybill.id == waybill_id)
        .first()
    )
    return _waybill_to_detail(db, wb)


@router.post("/waybills/{waybill_id}/send-email")
def send_waybill_email(
    waybill_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin", "showroom"])),
):
    wb = (
        db.query(models.Waybill)
        .options(joinedload(models.Waybill.order).joinedload(models.Order.customer))
        .filter(models.Waybill.id == waybill_id)
        .first()
    )
    if not wb:
        raise HTTPException(status_code=404, detail="Waybill not found")
    if not _waybill_driver_ready(wb):
        raise HTTPException(status_code=400, detail=WAYBILL_LOGISTICS_REQUIRED)
    cust = wb.order.customer if wb.order else None
    if not cust or not (cust.email or "").strip():
        raise HTTPException(status_code=400, detail="Customer has no email on file")

    to_email = cust.email.strip()
    subject = f"{APP_NAME} - Waybill {wb.waybill_number}"
    html = _render_waybill_html(db, wb)
    try:
        pdf_bytes = document_pdf_bytes_via_ui("waybill", "waybill", wb.id)
        safe_n = re.sub(r"[^\w.\-]+", "_", wb.waybill_number or "waybill")
        send_email_html_with_pdf_attachment(
            to_email,
            subject,
            html,
            pdf_bytes,
            f"waybill-{safe_n}.pdf",
        )
    except EmailConfigError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    except smtplib.SMTPAuthenticationError as e:
        logger.exception("SMTP auth failed for waybill email")
        raise HTTPException(status_code=502, detail="SMTP authentication failed") from e
    except (smtplib.SMTPConnectError, smtplib.SMTPServerDisconnected, TimeoutError) as e:
        logger.exception("SMTP connection failed for waybill email")
        raise HTTPException(status_code=502, detail="SMTP connection failed") from e
    except smtplib.SMTPException as e:
        logger.exception("SMTP error for waybill email")
        raise HTTPException(status_code=502, detail="SMTP error") from e
    except Exception as e:
        logger.exception("Failed to send waybill email")
        raise HTTPException(status_code=502, detail="Failed to send email") from e

    log_activity(
        db,
        action=WAYBILL_SENT,
        entity_type="waybill",
        entity_id=wb.id,
        actor_user=user,
        meta={"waybill_number": wb.waybill_number, "to": to_email},
    )
    db.commit()
    return {"message": "Waybill sent"}


@router.post("/waybills/{waybill_id}/print")
def record_waybill_print(
    waybill_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin", "showroom"])),
):
    wb = db.query(models.Waybill).filter(models.Waybill.id == waybill_id).first()
    if not wb:
        raise HTTPException(status_code=404, detail="Waybill not found")
    if not _waybill_driver_ready(wb):
        raise HTTPException(status_code=400, detail=WAYBILL_LOGISTICS_REQUIRED)
    log_activity(
        db,
        action=WAYBILL_PRINTED,
        entity_type="waybill",
        entity_id=wb.id,
        actor_user=user,
        meta={"waybill_number": wb.waybill_number},
    )
    db.commit()
    return {"message": "Recorded"}


@router.post("/waybills/{waybill_id}/download")
def download_waybill(
    waybill_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin", "showroom"])),
):
    wb = (
        db.query(models.Waybill)
        .options(joinedload(models.Waybill.order))
        .filter(models.Waybill.id == waybill_id)
        .first()
    )
    if not wb:
        raise HTTPException(status_code=404, detail="Waybill not found")
    if not _waybill_driver_ready(wb):
        raise HTTPException(status_code=400, detail=WAYBILL_LOGISTICS_REQUIRED)

    html = _render_waybill_html(db, wb)
    log_activity(
        db,
        action=WAYBILL_DOWNLOADED,
        entity_type="waybill",
        entity_id=wb.id,
        actor_user=user,
        meta={"waybill_number": wb.waybill_number},
    )
    db.commit()

    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", f"waybill-{wb.waybill_number}.html")
    return Response(
        content=html.encode("utf-8"),
        media_type="text/html; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )


@router.delete("/waybills/{waybill_id}")
def delete_waybill(
    waybill_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin"])),
):
    wb = db.query(models.Waybill).filter(models.Waybill.id == waybill_id).first()
    if not wb:
        raise HTTPException(status_code=404, detail="Waybill not found")
    meta_num = wb.waybill_number
    wid = wb.id
    log_activity(
        db,
        action=WAYBILL_DELETED,
        entity_type="waybill",
        entity_id=wid,
        actor_user=user,
        meta={"waybill_number": meta_num},
    )
    db.delete(wb)
    db.commit()
    return {"message": "Waybill deleted"}
