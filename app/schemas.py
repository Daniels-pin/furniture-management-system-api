from decimal import Decimal

from pydantic import BaseModel, EmailStr
from datetime import datetime
from typing import List, Optional
from enum import Enum

class OrderItemCreate(BaseModel):
    item_name: str
    description: Optional[str] = None
    quantity: int

class CustomerCreate(BaseModel):
    name: str
    phone: str
    address: str


class CustomerPublicResponse(BaseModel):
    id: int
    name: str
    phone: Optional[str] = None
    address: Optional[str] = None

    class Config:
        orm_mode = True


class CustomerResponse(CustomerCreate):
    id: int

    class Config:
        orm_mode = True

class OrderCreate(BaseModel):
    customer: CustomerCreate    #instead of customer_id
    items: List[OrderItemCreate]
    due_date: Optional[datetime] = None

class OrderStatus(str, Enum):
    pending = "pending"
    in_progress = "in_progress"
    completed = "completed"
    delivered = "delivered"

class UserRole(str, Enum):
    showroom = "showroom"
    manager = "manager"
    admin = "admin"

class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: UserRole

class UserResponse(BaseModel):
    id: int
    name: str
    email: str
    role: UserRole

    class Config:
        orm_mode = True


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class ProductCreate(BaseModel):
    name: str
    price: float


class ProductResponse(ProductCreate):
    id: int

    class Config:
        orm_mode = True

class OrderItemResponse(BaseModel):
    id: int
    item_name: str
    description: Optional[str]
    quantity: int

    class Config:
        orm_mode = True

class OrderResponse(BaseModel):
    id: int
    status: OrderStatus
    due_date: Optional[datetime]
    created_at: datetime
    image_url: Optional[str] = None
    total_price: Optional[Decimal] = None
    amount_paid: Optional[Decimal] = None
    balance: Optional[Decimal] = None
    payment_status: Optional[str] = None
    customer: CustomerResponse
    items: List[OrderItemResponse]

    class Config:
        orm_mode = True


class OrderUploadResponse(BaseModel):
    order_id: int
    customer_id: int
    product_id: Optional[int] = None
    quantity: int
    item_name: str
    description: Optional[str] = None
    image_url: Optional[str] = None
    total_price: Optional[Decimal] = None
    amount_paid: Optional[Decimal] = None
    balance: Optional[Decimal] = None
    payment_status: Optional[str] = None
    status: OrderStatus
    due_date: Optional[datetime] = None


class OrderPricingUpdate(BaseModel):
    total_price: Optional[Decimal] = None
    amount_paid: Optional[Decimal] = None