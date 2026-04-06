from decimal import Decimal
import json
import logging
import os
import re
import smtplib
from html import escape

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session, joinedload
from app.database import get_db
from app import models
from app.auth.auth import get_current_user, is_factory_user, normalize_role, require_role
from app.db.alive import customer_alive, order_alive
from app.auth.pdf_access import require_order_reader
from datetime import datetime, timedelta
from app.schemas import (
    OrderAdminPut,
    OrderAlertItem,
    OrderCreate,
    OrderDetailsResponse,
    OrderItemCreate,
    OrderPricingUpdate,
    OrderResponse,
    OrdersAlertsResponse,
    OrdersListResponse,
    OrderStatus,
    OrderUploadResponse,
)
from fastapi import Query
from typing import List, Optional
from app.constants import APP_NAME, COMPANY_ADDRESSES, company_contact_line_html, company_payment_details_html
from app.utils.cloudinary import upload_image
from app.utils.emailer import EmailConfigError, send_email_html_with_pdf_attachment
from app.utils.pdf_job import document_pdf_bytes_via_ui
from app.utils.pricing import compute_discount, compute_pricing, compute_totals
from pydantic import EmailStr, TypeAdapter, ValidationError
from app.utils.invoices import create_invoice_for_order, sync_invoice_from_order
from app.utils.order_item_amounts import compute_subtotal, display_unit_amounts
from app.utils.activity_log import (
    log_activity,
    username_from_email,
    ORDER_CREATED,
    ORDER_UPDATED,
    ORDER_UPDATED_BEFORE_INVOICE,
    ORDER_PRICING_UPDATED,
    ORDER_DELETED,
    ORDER_STATUS_UPDATED,
    ORDER_MARKED_PAID,
    ORDER_EMAIL_SENT,
    ORDER_DOWNLOADED,
    INVOICE_GENERATED,
)
from types import SimpleNamespace

router = APIRouter()
logger = logging.getLogger(__name__)

TWOPLACES = Decimal("0.01")


def _soft_delete_order_bundle(db: Session, order: models.Order, user) -> None:
    now = datetime.utcnow()
    order.deleted_at = now
    order.deleted_by_id = user.id
    inv = db.query(models.Invoice).filter(models.Invoice.order_id == order.id).first()
    if inv:
        inv.deleted_at = now
        inv.deleted_by_id = user.id


def _parse_optional_email(raw: Optional[str]) -> Optional[str]:
    s = (raw or "").strip()
    if not s:
        return None
    try:
        return str(TypeAdapter(EmailStr).validate_python(s))
    except ValidationError as e:
        raise HTTPException(status_code=422, detail="Invalid email format") from e


def _build_order_response(
    db: Session, order: models.Order, customer: models.Customer, items: list[models.OrderItem], user
) -> dict:
    subtotal_from_items = compute_subtotal(items)
    effective_total_price = order.total_price if order.total_price is not None else subtotal_from_items
    units = display_unit_amounts(SimpleNamespace(total_price=effective_total_price), items)
    factory = is_factory_user(user)
    item_rows: list[dict] = []
    for i, it in enumerate(items):
        row = {
            "id": it.id,
            "item_name": it.item_name,
            "description": it.description,
            "quantity": it.quantity,
        }
        if not factory:
            row["amount"] = units[i] if i < len(units) else it.amount
        item_rows.append(row)

    cust_payload = None
    if not factory and customer is not None:
        cust_payload = {
            "id": customer.id,
            "name": customer.name,
            "phone": customer.phone,
            "address": customer.address,
            "email": customer.email,
        }

    base: dict = {
        "id": order.id,
        "status": order.status,
        "due_date": order.due_date,
        "created_at": order.created_at,
        "image_url": order.image_url,
        "customer": cust_payload,
        "items": item_rows,
    }

    if user.role in ("admin", "showroom"):
        total = None
        if order.final_price is not None or order.total_price is not None:
            base_price = order.final_price if order.final_price is not None else order.total_price
            if base_price is not None:
                total = (base_price or Decimal("0")) + (order.tax or Decimal("0"))
        # If total_price is missing but line pricing exists, surface computed subtotal
        base_price_for_total = (
            order.final_price
            if order.final_price is not None
            else (effective_total_price if effective_total_price is not None else order.total_price)
        )
        total = None
        if base_price_for_total is not None:
            total = (base_price_for_total or Decimal("0")) + (order.tax or Decimal("0"))

        base.update(
            {
                "total_price": effective_total_price,
                "discount_type": order.discount_type,
                "discount_value": order.discount_value,
                "discount_amount": order.discount_amount,
                "final_price": order.final_price,
                "tax_percent": order.tax_percent,
                "tax": order.tax,
                "total": total,
                "amount_paid": order.amount_paid,
                "balance": order.balance,
                "payment_status": order.payment_status,
            }
        )

        # Admin-only: show who performed actions
        if user.role == "admin":
            created_by_username = None
            updated_by_username = None
            if order.created_by:
                actor = db.query(models.User).filter(models.User.id == order.created_by).first()
                created_by_username = (actor.email or "").split("@")[0] if actor and actor.email else None
            if order.updated_by:
                actor2 = db.query(models.User).filter(models.User.id == order.updated_by).first()
                updated_by_username = (actor2.email or "").split("@")[0] if actor2 and actor2.email else None
            base["created_by"] = created_by_username
            base["updated_by"] = updated_by_username
        base["created_by_id"] = order.created_by

    return base


def _items_subtotal(items: list[OrderItemCreate]) -> Decimal | None:
    """
    Returns subtotal computed from items when every item has an amount.
    If any item is missing amount, returns None to preserve backwards compatibility.
    """
    if not items:
        return None
    for it in items:
        if getattr(it, "amount", None) is None:
            return None
    subtotal = Decimal("0")
    for it in items:
        subtotal += (Decimal(str(it.amount)) * Decimal(int(it.quantity)))
    return subtotal.quantize(TWOPLACES)


def _doc_money(v: object) -> str:
    if v is None or v == "":
        return "—"
    try:
        return f"{Decimal(str(v)).quantize(TWOPLACES):,}"
    except Exception:
        return escape(str(v))


def _render_order_document_html(
    order: models.Order,
    customer: models.Customer,
    items: list[models.OrderItem],
) -> str:
    due = order.due_date.strftime("%B %d, %Y") if order.due_date else "—"
    issued = order.created_at.strftime("%B %d, %Y") if order.created_at else "—"
    discount_amount = order.discount_amount
    original_total = order.total_price
    final_price = order.final_price
    tax = order.tax
    tax_percent = order.tax_percent
    tax_row_label = f"Tax ({escape(str(tax_percent))}%):" if tax_percent is not None else "Tax:"
    base_price = final_price if final_price is not None else original_total
    total = None
    if base_price is not None:
        total = (base_price or Decimal("0")) + (tax or Decimal("0"))

    logo_url = (os.getenv("INVOICE_LOGO_URL", "") or "").strip() or (os.getenv("PUBLIC_LOGO_URL", "") or "").strip()
    logo_html = (
        f"<img src='{escape(logo_url)}' alt='{escape(APP_NAME)} logo' style='width:160px;height:160px;max-width:100%;object-fit:contain;object-position:left top'/>"
        if logo_url
        else ""
    )

    units = display_unit_amounts(order, items)
    rows = []
    for i, it in enumerate(items):
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
              <td style="padding:10px 12px;border-bottom:1px solid #e5e5e5;color:#111">{escape((it.description or '—'))}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e5e5;text-align:right;color:#111">{escape(str(it.quantity if it.quantity is not None else '—'))}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e5e5;text-align:right;color:#111">{escape(_doc_money(unit))}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e5e5;text-align:right;color:#111">{escape(_doc_money(line_total))}</td>
            </tr>
            """
        )
    rows_html = "\n".join(rows) if rows else "<tr><td colspan='5' style='padding:10px 12px;color:#666'>No items</td></tr>"

    discount_display = _doc_money(discount_amount if discount_amount is not None else Decimal("0.00"))
    tax_display = _doc_money(tax if tax is not None else Decimal("0.00"))

    company_lines = "\n".join(f"<div>{escape(addr)}</div>" for addr in COMPANY_ADDRESSES)
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
                <div style="display:inline-block;background:#111;color:#fff;padding:10px 14px;font-weight:800;letter-spacing:0.28em">ORDER</div>
                <div style="margin-top:10px;font-size:13px;color:#111">
                  <div><span style="color:#666">Order ID:</span> <strong>#{escape(str(order.id))}</strong></div>
                  <div style="margin-top:4px"><span style="color:#666">Date:</span> <strong>{escape(issued)}</strong></div>
                </div>
              </div>
            </div>
          </div>

          <div style="padding:18px 22px;font-family:Inter,Arial,sans-serif">
            <div style="display:flex;gap:24px;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #e5e5e5;padding-bottom:12px">
              <div style="flex:1;min-width:0">
                <div style="font-weight:800;color:#111">From:</div>
                <div style="margin-top:6px;color:#333;font-size:13px;line-height:1.4">
                  <div><strong>{escape(APP_NAME)}</strong></div>
                  {company_lines}
                </div>
              </div>
              <div style="flex:1;min-width:0;padding-left:20px;box-sizing:border-box">
                <div style="font-weight:800;color:#111">Customer:</div>
                <div style="margin-top:6px;color:#333;font-size:13px;line-height:1.4">
                  <div><strong>{escape(customer.name or '')}</strong></div>
                  <div>{escape(customer.address or '—')}</div>
                  <div>{escape(customer.phone or '—')}</div>
                  <div>{escape(customer.email or '—')}</div>
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
                  <div style="font-weight:800;color:#111">{_doc_money(original_total)}</div>
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
                  <div style="font-weight:800;color:#111">{_doc_money(order.amount_paid)}</div>
                </div>
                <div style="display:flex;justify-content:space-between;padding:6px 0">
                  <div style="color:#444">Balance:</div>
                  <div style="font-weight:800;color:#111">{_doc_money(order.balance)}</div>
                </div>
                <div style="margin-top:10px;background:#111;color:#fff;padding:10px 14px;display:flex;justify-content:space-between;align-items:center">
                  <div style="font-size:16px;font-weight:900">Total</div>
                  <div style="font-size:16px;font-weight:900">{_doc_money(total)}</div>
                </div>
              </div>
            </div>

            <div style="margin-top:14px;font-size:13px;color:#111">
              <span style="color:#666">Due date:</span> <strong>{escape(due)}</strong>
            </div>

            <div style="margin-top:16px;border-top:1px solid #e5e5e5;padding-top:10px">
              <div style="font-weight:800;color:#111">Note:</div>
              <div style="margin-top:6px;color:#333">This document summarizes your order. For tax invoice, refer to your invoice from {escape(APP_NAME)}.</div>
            </div>
            {company_payment_details_html(escape)}
          </div>
        </div>
      </div>
    </div>
    """


@router.post("/orders", response_model=OrderResponse, response_model_exclude_none=True)
def create_order(
    # Customer must always be provided (new customer)
    customer_name: Optional[str] = Form(None),
    customer_phone: Optional[str] = Form(None),
    customer_address: Optional[str] = Form(None),
    customer_email: Optional[str] = Form(None),

    # Items (list of {item_name, description, quantity})
    items_json: Optional[str] = Form(None),
    due_date: datetime | None = Form(None),
    image: UploadFile | None = File(None),
    total_price: Decimal | None = Form(None),
    amount_paid: Decimal | None = Form(None),
    discount_type: Optional[str] = Form(None),
    discount_value: Decimal | None = Form(None),
    tax: Decimal | None = Form(None),
    db: Session = Depends(get_db),
    user=Depends(require_role(["showroom", "admin"])),
):
    # 1) Parse items
    items_payload: list[OrderItemCreate] = []

    if not items_json:
        raise HTTPException(status_code=422, detail="Invalid request format")

    try:
        raw = json.loads(items_json)
    except json.JSONDecodeError:
        raise HTTPException(status_code=422, detail="Invalid request format")

    try:
        items_payload = TypeAdapter(List[OrderItemCreate]).validate_python(raw)
    except ValidationError:
        raise HTTPException(status_code=422, detail="Invalid request format")

    if not items_payload:
        raise HTTPException(status_code=422, detail="Items required")

    # 2) Validate customer (always new)
    name = (customer_name or "").strip()
    phone = (customer_phone or "").strip()
    address = (customer_address or "").strip()

    if not name or not phone or not address:
        raise HTTPException(status_code=422, detail="Customer info missing")

    email_val = _parse_optional_email(customer_email)

    # 3) Upload image (optional) before DB writes
    image_url = None
    if image is not None:
        image_url = upload_image(image)

    # 4) Pricing + discount + tax
    computed_subtotal = _items_subtotal(items_payload)
    subtotal_in = computed_subtotal if computed_subtotal is not None else total_price
    totals = compute_totals(subtotal_in, amount_paid, discount_type, discount_value, tax)
    original_total = totals.subtotal

    # 5) Transactional create (customer + order + items)
    try:
        # Session may already be inside a transaction (SQLAlchemy autobegin, or upstream usage).
        # Use a nested transaction in that case to avoid InvalidRequestError.
        had_outer_tx = db.in_transaction()
        tx = db.begin_nested() if had_outer_tx else db.begin()
        with tx:
            existing = (
                db.query(models.Customer)
                .filter(models.Customer.phone == phone)
                .filter(customer_alive())
                .first()
            )
            if existing:
                customer = existing
                if email_val and not (existing.email or "").strip():
                    existing.email = email_val
            else:
                customer = models.Customer(
                    name=name,
                    phone=phone,
                    address=address,
                    email=email_val,
                    creator_id=user.id,
                )
                db.add(customer)
            db.flush()  # get customer.id

            new_order = models.Order(
                customer_id=customer.id,
                due_date=due_date,
                created_by=user.id,
                image_url=image_url,
                total_price=original_total,
                discount_type=totals.discount_type,
                discount_value=totals.discount_value,
                discount_amount=totals.discount_amount,
                final_price=totals.after_discount if totals.after_discount is not None else original_total,
                tax_percent=totals.tax_percent,
                tax=totals.tax,
                amount_paid=totals.paid,
                balance=totals.balance,
                payment_status=totals.payment_status,
            )
            db.add(new_order)
            db.flush()  # get new_order.id

            created_items: list[models.OrderItem] = []
            for it in items_payload:
                oi = models.OrderItem(
                    order_id=new_order.id,
                    item_name=it.item_name,
                    description=it.description,
                    quantity=it.quantity,
                    amount=it.amount,
                )
                db.add(oi)
                created_items.append(oi)
            db.flush()
            inv = create_invoice_for_order(db, new_order, customer.id)
            log_activity(
                db,
                action=ORDER_CREATED,
                entity_type="order",
                entity_id=new_order.id,
                actor_user=user,
            )
            db.flush()
            log_activity(
                db,
                action=INVOICE_GENERATED,
                entity_type="invoice",
                entity_id=inv.id,
                actor_user=user,
                meta={"order_id": new_order.id},
            )
        # If we entered with an already-open transaction, begin_nested() only releases a SAVEPOINT.
        # We must commit the outer transaction, otherwise the session will roll back on close and
        # the newly created records won't be visible to subsequent requests.
        if had_outer_tx:
            db.commit()
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to create order")
        # Return a concise error for debugging; remove/normalize in production if needed.
        raise HTTPException(status_code=500, detail=f"Failed to create order: {type(e).__name__}: {e}") from e

    # 6) Build full response (customer + items)
    # Avoid extra round-trips; ids are available after flush.
    return _build_order_response(db, new_order, customer, created_items, user)


# Legacy JSON endpoint (kept for backward compatibility)
@router.post("/orders/json", response_model=OrderResponse, response_model_exclude_none=True)
def create_order_json(
    order: OrderCreate,
    db: Session = Depends(get_db),
    user=Depends(require_role(["showroom", "admin"])),
):
    if not order.items:
        raise HTTPException(status_code=400, detail="Order must have at least one item")

    phone = order.customer.phone.strip()
    email_val = order.customer.email
    if email_val is not None:
        email_val = str(email_val).strip() or None

    existing = (
        db.query(models.Customer)
        .filter(models.Customer.phone == phone)
        .filter(customer_alive())
        .first()
    )
    if existing:
        new_customer = existing
        if email_val and not (existing.email or "").strip():
            existing.email = email_val
    else:
        new_customer = models.Customer(
            name=order.customer.name,
            phone=phone,
            address=order.customer.address,
            email=email_val,
            creator_id=user.id,
        )
        db.add(new_customer)
    db.flush()

    computed_subtotal = _items_subtotal(order.items)
    subtotal_in = computed_subtotal if computed_subtotal is not None else None
    # Legacy JSON create didn't accept pricing; keep existing behavior unless amounts are provided.
    totals = compute_totals(subtotal_in, None, None, None, None)

    new_order = models.Order(
        customer_id=new_customer.id,
        due_date=order.due_date,
        created_by=user.id,
        total_price=totals.subtotal,
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

    items = []
    for item in order.items:
        order_item = models.OrderItem(
            order_id=new_order.id,
            item_name=item.item_name,
            description=item.description,
            quantity=item.quantity,
            amount=getattr(item, "amount", None),
        )
        db.add(order_item)
        items.append(order_item)
    db.flush()
    inv = create_invoice_for_order(db, new_order, new_customer.id)
    log_activity(
        db,
        action=ORDER_CREATED,
        entity_type="order",
        entity_id=new_order.id,
        actor_user=user,
    )
    db.flush()
    log_activity(
        db,
        action=INVOICE_GENERATED,
        entity_type="invoice",
        entity_id=inv.id,
        actor_user=user,
        meta={"order_id": new_order.id},
    )
    db.commit()
    for oi in items:
        db.refresh(oi)
    db.refresh(new_order)
    new_order.items = items
    return _build_order_response(db, new_order, new_customer, items, user)
    

@router.get("/orders", response_model=OrdersListResponse, response_model_exclude_none=True)
def get_orders(
    db: Session = Depends(get_db),
    user = Depends(get_current_user),
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=50),
):
    q = (
        db.query(models.Order)
        .options(joinedload(models.Order.items), joinedload(models.Order.customer))
        .join(models.Customer, models.Order.customer_id == models.Customer.id)
        .filter(order_alive())
    )

    if status:
        allowed = {"pending", "in_progress", "completed"}
        if status not in allowed:
            raise HTTPException(status_code=400, detail="Invalid status value")
        q = q.filter(models.Order.status == status)

    if search:
        s = f"%{search.strip()}%"
        q = q.filter(
            (models.Customer.name.ilike(s)) | (models.Customer.phone.ilike(s))
        )

    total = q.count()
    total_pages = max(1, (total + limit - 1) // limit)

    offset = (page - 1) * limit
    rows = (
        q.order_by(models.Order.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    data: list[dict] = []
    for order in rows:
        customer = order.customer
        base = {
            "id": order.id,
            "status": order.status,
            "due_date": order.due_date,
            "created_at": order.created_at,
            "image_url": order.image_url,
            "customer": None
            if user.role == "factory"
            else {
                "id": customer.id,
                "name": customer.name,
                "phone": customer.phone,
                "address": customer.address,
                "email": customer.email,
            },
            "items": [
                {
                    "id": item.id,
                    "item_name": item.item_name,
                    "description": item.description,
                    "quantity": item.quantity,
                }
                for item in (order.items or [])
            ],
        }

        if user.role in ("admin", "showroom"):
            base.update(
                {
                    "total_price": order.total_price,
                    "discount_type": order.discount_type,
                    "discount_value": order.discount_value,
                    "discount_amount": order.discount_amount,
                    "final_price": order.final_price,
                    "amount_paid": order.amount_paid,
                    "balance": order.balance,
                    "payment_status": order.payment_status,
                    "created_by_id": order.created_by,
                }
            )

        data.append(base)

    return {"data": data, "total": total, "page": page, "total_pages": total_pages}


@router.get("/orders/alerts", response_model=OrdersAlertsResponse)
def get_orders_alerts(
    db: Session = Depends(get_db),
    user = Depends(get_current_user),
):
    today = datetime.utcnow()
    upcoming = today + timedelta(days=14)
    q = (
        db.query(models.Order)
        .options(joinedload(models.Order.customer))
        .filter(order_alive())
        .filter(models.Order.due_date.isnot(None))
        .filter(models.Order.due_date <= upcoming)
        .filter(models.Order.status != "completed")
        .order_by(models.Order.due_date.asc())
    )

    due_soon_count = q.count()
    rows = q.limit(20).all()

    orders: list[dict] = []
    for o in rows:
        orders.append(
            {
                "order_id": o.id,
                "status": o.status,
                "due_date": o.due_date,
                "customer": None
                if user.role == "factory"
                else {"name": o.customer.name if o.customer else None},
            }
        )

    return {"due_soon_count": due_soon_count, "orders": orders}


@router.get("/orders/reminders")
def get_reminders(
    db: Session = Depends(get_db),
    user = Depends(get_current_user)
):
    today = datetime.utcnow()
    upcoming = today + timedelta(days=14)

    #  Role-based filtering
    if user.role == "showroom":
        orders = (
            db.query(models.Order)
            .filter(order_alive())
            .filter(
                models.Order.created_by == user.id,
                models.Order.due_date <= upcoming,
                models.Order.due_date >= today,
            )
            .all()
        )
    else:
        # factory + admin
        orders = (
            db.query(models.Order)
            .filter(order_alive())
            .filter(
                models.Order.due_date <= upcoming,
                models.Order.due_date >= today,
            )
            .all()
        )

    result = []

    for order in orders:
        result.append({
            "id": order.id,
            "due_date": order.due_date,
            "status": order.status,
            "days_remaining": (order.due_date - today).days
        })

    return result


@router.get("/orders/{order_id}", response_model=OrderDetailsResponse, response_model_exclude_none=True)
def get_order(
    order_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_order_reader),
):
    order = db.query(models.Order).filter(models.Order.id == order_id).filter(order_alive()).first()

    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    items = db.query(models.OrderItem).filter(
        models.OrderItem.order_id == order.id
    ).all()
    customer = db.query(models.Customer).filter(
    models.Customer.id == order.customer_id
    ).first()

    units = display_unit_amounts(order, items)
    subtotal_from_items = compute_subtotal(items)
    effective_total_price = order.total_price if order.total_price is not None else subtotal_from_items
    units = display_unit_amounts(SimpleNamespace(total_price=effective_total_price), items)
    factory = is_factory_user(user)

    item_rows: list[dict] = []
    for i, item in enumerate(items):
        row = {
            "id": item.id,
            "item_name": item.item_name,
            "description": item.description,
            "quantity": item.quantity,
        }
        if not factory:
            row["amount"] = units[i] if i < len(units) else item.amount
        item_rows.append(row)

    cust_payload = None
    if not factory and customer is not None:
        cust_payload = {
            "id": customer.id,
            "name": customer.name,
            "phone": customer.phone,
            "address": customer.address,
            "email": customer.email,
        }

    base = {
        "order_id": order.id,
        "status": order.status,
        "due_date": order.due_date,
        "image_url": order.image_url,
        "customer": cust_payload,
        "items": item_rows,
    }

    if user.role in ("admin", "showroom"):
        created_by_username = None
        updated_by_username = None
        if getattr(user, "role", None) == "admin":
            if order.created_by:
                u1 = db.query(models.User).filter(models.User.id == order.created_by).first()
                created_by_username = (u1.email or "").split("@")[0] if u1 and u1.email else None
            if order.updated_by:
                u2 = db.query(models.User).filter(models.User.id == order.updated_by).first()
                updated_by_username = (u2.email or "").split("@")[0] if u2 and u2.email else None
        base_price_for_total = order.final_price if order.final_price is not None else effective_total_price
        total = None
        if base_price_for_total is not None:
            total = (base_price_for_total or Decimal("0")) + (order.tax or Decimal("0"))

        base.update(
            {
                "total_price": effective_total_price,
                "discount_type": order.discount_type,
                "discount_value": order.discount_value,
                "discount_amount": order.discount_amount,
                "final_price": order.final_price,
                "tax_percent": order.tax_percent,
                "tax": order.tax,
                "total": total,
                "amount_paid": order.amount_paid,
                "balance": order.balance,
                "payment_status": order.payment_status,
                "created_by": created_by_username,
                "updated_by": updated_by_username,
            }
        )
        inv_row = (
            db.query(models.Invoice.id)
            .filter(models.Invoice.order_id == order.id)
            .filter(models.Invoice.deleted_at.is_(None))
            .first()
        )
        if inv_row:
            base["invoice_id"] = inv_row[0]

    return base

@router.put("/orders/{order_id}", response_model=OrderDetailsResponse, response_model_exclude_none=True)
def put_order_admin(
    order_id: int,
    payload: OrderAdminPut,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin", "showroom"])),
):
    order = db.query(models.Order).filter(models.Order.id == order_id).filter(order_alive()).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    computed_subtotal = _items_subtotal(payload.items)
    tp = payload.total_price if payload.total_price is not None else (computed_subtotal if computed_subtotal is not None else order.total_price)
    ap = payload.amount_paid if payload.amount_paid is not None else order.amount_paid
    dt = payload.discount_type if payload.discount_type is not None else order.discount_type
    dv = payload.discount_value if payload.discount_value is not None else order.discount_value
    tax_pct = payload.tax if payload.tax is not None else order.tax_percent

    totals = compute_totals(tp, ap, dt, dv, tax_pct)

    order.total_price = totals.subtotal
    order.discount_type = totals.discount_type
    order.discount_value = totals.discount_value
    order.discount_amount = totals.discount_amount
    order.final_price = totals.after_discount
    order.tax_percent = totals.tax_percent
    order.tax = totals.tax
    order.amount_paid = totals.paid
    order.balance = totals.balance
    order.payment_status = totals.payment_status
    order.status = payload.status.value
    order.due_date = payload.due_date
    order.updated_by = user.id
    order.updated_at = datetime.utcnow()

    old_items = (
        db.query(models.OrderItem)
        .filter(models.OrderItem.order_id == order_id)
        .order_by(models.OrderItem.id.asc())
        .all()
    )

    db.query(models.OrderItem).filter(models.OrderItem.order_id == order_id).delete()
    for idx, item in enumerate(payload.items):
        amt = getattr(item, "amount", None)
        if amt is None and idx < len(old_items):
            amt = old_items[idx].amount
        db.add(
            models.OrderItem(
                order_id=order_id,
                item_name=item.item_name,
                description=item.description,
                quantity=item.quantity,
                amount=amt,
            )
        )
    db.flush()
    sync_invoice_from_order(db, order)
    _upd_action = (
        ORDER_UPDATED_BEFORE_INVOICE
        if payload.update_context == "before_invoice"
        else ORDER_UPDATED
    )
    _upd_meta = (
        {"before_invoice_generation": True}
        if payload.update_context == "before_invoice"
        else None
    )
    log_activity(
        db,
        action=_upd_action,
        entity_type="order",
        entity_id=order.id,
        actor_user=user,
        meta=_upd_meta,
    )
    db.commit()

    items = (
        db.query(models.OrderItem).filter(models.OrderItem.order_id == order.id).all()
    )
    customer = (
        db.query(models.Customer).filter(models.Customer.id == order.customer_id).first()
    )

    units = display_unit_amounts(order, items)
    base = {
        "order_id": order.id,
        "status": order.status,
        "due_date": order.due_date,
        "image_url": order.image_url,
        "customer": None
        if user.role == "factory"
        else {
            "id": customer.id,
            "name": customer.name,
            "phone": customer.phone,
            "address": customer.address,
            "email": customer.email,
        },
        "items": [
            {
                "id": item.id,
                "item_name": item.item_name,
                "description": item.description,
                "quantity": item.quantity,
                "amount": units[i] if i < len(units) else item.amount,
            }
            for i, item in enumerate(items)
        ],
    }
    if user.role in ("admin", "showroom"):
        total = None
        if order.final_price is not None or order.total_price is not None:
            base_price = order.final_price if order.final_price is not None else order.total_price
            if base_price is not None:
                total = (base_price or Decimal("0")) + (order.tax or Decimal("0"))
        created_by_username = None
        updated_by_username = None
        if user.role == "admin":
            if order.created_by:
                u1 = db.query(models.User).filter(models.User.id == order.created_by).first()
                created_by_username = (u1.email or "").split("@")[0] if u1 and u1.email else None
            if order.updated_by:
                u2 = db.query(models.User).filter(models.User.id == order.updated_by).first()
                updated_by_username = (u2.email or "").split("@")[0] if u2 and u2.email else None
        base.update(
            {
                "total_price": order.total_price,
                "discount_type": order.discount_type,
                "discount_value": order.discount_value,
                "discount_amount": order.discount_amount,
                "final_price": order.final_price,
                "tax_percent": order.tax_percent,
                "tax": order.tax,
                "total": total,
                "amount_paid": order.amount_paid,
                "balance": order.balance,
                "payment_status": order.payment_status,
                "created_by": created_by_username,
                "updated_by": updated_by_username,
            }
        )
        inv_row = (
            db.query(models.Invoice.id)
            .filter(models.Invoice.order_id == order.id)
            .filter(models.Invoice.deleted_at.is_(None))
            .first()
        )
        if inv_row:
            base["invoice_id"] = inv_row[0]
    return base


@router.patch("/orders/{order_id}")
def update_order_pricing(
    order_id: int,
    payload: OrderPricingUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin", "showroom"])),
):
    order = db.query(models.Order).filter(models.Order.id == order_id).filter(order_alive()).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    tp = payload.total_price if payload.total_price is not None else order.total_price
    ap = payload.amount_paid if payload.amount_paid is not None else order.amount_paid
    tax_pct = payload.tax if payload.tax is not None else order.tax_percent
    totals = compute_totals(tp, ap, order.discount_type, order.discount_value, tax_pct)
    order.total_price = totals.subtotal
    order.final_price = totals.after_discount
    order.discount_amount = totals.discount_amount
    order.tax_percent = totals.tax_percent
    order.tax = totals.tax
    order.amount_paid = totals.paid
    order.balance = totals.balance
    order.payment_status = totals.payment_status
    order.updated_by = user.id
    order.updated_at = datetime.utcnow()
    sync_invoice_from_order(db, order)
    log_activity(
        db,
        action=ORDER_PRICING_UPDATED,
        entity_type="order",
        entity_id=order.id,
        actor_user=user,
    )
    db.commit()
    db.refresh(order)

    return {
        "id": order.id,
        "total_price": order.total_price,
        "amount_paid": order.amount_paid,
        "tax_percent": order.tax_percent,
        "tax": order.tax,
        "balance": order.balance,
        "payment_status": order.payment_status,
    }

@router.delete("/orders/{order_id}")
def delete_order(
    order_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin", "showroom"])),
):
    order = db.query(models.Order).filter(models.Order.id == order_id).filter(order_alive()).first()

    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if normalize_role(user.role) == "showroom" and order.created_by != user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    oid = order.id
    log_activity(
        db,
        action=ORDER_DELETED,
        entity_type="order",
        entity_id=oid,
        actor_user=user,
        meta={"soft_delete": True},
    )
    _soft_delete_order_bundle(db, order, user)
    db.commit()

    return {"message": "Order moved to Trash"}


@router.patch("/orders/{order_id}/status")
def update_order_status_patch(
    order_id: int,
    status: str = Form(...),
    db: Session = Depends(get_db),
    user=Depends(require_role(["factory", "admin"])),
):
    allowed = {"pending", "in_progress", "completed"}
    if status not in allowed:
        raise HTTPException(status_code=400, detail="Invalid status value")

    order = db.query(models.Order).filter(models.Order.id == order_id).filter(order_alive()).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    order.status = status
    order.updated_by = user.id
    order.updated_at = datetime.utcnow()
    log_activity(
        db,
        action=ORDER_STATUS_UPDATED,
        entity_type="order",
        entity_id=order.id,
        actor_user=user,
        meta={"status": status},
    )
    db.commit()
    return {"message": "Order status updated"}


@router.post("/orders/{order_id}/send-email")
def send_order_email(
    order_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin", "showroom"])),
):
    order = (
        db.query(models.Order)
        .options(joinedload(models.Order.customer))
        .filter(models.Order.id == order_id)
        .filter(order_alive())
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    cust = order.customer
    if not cust or not (cust.email or "").strip():
        raise HTTPException(status_code=400, detail="Customer has no email on file")

    items = (
        db.query(models.OrderItem)
        .filter(models.OrderItem.order_id == order.id)
        .order_by(models.OrderItem.id.asc())
        .all()
    )

    to_email = cust.email.strip()
    subject = f"{APP_NAME} - Order #{order.id}"
    html = _render_order_document_html(order, cust, items)
    try:
        pdf_bytes = document_pdf_bytes_via_ui("order", "order", order.id)
    except Exception as e:
        logger.exception("PDF generation failed for order email")
        raise HTTPException(status_code=500, detail="Could not generate PDF attachment") from e
    try:
        send_email_html_with_pdf_attachment(
            to_email,
            subject,
            html,
            pdf_bytes,
            f"order-{order.id}.pdf",
        )
    except EmailConfigError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    except smtplib.SMTPAuthenticationError as e:
        logger.exception("SMTP auth failed for order email")
        raise HTTPException(status_code=502, detail="SMTP authentication failed") from e
    except (smtplib.SMTPConnectError, smtplib.SMTPServerDisconnected, TimeoutError) as e:
        logger.exception("SMTP connection failed for order email")
        raise HTTPException(status_code=502, detail="SMTP connection failed") from e
    except smtplib.SMTPException as e:
        logger.exception("SMTP error for order email")
        raise HTTPException(status_code=502, detail="SMTP error") from e

    log_activity(
        db,
        action=ORDER_EMAIL_SENT,
        entity_type="order",
        entity_id=order.id,
        actor_user=user,
        meta={"order_id": order.id, "to": to_email},
    )
    db.commit()
    return {"message": "Order sent"}


@router.post("/orders/{order_id}/download")
def download_order_pdf(
    order_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin", "showroom"])),
):
    order = db.query(models.Order).filter(models.Order.id == order_id).filter(order_alive()).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    try:
        pdf_bytes = document_pdf_bytes_via_ui("order", "order", order.id)
    except RuntimeError as e:
        logger.exception("Order PDF download failed")
        raise HTTPException(status_code=500, detail=str(e)) from e
    except Exception as e:
        logger.exception("Order PDF download failed")
        raise HTTPException(status_code=500, detail="Could not generate PDF") from e

    log_activity(
        db,
        action=ORDER_DOWNLOADED,
        entity_type="order",
        entity_id=order.id,
        actor_user=user,
        meta={"order_id": order.id},
    )
    db.commit()

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="order-{order.id}.pdf"'},
    )


@router.post("/orders/{order_id}/mark_paid")
def mark_order_fully_paid(
    order_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin"])),
):
    order = db.query(models.Order).filter(models.Order.id == order_id).filter(order_alive()).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.total_price is None:
        raise HTTPException(status_code=400, detail="total_price is required to mark as paid")

    totals = compute_totals(order.total_price, None, order.discount_type, order.discount_value, order.tax_percent)
    grand_total = totals.total
    pricing = compute_pricing(grand_total, grand_total)
    order.amount_paid = pricing.amount_paid
    order.balance = pricing.balance
    order.payment_status = pricing.payment_status
    order.updated_by = user.id
    order.updated_at = datetime.utcnow()
    sync_invoice_from_order(db, order)
    log_activity(
        db,
        action=ORDER_MARKED_PAID,
        entity_type="order",
        entity_id=order.id,
        actor_user=user,
    )
    db.commit()
    return {"message": "Order marked as fully paid"}
