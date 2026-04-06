"""SQLAlchemy filters for rows that are not in Trash (soft-deleted)."""
from __future__ import annotations

from app import models


def order_alive():
    return models.Order.deleted_at.is_(None)


def customer_alive():
    return models.Customer.deleted_at.is_(None)


def invoice_alive():
    return models.Invoice.deleted_at.is_(None)


def product_alive():
    return models.Product.deleted_at.is_(None)


def proforma_alive():
    return models.ProformaInvoice.deleted_at.is_(None)


def quotation_alive():
    return models.Quotation.deleted_at.is_(None)


def waybill_alive():
    return models.Waybill.deleted_at.is_(None)


def inventory_material_alive():
    return models.InventoryMaterial.deleted_at.is_(None)
