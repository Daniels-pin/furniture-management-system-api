from sqlalchemy import Column, Integer, String, Float, Numeric
from app.db.base_class import Base
from sqlalchemy import ForeignKey, DateTime
from sqlalchemy.orm import relationship
from datetime import datetime

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
    amount_paid = Column(Numeric(11, 2), nullable=True)
    balance = Column(Numeric(11, 2), nullable=True)
    payment_status = Column(String, default="unpaid")

    created_by = Column(Integer, ForeignKey("users.id"))
    customer = relationship("Customer", back_populates="orders")
    items = relationship(
    "OrderItem",
    back_populates="order",
    cascade="all, delete-orphan"
)

class OrderItem(Base):
    __tablename__ = "order_items"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id", ondelete="CASCADE"))
    item_name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    quantity = Column(Integer)

    order = relationship("Order", back_populates="items")