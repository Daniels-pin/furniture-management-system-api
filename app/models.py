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

    orders = relationship("Order", back_populates="customer")

# PRODUCTS TABLE
class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    price = Column(Float)

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
    tax = Column(Numeric(11, 2), nullable=True)
    amount_paid = Column(Numeric(11, 2), nullable=True)
    balance = Column(Numeric(11, 2), nullable=True)
    payment_status = Column(String, default="unpaid")

    created_by = Column(Integer, ForeignKey("users.id"))
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime, nullable=True)
    customer = relationship("Customer", back_populates="orders")
    items = relationship(
    "OrderItem",
    back_populates="order",
    cascade="all, delete-orphan"
    )
    invoice = relationship("Invoice", back_populates="order", uselist=False, cascade="all, delete-orphan")


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

    order = relationship("Order", back_populates="items")