from sqlalchemy import Column, Integer, String, Float, Numeric
from app.db.base_class import Base
from sqlalchemy import ForeignKey, DateTime
from sqlalchemy.orm import relationship
from datetime import datetime
from sqlalchemy import JSON

# USERS TABLE
class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    email = Column(String, unique=True, index=True)
    password = Column(String)
    role = Column(String)


# CUSTOMERS TABLE
class Customer(Base):
    __tablename__ = "customers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    phone = Column(String)
    address = Column(String)
    email = Column(String, nullable=True, index=True)
    birth_day = Column(Integer, nullable=True)
    birth_month = Column(Integer, nullable=True)
    creator_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    orders = relationship("Order", back_populates="customer")

# PRODUCTS TABLE
class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    price = Column(Float)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)


class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"))
    status = Column(String, default="pending")
    created_at = Column(DateTime, default=datetime.utcnow)
    due_date = Column(DateTime)
    image_url = Column(String, nullable=True)
    total_price = Column(Numeric(11, 2), nullable=True)
    discount_type = Column(String, nullable=True)
    discount_value = Column(Numeric(11, 2), nullable=True)
    discount_amount = Column(Numeric(11, 2), nullable=True)
    final_price = Column(Numeric(11, 2), nullable=True)
    tax_percent = Column(Numeric(8, 4), nullable=True)
    tax = Column(Numeric(11, 2), nullable=True)
    amount_paid = Column(Numeric(11, 2), nullable=True)
    balance = Column(Numeric(11, 2), nullable=True)
    payment_status = Column(String, default="unpaid")

    created_by = Column(Integer, ForeignKey("users.id"))
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime, nullable=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    customer = relationship("Customer", back_populates="orders")
    items = relationship(
    "OrderItem",
    back_populates="order",
    cascade="all, delete-orphan"
    )
    invoice = relationship("Invoice", back_populates="order", uselist=False, cascade="all, delete-orphan")
    waybills = relationship("Waybill", back_populates="order", cascade="all, delete-orphan")


class Invoice(Base):
    __tablename__ = "invoices"

    id = Column(Integer, primary_key=True, index=True)
    invoice_number = Column(String, unique=True, index=True, nullable=False)
    order_id = Column(Integer, ForeignKey("orders.id", ondelete="CASCADE"), unique=True, nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    total_price = Column(Numeric(11, 2), nullable=True)
    deposit_paid = Column(Numeric(11, 2), nullable=True)
    balance = Column(Numeric(11, 2), nullable=True)
    status = Column(String, default="unpaid")
    created_at = Column(DateTime, default=datetime.utcnow)
    due_date = Column(DateTime, nullable=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    order = relationship("Order", back_populates="invoice")
    customer = relationship("Customer")


class ActionLog(Base):
    __tablename__ = "action_logs"

    id = Column(Integer, primary_key=True, index=True)
    action = Column(String, nullable=False)  # e.g. create_order, update_order, send_invoice_email
    entity_type = Column(String, nullable=False)  # e.g. order, invoice
    entity_id = Column(Integer, nullable=True)
    actor_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    actor_username = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    meta = Column(JSON, nullable=True)


class OrderItem(Base):
    __tablename__ = "order_items"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id", ondelete="CASCADE"))
    item_name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    quantity = Column(Integer)
    amount = Column(Numeric(11, 2), nullable=True)  # unit amount / unit price

    order = relationship("Order", back_populates="items")


class ProformaInvoice(Base):
    __tablename__ = "proforma_invoices"

    id = Column(Integer, primary_key=True, index=True)
    proforma_number = Column(String, unique=True, index=True, nullable=False)
    status = Column(String, nullable=False)  # draft | finalized | converted

    customer_name = Column(String, nullable=False)
    phone = Column(String, nullable=False)
    address = Column(String, nullable=False)
    email = Column(String, nullable=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True)

    discount_type = Column(String, nullable=True)
    discount_value = Column(Numeric(11, 2), nullable=True)
    discount_amount = Column(Numeric(11, 2), nullable=True)
    tax_percent = Column(Numeric(8, 4), nullable=True)
    tax = Column(Numeric(11, 2), nullable=True)
    subtotal = Column(Numeric(11, 2), nullable=True)
    final_price = Column(Numeric(11, 2), nullable=True)
    grand_total = Column(Numeric(11, 2), nullable=True)
    due_date = Column(DateTime, nullable=True)

    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    converted_order_id = Column(Integer, ForeignKey("orders.id"), nullable=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    items = relationship(
        "ProformaItem",
        back_populates="proforma",
        cascade="all, delete-orphan",
    )


class ProformaItem(Base):
    __tablename__ = "proforma_items"

    id = Column(Integer, primary_key=True, index=True)
    proforma_id = Column(Integer, ForeignKey("proforma_invoices.id", ondelete="CASCADE"), nullable=False)
    item_name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    quantity = Column(Integer, nullable=False)
    amount = Column(Numeric(11, 2), nullable=True)

    proforma = relationship("ProformaInvoice", back_populates="items")


class Quotation(Base):
    __tablename__ = "quotations"

    id = Column(Integer, primary_key=True, index=True)
    quote_number = Column(String, unique=True, index=True, nullable=False)
    status = Column(String, nullable=False)  # draft | finalized | converted

    customer_name = Column(String, nullable=False)
    phone = Column(String, nullable=False)
    address = Column(String, nullable=False)
    email = Column(String, nullable=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True)

    discount_type = Column(String, nullable=True)
    discount_value = Column(Numeric(11, 2), nullable=True)
    discount_amount = Column(Numeric(11, 2), nullable=True)
    tax_percent = Column(Numeric(8, 4), nullable=True)
    tax = Column(Numeric(11, 2), nullable=True)
    subtotal = Column(Numeric(11, 2), nullable=True)
    final_price = Column(Numeric(11, 2), nullable=True)
    grand_total = Column(Numeric(11, 2), nullable=True)
    due_date = Column(DateTime, nullable=True)

    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    converted_order_id = Column(Integer, ForeignKey("orders.id"), nullable=True)
    converted_proforma_id = Column(Integer, ForeignKey("proforma_invoices.id", ondelete="SET NULL"), nullable=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    items = relationship(
        "QuotationItem",
        back_populates="quotation",
        cascade="all, delete-orphan",
    )


class QuotationItem(Base):
    __tablename__ = "quotation_items"

    id = Column(Integer, primary_key=True, index=True)
    quotation_id = Column(Integer, ForeignKey("quotations.id", ondelete="CASCADE"), nullable=False)
    item_name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    quantity = Column(Integer, nullable=False)
    amount = Column(Numeric(11, 2), nullable=True)

    quotation = relationship("Quotation", back_populates="items")


class Waybill(Base):
    __tablename__ = "waybills"

    id = Column(Integer, primary_key=True, index=True)
    waybill_number = Column(String, unique=True, index=True, nullable=False)
    order_id = Column(Integer, ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True)
    delivery_status = Column(String, nullable=False, default="pending")  # pending | shipped | delivered
    driver_name = Column(String, nullable=True)
    driver_phone = Column(String, nullable=True)
    vehicle_plate = Column(String, nullable=True)

    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    order = relationship("Order", back_populates="waybills")


class InventoryMaterial(Base):
    """Factory raw materials (not finished products / sales catalog)."""

    __tablename__ = "inventory_materials"

    id = Column(Integer, primary_key=True, index=True)
    material_name = Column(String, nullable=False)
    category = Column(String, nullable=True)
    # numeric: quantity is used; status_only: quantity stays NULL (stock_level is manual only).
    tracking_mode = Column(String, nullable=False)
    quantity = Column(Numeric(14, 4), nullable=True)
    unit = Column(String, nullable=False)
    # User-set only — never derived from quantity.
    stock_level = Column(String, nullable=False)
    supplier_name = Column(String, nullable=False, default="")
    payment_status = Column(String, nullable=False, default="unpaid")
    cost = Column(Numeric(11, 2), nullable=True)
    notes = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    updated_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    created_by_user = relationship("User", foreign_keys=[created_by_id])
    updated_by_user = relationship("User", foreign_keys=[updated_by_id])
    movements = relationship(
        "InventoryMovement",
        back_populates="material",
        cascade="all, delete-orphan",
    )
    payments = relationship(
        "InventoryMaterialPayment",
        back_populates="material",
        cascade="all, delete-orphan",
        order_by="InventoryMaterialPayment.id",
    )


class InventoryMaterialPayment(Base):
    """Supplier payment recorded against a material line (sum drives amount paid / balance)."""

    __tablename__ = "inventory_material_payments"

    id = Column(Integer, primary_key=True, index=True)
    material_id = Column(Integer, ForeignKey("inventory_materials.id", ondelete="CASCADE"), nullable=False)
    amount = Column(Numeric(11, 2), nullable=False)
    paid_at = Column(DateTime, nullable=False)
    note = Column(String, nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    material = relationship("InventoryMaterial", back_populates="payments")
    created_by_user = relationship("User", foreign_keys=[created_by_id])


class InventoryMovement(Base):
    __tablename__ = "inventory_movements"

    id = Column(Integer, primary_key=True, index=True)
    material_id = Column(Integer, ForeignKey("inventory_materials.id", ondelete="CASCADE"), nullable=False)
    action = Column(String, nullable=False)  # added | used | adjusted
    quantity_delta = Column(Numeric(14, 4), nullable=True)
    meta = Column(JSON, nullable=True)
    actor_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    actor_username = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    material = relationship("InventoryMaterial", back_populates="movements")