from decimal import Decimal

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator
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


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=8, max_length=128)
    confirm_password: str = Field(..., min_length=1)

    @model_validator(mode="after")
    def passwords_valid(self):
        if self.new_password != self.confirm_password:
            raise ValueError("New passwords do not match")
        if self.new_password == self.current_password:
            raise ValueError("New password must be different from the current password")
        return self


class ProductCreate(BaseModel):
    name: str
    price: float


class ProductResponse(ProductCreate):
    id: int

    class Config:
        orm_mode = True


class ProductNameResponse(BaseModel):
    id: int
    name: str


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
    created_by_id: Optional[int] = None
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


# --- Factory inventory (materials) ---

InventoryTrackingMode = Literal["numeric", "status_only"]
InventoryStockLevel = Literal["low", "medium", "full"]
InventoryPaymentStatus = Literal["paid", "partial", "unpaid"]
InventoryMovementAction = Literal["added", "used", "adjusted"]


def _inventory_unit_validator(unit: str) -> str:
    from app.constants import INVENTORY_UNITS

    u = (unit or "").strip()
    if u not in INVENTORY_UNITS:
        raise ValueError(f"unit must be one of: {', '.join(INVENTORY_UNITS)}")
    return u


class InventoryMaterialCreate(BaseModel):
    material_name: str = Field(..., min_length=1)
    category: Optional[str] = None
    tracking_mode: InventoryTrackingMode
    quantity: Optional[Decimal] = Field(None, ge=0)
    unit: str = Field(..., min_length=1)
    stock_level: InventoryStockLevel
    supplier_name: str = Field(default="", max_length=500)
    cost: Optional[Decimal] = Field(None, ge=0)
    notes: Optional[str] = Field(None, max_length=4000)

    @field_validator("unit", mode="before")
    @classmethod
    def validate_unit(cls, v: object) -> object:
        if v is None:
            return v
        return _inventory_unit_validator(str(v))

    @field_validator("category", "notes", mode="before")
    @classmethod
    def strip_optional_str(cls, v: object) -> object:
        if v is None:
            return None
        s = str(v).strip()
        return s or None

    @field_validator("supplier_name", mode="before")
    @classmethod
    def strip_supplier(cls, v: object) -> str:
        if v is None:
            return ""
        return str(v).strip()

    @model_validator(mode="after")
    def tracking_matches_quantity(self):
        if self.tracking_mode == "status_only":
            if self.quantity is not None:
                raise ValueError("quantity must be omitted for status_only tracking")
        return self


class InventoryMaterialUpdate(BaseModel):
    material_name: Optional[str] = Field(None, min_length=1)
    category: Optional[str] = None
    tracking_mode: Optional[InventoryTrackingMode] = None
    quantity: Optional[Decimal] = Field(None, ge=0)
    unit: Optional[str] = Field(None, min_length=1)
    stock_level: Optional[InventoryStockLevel] = None
    supplier_name: Optional[str] = Field(None, max_length=500)
    cost: Optional[Decimal] = Field(None, ge=0)
    notes: Optional[str] = Field(None, max_length=4000)

    @field_validator("unit", mode="before")
    @classmethod
    def validate_unit(cls, v: object) -> object:
        if v is None:
            return v
        return _inventory_unit_validator(str(v))

    @field_validator("category", "notes", mode="before")
    @classmethod
    def strip_optional_str(cls, v: object) -> object:
        if v is None:
            return None
        s = str(v).strip()
        return s or None

    @field_validator("supplier_name", mode="before")
    @classmethod
    def strip_supplier(cls, v: object) -> object:
        if v is None:
            return None
        return str(v).strip() or None


class InventoryMaterialOut(BaseModel):
    id: int
    material_name: str
    category: Optional[str] = None
    tracking_mode: str
    quantity: Optional[Decimal] = None
    unit: str
    stock_level: str
    supplier_name: str
    payment_status: str
    cost: Optional[Decimal] = None
    amount_paid: Decimal
    balance: Optional[Decimal] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    added_by: Optional[str] = None
    last_updated_by: Optional[str] = None

    class Config:
        from_attributes = True


class InventoryPaymentCreate(BaseModel):
    amount: Decimal = Field(..., gt=0)
    paid_at: datetime
    note: Optional[str] = Field(None, max_length=2000)

    @field_validator("note", mode="before")
    @classmethod
    def strip_note(cls, v: object) -> object:
        if v is None:
            return None
        s = str(v).strip()
        return s or None


class InventoryPaymentOut(BaseModel):
    id: int
    material_id: int
    amount: Decimal
    paid_at: datetime
    note: Optional[str] = None
    created_at: datetime
    recorded_by: Optional[str] = None

    class Config:
        from_attributes = True


class InventoryFinancialSummary(BaseModel):
    total_cost: Decimal
    total_paid: Decimal
    total_outstanding: Decimal
    material_count: int


class InventorySupplierFinancialRow(BaseModel):
    supplier_name: str
    total_cost: Decimal
    total_paid: Decimal
    outstanding: Decimal


class InventoryMovementCreate(BaseModel):
    action: InventoryMovementAction
    quantity_delta: Decimal

    @model_validator(mode="after")
    def quantity_delta_rules(self):
        if self.action == "used" and self.quantity_delta >= 0:
            raise ValueError("used movements expect a negative quantity_delta")
        if self.action == "added" and self.quantity_delta <= 0:
            raise ValueError("added movements expect a positive quantity_delta")
        if self.action == "adjusted" and self.quantity_delta == 0:
            raise ValueError("adjusted movement requires a non-zero quantity_delta")
        return self


class InventoryMovementOut(BaseModel):
    id: int
    material_id: int
    material_name: str
    action: str
    quantity_delta: Optional[Decimal] = None
    meta: Optional[dict] = None
    actor_username: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class InventoryBulkDelete(BaseModel):
    ids: List[int] = Field(..., min_length=1)


class InventoryBulkStockLevel(BaseModel):
    ids: List[int] = Field(..., min_length=1)
    stock_level: InventoryStockLevel


class InventoryBulkPatch(BaseModel):
    ids: List[int] = Field(..., min_length=1)
    stock_level: Optional[InventoryStockLevel] = None
    supplier_name: Optional[str] = Field(None, max_length=500)
    category: Optional[str] = None

    @model_validator(mode="after")
    def at_least_one_field(self):
        if self.stock_level is None and self.supplier_name is None and self.category is None:
            raise ValueError("Provide at least one field to update")
        return self


class InventoryUnitsResponse(BaseModel):
    units: List[str]