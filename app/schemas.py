from decimal import Decimal

from pydantic import BaseModel, EmailStr, Field
from datetime import datetime
from typing import List, Optional
from enum import Enum

class OrderItemCreate(BaseModel):
    item_name: str = Field(..., min_length=1)
    description: str = Field(..., min_length=1)
    quantity: int = Field(..., gt=0)

class CustomerCreate(BaseModel):
    name: str = Field(..., min_length=1)
    phone: str
    address: str
    email: Optional[EmailStr] = None


class CustomerPublicResponse(BaseModel):
    id: int
    name: str
    phone: Optional[str] = None
    address: Optional[str] = None
    email: Optional[str] = None

    class Config:
        orm_mode = True


class CustomerResponse(CustomerCreate):
    id: int

    class Config:
        orm_mode = True

class OrderCreate(BaseModel):
    customer: CustomerCreate
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
    # Keep existing DB fields, but support "username" for the UI/API.
    # We map username -> email and name -> username by default for stability.
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)
    role: UserRole

class UserResponse(BaseModel):
    id: int
    username: str
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
    customer: Optional[CustomerResponse] = None
    items: List[OrderItemResponse]

    class Config:
        orm_mode = True


class OrderDetailsResponse(BaseModel):
    order_id: int
    customer: Optional[CustomerResponse] = None
    items: List[OrderItemResponse]
    status: OrderStatus
    due_date: Optional[datetime] = None
    image_url: Optional[str] = None
    total_price: Optional[Decimal] = None
    amount_paid: Optional[Decimal] = None
    balance: Optional[Decimal] = None
    payment_status: Optional[str] = None


class OrderAdminPut(BaseModel):
    """Admin-only full order update (items, pricing, status)."""

    status: OrderStatus
    due_date: Optional[datetime] = None
    items: List[OrderItemCreate] = Field(..., min_length=1)
    total_price: Optional[Decimal] = None
    amount_paid: Optional[Decimal] = None


class InvoiceListItem(BaseModel):
    id: int
    invoice_number: str
    order_id: int
    customer_id: int
    total_price: Optional[Decimal] = None
    deposit_paid: Optional[Decimal] = None
    balance: Optional[Decimal] = None
    status: str
    created_at: datetime
    due_date: Optional[datetime] = None
    customer: Optional[CustomerPublicResponse] = None

    class Config:
        from_attributes = True


class InvoiceDetailResponse(InvoiceListItem):
    items: List[OrderItemResponse]


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


class OrdersListResponse(BaseModel):
    data: List[OrderResponse]
    total: int
    page: int
    total_pages: int


class OrderAlertItem(BaseModel):
    order_id: int
    status: OrderStatus
    due_date: Optional[datetime] = None
    customer: Optional[dict] = None


class OrdersAlertsResponse(BaseModel):
    due_soon_count: int
    orders: List[OrderAlertItem]