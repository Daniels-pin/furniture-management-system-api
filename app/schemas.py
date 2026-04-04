from decimal import Decimal

from pydantic import BaseModel, EmailStr, Field, field_validator
from datetime import datetime
from typing import List, Literal, Optional
from enum import Enum

class OrderItemCreate(BaseModel):
    item_name: str = Field(..., min_length=1)
    description: str = Field(..., min_length=1)
    quantity: int = Field(..., gt=0)
    amount: Optional[Decimal] = Field(None, ge=0)

class CustomerCreate(BaseModel):
    name: str = Field(..., min_length=1)
    phone: str
    address: str
    email: Optional[EmailStr] = None
    birth_day: Optional[int] = Field(None, ge=1, le=31)
    birth_month: Optional[int] = Field(None, ge=1, le=12)


class CustomerPublicResponse(BaseModel):
    id: int
    name: str
    phone: Optional[str] = None
    address: Optional[str] = None
    email: Optional[str] = None
    birth_day: Optional[int] = None
    birth_month: Optional[int] = None
    created_by: Optional[str] = None

    class Config:
        orm_mode = True


class CustomerResponse(CustomerCreate):
    id: int
    created_by: Optional[str] = None

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
    factory = "factory"
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
    amount: Optional[Decimal] = None

    class Config:
        orm_mode = True

class OrderResponse(BaseModel):
    id: int
    status: OrderStatus
    due_date: Optional[datetime]
    created_at: datetime
    image_url: Optional[str] = None
    total_price: Optional[Decimal] = None
    discount_type: Optional[str] = None
    discount_value: Optional[Decimal] = None
    discount_amount: Optional[Decimal] = None
    final_price: Optional[Decimal] = None
    tax_percent: Optional[Decimal] = None
    tax: Optional[Decimal] = None
    total: Optional[Decimal] = None
    amount_paid: Optional[Decimal] = None
    balance: Optional[Decimal] = None
    payment_status: Optional[str] = None
    created_by: Optional[str] = None
    updated_by: Optional[str] = None
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
    discount_type: Optional[str] = None
    discount_value: Optional[Decimal] = None
    discount_amount: Optional[Decimal] = None
    final_price: Optional[Decimal] = None
    tax_percent: Optional[Decimal] = None
    tax: Optional[Decimal] = None
    total: Optional[Decimal] = None
    amount_paid: Optional[Decimal] = None
    balance: Optional[Decimal] = None
    payment_status: Optional[str] = None
    created_by: Optional[str] = None
    updated_by: Optional[str] = None
    invoice_id: Optional[int] = None


class OrderAdminPut(BaseModel):
    """Admin / showroom full order update (items, pricing, status)."""

    status: OrderStatus
    due_date: Optional[datetime] = None
    items: List[OrderItemCreate] = Field(..., min_length=1)
    total_price: Optional[Decimal] = None
    amount_paid: Optional[Decimal] = None
    discount_type: Optional[str] = None
    discount_value: Optional[Decimal] = None
    tax: Optional[Decimal] = Field(
        default=None,
        description="Tax percentage applied after discount (e.g. 7.5 means 7.5%).",
    )
    update_context: Optional[Literal["before_invoice"]] = None


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
    discount_type: Optional[str] = None
    discount_value: Optional[Decimal] = None
    discount_amount: Optional[Decimal] = None
    final_price: Optional[Decimal] = None
    tax_percent: Optional[Decimal] = None
    tax: Optional[Decimal] = None
    total: Optional[Decimal] = None
    created_by: Optional[str] = None

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
    tax: Optional[Decimal] = Field(
        default=None,
        description="Tax percentage applied after discount (e.g. 7.5 means 7.5%).",
    )


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


class ProformaItemIn(BaseModel):
    item_name: str = Field(..., min_length=1)
    description: str = ""
    quantity: int = Field(..., gt=0)
    amount: Optional[Decimal] = Field(None, ge=0)


class ProformaCreate(BaseModel):
    customer_name: str = Field(..., min_length=1)
    phone: str
    address: str
    email: Optional[EmailStr] = None
    due_date: Optional[datetime] = None
    items: List[ProformaItemIn] = Field(..., min_length=1)
    discount_type: Optional[str] = None
    discount_value: Optional[Decimal] = None
    tax: Optional[Decimal] = Field(
        default=None,
        description="Tax percentage applied after discount (e.g. 7.5 means 7.5%).",
    )
    save_as_draft: bool = True


class ProformaUpdate(BaseModel):
    customer_name: str = Field(..., min_length=1)
    phone: str
    address: str
    email: Optional[EmailStr] = None
    due_date: Optional[datetime] = None
    items: List[ProformaItemIn] = Field(..., min_length=1)
    discount_type: Optional[str] = None
    discount_value: Optional[Decimal] = None
    tax: Optional[Decimal] = Field(
        default=None,
        description="Tax percentage applied after discount (e.g. 7.5 means 7.5%).",
    )
    save_as_draft: bool = True


class ProformaItemOut(BaseModel):
    id: int
    item_name: str
    description: Optional[str] = None
    quantity: int
    amount: Optional[Decimal] = None

    class Config:
        from_attributes = True


class ConvertPresalesToInvoiceRequest(BaseModel):
    """Payment captured when converting a quotation or proforma into an order/invoice."""

    amount_paid: Optional[Decimal] = Field(default=None, ge=0)


class ProformaListItem(BaseModel):
    id: int
    proforma_number: str
    status: str
    customer_name: str
    grand_total: Optional[Decimal] = None
    created_at: datetime
    created_by: Optional[str] = None

    class Config:
        from_attributes = True


class ProformaDetailResponse(BaseModel):
    id: int
    proforma_number: str
    status: str
    customer_name: str
    phone: str
    address: str
    email: Optional[str] = None
    due_date: Optional[datetime] = None
    items: List[ProformaItemOut]
    discount_type: Optional[str] = None
    discount_value: Optional[Decimal] = None
    discount_amount: Optional[Decimal] = None
    tax_percent: Optional[Decimal] = None
    tax: Optional[Decimal] = None
    subtotal: Optional[Decimal] = None
    final_price: Optional[Decimal] = None
    grand_total: Optional[Decimal] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    created_by: Optional[str] = None
    updated_by: Optional[str] = None
    converted_order_id: Optional[int] = None


class QuotationItemIn(BaseModel):
    item_name: str = Field(..., min_length=1)
    description: str = ""
    quantity: int = Field(..., gt=0)
    amount: Optional[Decimal] = Field(None, ge=0)


class QuotationCreate(BaseModel):
    customer_name: str = Field(..., min_length=1)
    phone: str
    address: str
    email: Optional[EmailStr] = None
    due_date: Optional[datetime] = None
    items: List[QuotationItemIn] = Field(..., min_length=1)
    discount_type: Optional[str] = None
    discount_value: Optional[Decimal] = None
    tax: Optional[Decimal] = Field(
        default=None,
        description="Tax percentage applied after discount (e.g. 7.5 means 7.5%).",
    )
    save_as_draft: bool = True


class QuotationUpdate(BaseModel):
    customer_name: str = Field(..., min_length=1)
    phone: str
    address: str
    email: Optional[EmailStr] = None
    due_date: Optional[datetime] = None
    items: List[QuotationItemIn] = Field(..., min_length=1)
    discount_type: Optional[str] = None
    discount_value: Optional[Decimal] = None
    tax: Optional[Decimal] = Field(
        default=None,
        description="Tax percentage applied after discount (e.g. 7.5 means 7.5%).",
    )
    save_as_draft: bool = True


class QuotationItemOut(BaseModel):
    id: int
    item_name: str
    description: Optional[str] = None
    quantity: int
    amount: Optional[Decimal] = None

    class Config:
        from_attributes = True


class QuotationListItem(BaseModel):
    id: int
    quote_number: str
    status: str
    customer_name: str
    grand_total: Optional[Decimal] = None
    created_at: datetime
    created_by: Optional[str] = None

    class Config:
        from_attributes = True


class QuotationDetailResponse(BaseModel):
    id: int
    quote_number: str
    status: str
    customer_name: str
    phone: str
    address: str
    email: Optional[str] = None
    due_date: Optional[datetime] = None
    items: List[QuotationItemOut]
    discount_type: Optional[str] = None
    discount_value: Optional[Decimal] = None
    discount_amount: Optional[Decimal] = None
    tax_percent: Optional[Decimal] = None
    tax: Optional[Decimal] = None
    subtotal: Optional[Decimal] = None
    final_price: Optional[Decimal] = None
    grand_total: Optional[Decimal] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    created_by: Optional[str] = None
    updated_by: Optional[str] = None
    converted_order_id: Optional[int] = None
    converted_proforma_id: Optional[int] = None


class WaybillCreate(BaseModel):
    order_id: int = Field(..., gt=0)
    driver_name: str = Field(..., min_length=1)
    driver_phone: str = Field(..., min_length=1)
    vehicle_plate: str = Field(..., min_length=1)

    @field_validator("driver_name", "driver_phone", "vehicle_plate", mode="before")
    @classmethod
    def strip_driver_fields(cls, v: object) -> object:
        if v is None:
            return v
        return str(v).strip()


class WaybillLogisticsUpdate(BaseModel):
    driver_name: str = Field(..., min_length=1)
    driver_phone: str = Field(..., min_length=1)
    vehicle_plate: str = Field(..., min_length=1)

    @field_validator("driver_name", "driver_phone", "vehicle_plate", mode="before")
    @classmethod
    def strip_driver_fields(cls, v: object) -> object:
        if v is None:
            return v
        return str(v).strip()


class WaybillStatusUpdate(BaseModel):
    delivery_status: str = Field(..., min_length=1)