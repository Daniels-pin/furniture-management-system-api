"""Centralized activity logging for audit trails and the admin Activity Log."""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session

from app import models

logger = logging.getLogger(__name__)


def username_from_email(email: str | None) -> str | None:
    s = (email or "").strip()
    if not s:
        return None
    return s.split("@")[0] or None


def log_activity(
    db: Session,
    *,
    action: str,
    entity_type: str,
    entity_id: int | None,
    actor_user,
    meta: dict[str, Any] | None = None,
) -> None:
    """Append an ActionLog row. Caller must commit; failures are logged and do not raise."""
    try:
        db.add(
            models.ActionLog(
                action=action,
                entity_type=entity_type,
                entity_id=entity_id,
                actor_user_id=getattr(actor_user, "id", None),
                actor_username=username_from_email(getattr(actor_user, "email", None)),
                meta=meta,
            )
        )
    except Exception:
        logger.exception("Failed to write action log")


# Human-readable labels for the Activity Log UI
ORDER_CREATED = "Order Created"
ORDER_UPDATED = "Order Updated"
ORDER_UPDATED_BEFORE_INVOICE = "Order Updated Before Invoice"
ORDER_PRICING_UPDATED = "Order Payment Updated"
ORDER_DELETED = "Order Deleted"
ORDER_STATUS_UPDATED = "Order Status Updated"
ORDER_MARKED_PAID = "Order Marked Paid"
INVOICE_GENERATED = "Invoice Generated"
INVOICE_EMAIL_SENT = "Invoice Email Sent"
INVOICE_PRINTED = "Invoice Printed"
INVOICE_DELETED = "Invoice Deleted"
CUSTOMER_CREATED = "Customer Created"
CUSTOMER_DELETED = "Customer Deleted"
USER_CREATED = "User Created"
USER_DELETED = "User Deleted"
PRODUCT_CREATED = "Product Created"
LOGIN = "Login"
PROFORMA_CREATED = "Proforma Created"
DRAFT_UPDATED = "Draft Updated"
PROFORMA_UPDATED = "Proforma Updated"
PROFORMA_FINALIZED = "Proforma Finalized"
PROFORMA_SENT = "Proforma Sent"
PROFORMA_DOWNLOADED = "Proforma Downloaded"
PROFORMA_PRINTED = "Proforma Printed"
PROFORMA_CONVERTED_TO_INVOICE = "Proforma Converted to Invoice"
PROFORMA_DELETED = "Proforma Deleted"
QUOTATION_CREATED = "Quotation Created"
QUOTATION_DRAFT_UPDATED = "Quotation Draft Updated"
QUOTATION_UPDATED = "Quotation Updated"
QUOTATION_FINALIZED = "Quotation Finalized"
QUOTATION_SENT = "Quotation Sent"
QUOTATION_DOWNLOADED = "Quotation Downloaded"
QUOTATION_PRINTED = "Quotation Printed"
QUOTATION_CONVERTED_TO_PROFORMA = "Quotation Converted to Proforma"
QUOTATION_CONVERTED_TO_INVOICE = "Quotation Converted to Invoice"
QUOTATION_DELETED = "Quotation Deleted"
WAYBILL_CREATED = "Waybill Created"
WAYBILL_VIEWED = "Waybill Viewed"
WAYBILL_SENT = "Waybill Sent"
WAYBILL_DOWNLOADED = "Waybill Downloaded"
WAYBILL_PRINTED = "Waybill Printed"
WAYBILL_DELETED = "Waybill Deleted"
WAYBILL_STATUS_UPDATED = "Waybill Status Updated"
