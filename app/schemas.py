from decimal import Decimal

from pydantic import BaseModel, EmailStr, Field, computed_field, field_serializer, field_validator, model_validator
from datetime import date, datetime, time
from typing import List, Literal, Optional
from enum import Enum

from app.utils.timezone import datetime_for_api

DocumentLineType = Literal["item", "subheading"]


class OrderItemCreate(BaseModel):
    line_type: DocumentLineType = "item"
    item_name: str = Field(..., min_length=1)
    description: str = ""
    quantity: Optional[int] = None
    amount: Optional[Decimal] = Field(None, ge=0)

    @model_validator(mode="after")
    def _validate_line(self):
        if self.line_type == "subheading":
            # Section rows have no qty/amount requirements.
            return self
        q = int(self.quantity) if self.quantity is not None else 0
        if q <= 0:
            raise ValueError("quantity must be > 0")
        return self

class CustomerCreate(BaseModel):
    name: str = Field(..., min_length=1)
    phone: str
    address: str
    email: Optional[EmailStr] = None
    birth_day: Optional[int] = Field(None, ge=1, le=31)
    birth_month: Optional[int] = Field(None, ge=1, le=12)


class CustomerUpdate(BaseModel):
    """PATCH payload for editing an existing customer (partial update)."""

    name: Optional[str] = Field(None, min_length=1)
    phone: Optional[str] = Field(None, min_length=1)
    address: Optional[str] = Field(None, min_length=1)
    # Allow setting email to null to clear it.
    email: Optional[EmailStr] | None = None
    # Allow setting birthdays to null to clear them.
    birth_day: Optional[int] | None = Field(None, ge=1, le=31)
    birth_month: Optional[int] | None = Field(None, ge=1, le=12)


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
    finance = "finance"
    contract_employee = "contract_employee"
    staff = "staff"

class UserCreate(BaseModel):
    # Keep existing DB fields, but support "username" for the UI/API.
    # We map username -> email and name -> username by default for stability.
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=8, max_length=128)
    role: UserRole


class ContractEmployeeCreateWithLogin(BaseModel):
    username: str = Field(..., min_length=1, max_length=320, description="Username/email for login (must be unique)")
    password: str = Field(..., min_length=8, max_length=128)
    # Optional at creation: completed by employee on first login.
    full_name: Optional[str] = Field(None, max_length=500)
    bank_name: Optional[str] = Field(None, max_length=200)
    account_number: Optional[str] = Field(None, max_length=100)
    phone: Optional[str] = Field(None, max_length=100)
    address: Optional[str] = Field(None, max_length=4000)
    status: Literal["active", "inactive"] = "active"

    @field_validator("username", mode="before")
    @classmethod
    def _strip_username(cls, v: object) -> object:
        if v is None:
            return v
        return str(v).strip()

    @field_validator("full_name", "bank_name", "account_number", "phone", "address", mode="before")
    @classmethod
    def _strip_optional_profile_fields(cls, v: object) -> object:
        if v is None:
            return None
        s = str(v).strip()
        return s or None

    @field_validator("account_number", mode="before")
    @classmethod
    def _digits_only_account_number(cls, v: object) -> object:
        if v is None:
            return None
        s = str(v).strip()
        if not s:
            return None
        if not s.isdigit():
            raise ValueError("account_number must contain digits only")
        return s

class UserResponse(BaseModel):
    id: int
    username: str
    role: UserRole

    class Config:
        orm_mode = True


class LoginRequest(BaseModel):
    # Accept either an email address or a legacy username stored in `users.email`.
    # (Some local/dev databases predate email validation.)
    email: str = Field(..., min_length=1, max_length=320)
    password: str = Field(..., min_length=1, max_length=128)

    @field_validator("email", mode="before")
    @classmethod
    def _strip_email(cls, v: object) -> object:
        if v is None:
            return v
        return str(v).strip()


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
    line_type: DocumentLineType = "item"
    item_name: str
    description: Optional[str]
    quantity: Optional[int] = None
    amount: Optional[Decimal] = None

    class Config:
        orm_mode = True

class OrderResponse(BaseModel):
    id: int
    status: OrderStatus
    due_date: Optional[datetime]
    created_at: datetime
    image_url: Optional[str] = None
    image_urls: Optional[List[str]] = None
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
    image_urls: Optional[List[str]] = None
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
    image_urls: Optional[List[str]] = None
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
    line_type: DocumentLineType = "item"
    item_name: str = Field(..., min_length=1)
    description: str = ""
    quantity: Optional[int] = None
    amount: Optional[Decimal] = Field(None, ge=0)

    @model_validator(mode="after")
    def _validate_line(self):
        if self.line_type == "subheading":
            return self
        q = int(self.quantity) if self.quantity is not None else 0
        if q <= 0:
            raise ValueError("quantity must be > 0")
        return self


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
    line_type: DocumentLineType = "item"
    item_name: str
    description: Optional[str] = None
    quantity: Optional[int] = None
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
    line_type: DocumentLineType = "item"
    item_name: str = Field(..., min_length=1)
    description: str = ""
    quantity: Optional[int] = None
    amount: Optional[Decimal] = Field(None, ge=0)

    @model_validator(mode="after")
    def _validate_line(self):
        if self.line_type == "subheading":
            return self
        q = int(self.quantity) if self.quantity is not None else 0
        if q <= 0:
            raise ValueError("quantity must be > 0")
        return self


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
    line_type: DocumentLineType = "item"
    item_name: str
    description: Optional[str] = None
    quantity: Optional[int] = None
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
    note: Optional[str] = Field(None, max_length=2000)

    @field_validator("note", mode="before")
    @classmethod
    def strip_movement_note(cls, v: object) -> object:
        if v is None:
            return None
        s = str(v).strip()
        return s or None

    @model_validator(mode="after")
    def quantity_delta_rules(self):
        if self.action == "used" and self.quantity_delta >= 0:
            raise ValueError("used movements expect a negative quantity_delta")
        if self.action == "added" and self.quantity_delta <= 0:
            raise ValueError("added movements expect a positive quantity_delta")
        if self.action == "adjusted" and self.quantity_delta == 0:
            raise ValueError("adjusted movement requires a non-zero quantity_delta")
        return self


class InventoryStockPurchaseCreate(BaseModel):
    """Add stock for an existing material (new purchase). Appends an `added` movement and optionally increases cumulative supplier cost."""

    quantity: Decimal = Field(..., gt=0)
    purchase_amount: Optional[Decimal] = Field(
        None,
        ge=0,
        description="Amount to add to this material's total supplier cost (cumulative). Omit for stock-only receipts.",
    )
    note: Optional[str] = Field(None, max_length=2000)

    @field_validator("note", mode="before")
    @classmethod
    def strip_purchase_note(cls, v: object) -> object:
        if v is None:
            return None
        s = str(v).strip()
        return s or None


class InventoryMaterialQtyStats(BaseModel):
    total_quantity_purchased: Decimal
    total_quantity_used: Decimal
    current_quantity: Optional[Decimal] = None


class InventoryMaterialDetailResponse(BaseModel):
    material: InventoryMaterialOut
    stats: InventoryMaterialQtyStats


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


# --- Factory tools & tool tracking ---


class FactoryToolOut(BaseModel):
    id: int
    name: str
    notes: Optional[str] = None
    in_use: bool = False
    created_at: datetime

    class Config:
        from_attributes = True


class FactoryToolCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=500)
    notes: Optional[str] = Field(None, max_length=4000)

    @field_validator("name", mode="before")
    @classmethod
    def strip_name(cls, v: object) -> object:
        if v is None:
            return v
        return str(v).strip()


class FactoryToolUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=500)
    notes: Optional[str] = Field(None, max_length=4000)

    @field_validator("name", mode="before")
    @classmethod
    def strip_name_opt(cls, v: object) -> object:
        if v is None:
            return v
        s = str(v).strip()
        return s or None


class ToolTrackingDaySummary(BaseModel):
    date: str  # YYYY-MM-DD
    checkouts: int
    still_out: int


class ToolTrackingDaysPage(BaseModel):
    items: List[ToolTrackingDaySummary]
    page: int
    per_page: int
    total_days: int


class ToolTrackingRecordOut(BaseModel):
    id: int
    tool_id: int
    tool_name: str
    checkout_at: datetime
    returned_at: Optional[datetime] = None
    borrower_name: Optional[str] = None
    notes: Optional[str] = None
    checked_out_by: Optional[str] = None

    class Config:
        from_attributes = True


class FactoryToolDetailResponse(BaseModel):
    tool: FactoryToolOut
    records: List[ToolTrackingRecordOut]
    current_record_id: Optional[int] = Field(
        None,
        description="Open checkout record id when tool is in use",
    )


class ToolTrackingRecordsPage(BaseModel):
    date: str
    status_filter: Literal["all", "returned", "in_use"]
    items: List[ToolTrackingRecordOut]
    page: int
    per_page: int
    total: int


class ToolTrackingCheckoutCreate(BaseModel):
    tool_id: int = Field(..., gt=0)
    checkout_at: Optional[datetime] = None
    borrower_name: Optional[str] = Field(None, max_length=500)
    notes: Optional[str] = Field(None, max_length=4000)


class ToolTrackingReturnBody(BaseModel):
    returned_at: Optional[datetime] = None


# --- Factory machines ---


MachineStatus = Literal["available", "in_use", "maintenance"]
MachineActivityKind = Literal["usage_start", "usage_end", "status_change", "note"]


class FactoryMachineOut(BaseModel):
    id: int
    machine_name: str
    category: Optional[str] = None
    serial_number: Optional[str] = None
    location: Optional[str] = None
    status: MachineStatus
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class FactoryMachineCreate(BaseModel):
    machine_name: str = Field(..., min_length=1, max_length=500)
    category: Optional[str] = Field(None, max_length=200)
    serial_number: Optional[str] = Field(None, max_length=200)
    location: Optional[str] = Field(None, max_length=500)
    status: MachineStatus = "available"
    notes: Optional[str] = Field(None, max_length=4000)

    @field_validator("machine_name", mode="before")
    @classmethod
    def strip_machine_name(cls, v: object) -> object:
        if v is None:
            return v
        return str(v).strip()


class FactoryMachineUpdate(BaseModel):
    machine_name: Optional[str] = Field(None, min_length=1, max_length=500)
    category: Optional[str] = Field(None, max_length=200)
    serial_number: Optional[str] = Field(None, max_length=200)
    location: Optional[str] = Field(None, max_length=500)
    status: Optional[MachineStatus] = None
    notes: Optional[str] = Field(None, max_length=4000)


class MachineActivityOut(BaseModel):
    id: int
    machine_id: int
    kind: MachineActivityKind
    message: Optional[str] = None
    meta: Optional[dict] = None
    created_at: datetime
    recorded_by: Optional[str] = None

    class Config:
        from_attributes = True


class FactoryMachineDetailResponse(BaseModel):
    machine: FactoryMachineOut
    activities: List[MachineActivityOut]


class MachineActivityCreate(BaseModel):
    kind: MachineActivityKind
    message: Optional[str] = Field(None, max_length=4000)
    new_status: Optional[MachineStatus] = Field(
        None,
        description="Required for status_change; optional hint for usage transitions",
    )

    @model_validator(mode="after")
    def status_change_requires_new_status(self):
        if self.kind == "status_change" and self.new_status is None:
            raise ValueError("new_status is required for status_change")
        return self


# --- Employees (HR / payroll) ---


class EmployeeDocumentItem(BaseModel):
    id: str = Field(..., min_length=1, max_length=64)
    url: str = Field(..., min_length=1, max_length=2000)
    label: Optional[str] = Field(None, max_length=500)
    uploaded_at: Optional[str] = None


class EmployeeLatenessEntryOut(BaseModel):
    id: int
    attendance_id: Optional[int] = None
    note: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


AttendanceShiftKey = Literal["morning", "full_day"]


class CompanyLocationOut(BaseModel):
    id: int
    name: str
    latitude: float
    longitude: float
    allowed_radius_meters: int
    shift_mode_enabled: bool = False
    late_attendance_time: time
    attendance_cutoff_time: Optional[time] = None
    check_out_time: time
    morning_shift_late_time: Optional[time] = None
    morning_shift_closing_time: Optional[time] = None
    full_day_shift_late_time: Optional[time] = None
    full_day_shift_closing_time: Optional[time] = None
    late_coming_fee_naira: Decimal
    early_sign_out_fee_naira: Decimal
    absence_fee_naira: Decimal
    created_at: datetime

    @field_serializer(
        "late_attendance_time",
        "attendance_cutoff_time",
        "check_out_time",
        "morning_shift_late_time",
        "morning_shift_closing_time",
        "full_day_shift_late_time",
        "full_day_shift_closing_time",
    )
    @classmethod
    def _serialize_location_time(cls, v: Optional[time]) -> Optional[str]:
        return v.strftime("%H:%M") if v is not None else None

    class Config:
        from_attributes = True


def _parse_attendance_time(v: object) -> object:
    if v is None or isinstance(v, time):
        return v
    s = str(v).strip()
    if not s:
        raise ValueError("Invalid attendance time")
    parts = s.split(":")
    if len(parts) < 2:
        raise ValueError("Invalid attendance time")
    hour = int(parts[0])
    minute = int(parts[1])
    if hour < 0 or hour > 23 or minute < 0 or minute > 59:
        raise ValueError("Invalid attendance time")
    return time(hour, minute)


def _parse_late_attendance_time(v: object) -> object:
    return _parse_attendance_time(v)


class CompanyLocationCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    latitude: float
    longitude: float
    allowed_radius_meters: int = Field(..., ge=1, le=200_000)
    shift_mode_enabled: bool = False
    late_attendance_time: time = Field(default=time(8, 15))
    attendance_cutoff_time: Optional[time] = None
    check_out_time: time = Field(default=time(17, 0))
    morning_shift_late_time: Optional[time] = None
    morning_shift_closing_time: Optional[time] = None
    full_day_shift_late_time: Optional[time] = None
    full_day_shift_closing_time: Optional[time] = None
    late_coming_fee_naira: Decimal = Field(default=Decimal("500"), ge=0)
    early_sign_out_fee_naira: Decimal = Field(default=Decimal("500"), ge=0)
    absence_fee_naira: Decimal = Field(default=Decimal("1000"), ge=0)

    @field_validator("name", mode="before")
    @classmethod
    def _strip_name(cls, v: object) -> object:
        if v is None:
            return v
        return str(v).strip()

    @field_validator(
        "late_attendance_time",
        "attendance_cutoff_time",
        "check_out_time",
        "morning_shift_late_time",
        "morning_shift_closing_time",
        "full_day_shift_late_time",
        "full_day_shift_closing_time",
        mode="before",
    )
    @classmethod
    def _parse_location_time_create(cls, v: object) -> object:
        if v is None:
            return None
        return _parse_attendance_time(v)

    @model_validator(mode="after")
    def _validate_shift_config(self) -> "CompanyLocationCreate":
        if self.shift_mode_enabled:
            missing = [
                name
                for name, val in (
                    ("morning_shift_late_time", self.morning_shift_late_time),
                    ("morning_shift_closing_time", self.morning_shift_closing_time),
                    ("full_day_shift_late_time", self.full_day_shift_late_time),
                    ("full_day_shift_closing_time", self.full_day_shift_closing_time),
                )
                if val is None
            ]
            if missing:
                raise ValueError(
                    "When shift mode is enabled, all shift times must be configured: "
                    + ", ".join(missing)
                )
        return self


class CompanyLocationUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    allowed_radius_meters: Optional[int] = Field(None, ge=1, le=200_000)
    shift_mode_enabled: Optional[bool] = None
    late_attendance_time: Optional[time] = None
    attendance_cutoff_time: Optional[time] = None
    check_out_time: Optional[time] = None
    morning_shift_late_time: Optional[time] = None
    morning_shift_closing_time: Optional[time] = None
    full_day_shift_late_time: Optional[time] = None
    full_day_shift_closing_time: Optional[time] = None
    late_coming_fee_naira: Optional[Decimal] = Field(None, ge=0)
    early_sign_out_fee_naira: Optional[Decimal] = Field(None, ge=0)
    absence_fee_naira: Optional[Decimal] = Field(None, ge=0)

    @field_validator("name", mode="before")
    @classmethod
    def _strip_name_opt(cls, v: object) -> object:
        if v is None:
            return None
        s = str(v).strip()
        return s or None

    @field_validator(
        "late_attendance_time",
        "attendance_cutoff_time",
        "check_out_time",
        "morning_shift_late_time",
        "morning_shift_closing_time",
        "full_day_shift_late_time",
        "full_day_shift_closing_time",
        mode="before",
    )
    @classmethod
    def _parse_location_time_update(cls, v: object) -> object:
        if v is None:
            return None
        return _parse_attendance_time(v)


class EmployeeAttendanceEntryOut(BaseModel):
    id: int
    employee_id: int
    period_id: int
    attendance_date: date
    check_in_at: datetime
    check_out_at: Optional[datetime] = None
    selected_shift: Optional[AttendanceShiftKey] = None
    shift_label: Optional[str] = None
    expected_late_time: Optional[time] = None
    is_late: bool = False
    late_minutes: Optional[int] = None
    is_early_check_out: bool = False
    early_check_out_minutes: Optional[int] = None
    expected_check_out_time: Optional[time] = None
    lateness_entry_id: Optional[int] = None
    early_sign_out_entry_id: Optional[int] = None
    work_location_id: Optional[int] = None
    employee_latitude: Optional[float] = None
    employee_longitude: Optional[float] = None
    distance_meters: Optional[float] = None
    check_out_latitude: Optional[float] = None
    check_out_longitude: Optional[float] = None
    check_out_distance_meters: Optional[float] = None
    work_location: Optional[CompanyLocationOut] = None

    @field_serializer("check_in_at", "check_out_at")
    def _serialize_attendance_times(self, v: Optional[datetime]) -> Optional[datetime]:
        return datetime_for_api(v) if v is not None else None

    @field_serializer("expected_check_out_time", "expected_late_time")
    def _serialize_expected_times(self, v: Optional[time]) -> Optional[str]:
        return v.strftime("%H:%M") if v is not None else None

    class Config:
        from_attributes = True


class EmployeeAttendanceHistoryOut(BaseModel):
    """Unified attendance history row: present, late, absent, incomplete, or checked in (today)."""

    id: int
    record_type: Literal["attendance", "absence"]
    employee_id: int
    period_id: int
    attendance_date: date
    status: Literal[
        "present",
        "late",
        "absent",
        "incomplete_day",
        "checked_in",
        "early_check_out",
        "late_early_check_out",
        "short_session",
    ]
    check_in_at: Optional[datetime] = None
    check_out_at: Optional[datetime] = None
    selected_shift: Optional[AttendanceShiftKey] = None
    shift_label: Optional[str] = None
    expected_late_time: Optional[time] = None
    is_late: bool = False
    late_minutes: Optional[int] = None
    is_early_check_out: bool = False
    early_check_out_minutes: Optional[int] = None
    expected_check_out_time: Optional[time] = None
    attendance_duration_minutes: Optional[int] = None
    late_deduction_naira: Decimal = Decimal("0")
    early_sign_out_deduction_naira: Decimal = Decimal("0")
    deduction_naira: Decimal = Decimal("0")
    lateness_entry_id: Optional[int] = None
    early_sign_out_entry_id: Optional[int] = None
    absence_entry_id: Optional[int] = None
    work_location_id: Optional[int] = None
    employee_latitude: Optional[float] = None
    employee_longitude: Optional[float] = None
    distance_meters: Optional[float] = None
    check_out_latitude: Optional[float] = None
    check_out_longitude: Optional[float] = None
    check_out_distance_meters: Optional[float] = None
    work_location: Optional[CompanyLocationOut] = None

    @field_serializer("check_in_at", "check_out_at")
    def _serialize_check_times(self, v: Optional[datetime]) -> Optional[datetime]:
        return datetime_for_api(v) if v is not None else None

    @field_serializer("expected_check_out_time", "expected_late_time")
    def _serialize_expected_times(self, v: Optional[time]) -> Optional[str]:
        return v.strftime("%H:%M") if v is not None else None


class EmployeeSignOutPreviewOut(BaseModel):
    """Preview for sign-out confirmation (uses locked shift / snapshotted closing time)."""

    shift_label: Optional[str] = None
    closing_time: str
    current_time: str
    is_early_sign_out: bool
    early_sign_out_fee_naira: Decimal = Decimal("0")
    message: str


class EmployeeClockInOut(BaseModel):
    status: Literal["present", "late", "already_checked_in", "already_checked_out", "sunday"]
    message: Optional[str] = None
    entry: Optional[EmployeeAttendanceHistoryOut] = None


class EmployeeClockOutOut(BaseModel):
    status: Literal["checked_out", "not_checked_in", "already_checked_out", "sunday"]
    message: Optional[str] = None
    entry: Optional[EmployeeAttendanceHistoryOut] = None


class EmployeeClockInGeoIn(BaseModel):
    latitude: float
    longitude: float
    # Browser-reported horizontal accuracy (meters); expands allowed radius for GPS uncertainty.
    accuracy_meters: Optional[float] = Field(None, ge=0, le=500)
    shift: Optional[AttendanceShiftKey] = Field(
        None,
        description="Required when the assigned location has shift mode enabled.",
    )


class EmployeeWorkLocationAssignIn(BaseModel):
    location_id: Optional[int] = Field(
        None,
        description="CompanyLocation.id to assign; null clears the assignment",
    )


AttendanceMonitorFilterStatus = Literal[
    "present",
    "late",
    "early_sign_out",
    "absent",
    "checked_in",
    "incomplete_day",
]


class AttendanceMonitorSummaryOut(BaseModel):
    attendance_date: date
    expected_employees: int
    present: int
    late: int
    early_sign_out: int
    absent: int
    checked_in_only: int
    incomplete_day: int = 0


class AttendanceMonitorRowOut(BaseModel):
    employee_id: int
    full_name: str
    work_location: Optional[CompanyLocationOut] = None
    shift_label: Optional[str] = None
    check_in_at: Optional[datetime] = None
    check_out_at: Optional[datetime] = None
    status: Literal[
        "present",
        "late",
        "absent",
        "incomplete_day",
        "checked_in",
        "early_check_out",
        "late_early_check_out",
        "short_session",
    ]
    monitor_filter_status: AttendanceMonitorFilterStatus

    @field_serializer("check_in_at", "check_out_at")
    def _serialize_monitor_times(self, v: Optional[datetime]) -> Optional[datetime]:
        return datetime_for_api(v) if v is not None else None


class AttendanceMonitorOut(BaseModel):
    attendance_date: date
    summary: AttendanceMonitorSummaryOut
    rows: list[AttendanceMonitorRowOut]
    rows_total: int = 0


class EmployeeAttendanceMonthSummaryOut(BaseModel):
    year: int
    month: int
    label: str
    record_count: int


class EmployeeAttendanceHistoryPageOut(BaseModel):
    year: int
    month: int
    items: list[EmployeeAttendanceHistoryOut]
    total: int
    limit: int
    offset: int


class EmployeeAttendanceStatsOut(BaseModel):
    year: int
    month: int
    present: int
    late: int
    early_sign_out: int
    absent: int
    checked_in_only: int
    incomplete_day: int


class EmployeeAttendanceOverviewOut(BaseModel):
    employee_id: int
    full_name: str
    work_location: Optional[CompanyLocationOut] = None
    stats: EmployeeAttendanceStatsOut


class EmployeeLocationAssignmentItemOut(BaseModel):
    id: int
    full_name: str
    work_location_id: Optional[int] = None
    work_location: Optional[CompanyLocationOut] = None

    class Config:
        from_attributes = True


class EmployeeLocationAssignmentPatchOut(EmployeeLocationAssignmentItemOut):
    pass


class EmployeePenaltyOut(BaseModel):
    id: int
    description: str
    amount: Decimal
    created_at: datetime

    class Config:
        from_attributes = True


class EmployeeBonusOut(BaseModel):
    id: int
    description: str
    amount: Decimal
    created_at: datetime

    class Config:
        from_attributes = True


class EmployeePayrollAdjustmentOut(BaseModel):
    id: int
    adjustment_type: Literal["bonus", "deduction", "increment"]
    amount: Decimal
    reason: str
    notes: Optional[str] = None
    created_at: datetime
    created_by_name: Optional[str] = None
    updated_at: Optional[datetime] = None
    updated_by_name: Optional[str] = None

    class Config:
        from_attributes = True


class EmployeePayrollAdjustmentCreate(BaseModel):
    adjustment_type: Literal["bonus", "deduction", "increment"]
    amount: Decimal = Field(..., gt=0)
    reason: str = Field(..., min_length=1, max_length=2000)
    notes: Optional[str] = Field(None, max_length=8000)
    confirm_financial_edit: bool = False

    @field_validator("reason", "notes", mode="before")
    @classmethod
    def _strip_text(cls, v: object) -> object:
        if v is None:
            return None
        s = str(v).strip()
        return s or None


class EmployeePayrollAdjustmentUpdate(BaseModel):
    amount: Optional[Decimal] = Field(None, gt=0)
    reason: Optional[str] = Field(None, min_length=1, max_length=2000)
    notes: Optional[str] = Field(None, max_length=8000)
    confirm_financial_edit: bool = False

    @field_validator("reason", "notes", mode="before")
    @classmethod
    def _strip_text(cls, v: object) -> object:
        if v is None:
            return None
        s = str(v).strip()
        return s or None


class EmployeeSalaryBreakdown(BaseModel):
    # base_salary_used: actual base used for this period (period override or employee base).
    base_salary_used: Decimal
    # base_salary: kept for backward compatibility (same as base_salary_used).
    base_salary: Decimal
    # Optional per-period override (when set on EmployeePeriodPayroll).
    period_base_salary: Optional[Decimal] = None
    lateness_count: int
    lateness_deduction_auto: Decimal
    lateness_deduction: Decimal
    lateness_deduction_override: Optional[Decimal] = None
    lateness_rate_naira: Optional[Decimal] = None
    early_sign_out_count: int = 0
    early_sign_out_deduction_auto: Decimal = Decimal("0")
    early_sign_out_deduction: Decimal = Decimal("0")
    early_sign_out_deduction_override: Optional[Decimal] = None
    early_sign_out_rate_naira: Optional[Decimal] = None
    absence_count: int = 0
    absence_deduction_auto: Decimal = Decimal("0")
    absence_deduction: Decimal = Decimal("0")
    absence_deduction_override: Optional[Decimal] = None
    absence_rate_naira: Optional[Decimal] = None
    # False when no work location is assigned (unpaid periods); lateness/absence amounts are zero.
    attendance_deductions_eligible: bool = True
    # Transaction totals (employee_payroll_adjustments)
    penalties_entries_total: Decimal = Decimal("0")
    bonuses_entries_total: Decimal = Decimal("0")
    increments_total: Decimal = Decimal("0")
    # Legacy aggregate fields (always zero after transaction migration; kept for API compat)
    adjustment_bonus: Decimal = Decimal("0")
    adjustment_deduction: Decimal = Decimal("0")
    adjustment_late_penalty: Decimal = Decimal("0")
    # Totals used in final payable
    penalties_total: Decimal
    bonuses_total: Decimal
    total_deductions: Decimal
    final_payable: Decimal
    adjustment_note: Optional[str] = None


class SalaryPeriodOut(BaseModel):
    id: int
    year: int
    month: int
    label: str
    is_active: bool = False
    month_payment_status: Literal["paid", "pending_payment"] = "pending_payment"
    paid_employee_count: int = 0
    total_employee_count: int = 0
    month_paid_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class PayrollPeriodsNavOut(BaseModel):
    """Months that exist in the archive (have data) plus the active payroll month."""

    active_period: Optional[SalaryPeriodOut] = None
    periods: List[SalaryPeriodOut] = []


class EmployeePaymentOut(BaseModel):
    status: Literal["paid", "unpaid"]
    payment_date: Optional[datetime] = None
    payment_reference: Optional[str] = None


class EmployeeOut(BaseModel):
    id: int
    full_name: str
    address: Optional[str] = None
    phone: Optional[str] = None
    bank_name: Optional[str] = None
    account_number: Optional[str] = None
    notes: Optional[str] = None
    base_salary: Decimal
    documents: Optional[List[dict]] = None
    user_id: Optional[int] = None
    linked_username: Optional[str] = None
    work_location_id: Optional[int] = None
    work_location: Optional[CompanyLocationOut] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    period: SalaryPeriodOut
    payment: EmployeePaymentOut
    lateness_entries: List[EmployeeLatenessEntryOut] = []
    penalties: List[EmployeePenaltyOut] = []
    bonuses: List[EmployeeBonusOut] = []
    payroll_adjustments: List[EmployeePayrollAdjustmentOut] = []
    salary: EmployeeSalaryBreakdown

    class Config:
        from_attributes = True


class EmployeeListItemOut(BaseModel):
    id: int
    full_name: str
    # Optional note shown on the monthly list UI.
    notes: Optional[str] = None
    # Keep these for backward compatibility (frontend may still rely on them elsewhere).
    phone: Optional[str] = None
    bank_name: Optional[str] = None
    account_number: Optional[str] = None
    base_salary: Decimal
    user_id: Optional[int] = None
    period: SalaryPeriodOut
    payment: EmployeePaymentOut
    salary: EmployeeSalaryBreakdown


class EmployeePayrollAdjustmentIn(BaseModel):
    """Admin-only per-period attendance deduction overrides (monthly employees)."""

    period_base_salary: Optional[Decimal] = Field(
        None,
        ge=0,
        description="Deprecated: use increment transactions. When set, creates an increment transaction for the delta.",
    )
    bonus: Optional[Decimal] = Field(
        None,
        ge=0,
        description="Deprecated: creates a bonus transaction instead of overwriting a running total.",
    )
    deduction: Optional[Decimal] = Field(
        None,
        ge=0,
        description="Deprecated: creates a deduction transaction instead of overwriting a running total.",
    )
    late_penalty: Optional[Decimal] = Field(
        None,
        ge=0,
        description="Legacy: extra amount added to penalties (not lateness bucket). Prefer lateness_deduction.",
    )
    lateness_deduction: Optional[Decimal] = Field(
        None,
        ge=0,
        description="Effective lateness deduction for this period (overrides count × rate when different).",
    )
    absence_deduction: Optional[Decimal] = Field(
        None,
        ge=0,
        description="Effective absence deduction for this period (overrides count × rate when different).",
    )
    early_sign_out_deduction: Optional[Decimal] = Field(
        None,
        ge=0,
        description="Effective early sign-out deduction for this period (overrides automatic total when different).",
    )
    note: Optional[str] = Field(None, max_length=8000)
    confirm_financial_edit: bool = False

    @field_validator("note", mode="before")
    @classmethod
    def _strip_note(cls, v: object) -> object:
        if v is None:
            return None
        s = str(v).strip()
        return s or None



class PayrollSummaryOut(BaseModel):
    period: SalaryPeriodOut
    employee_count: int
    total_base_salary: Decimal
    total_lateness_deductions: Decimal
    total_early_sign_out_deductions: Decimal = Decimal("0")
    total_absence_deductions: Decimal = Decimal("0")
    total_penalties: Decimal
    total_bonuses: Decimal
    total_deductions: Decimal
    net_payroll: Decimal


class EmployeeCreate(BaseModel):
    # Conditional requirements:
    # - If user_id is provided (linked employee), all profile fields are optional (employee completes after login).
    # - If user_id is not provided (standalone employee), required: full_name, phone, address, bank_name, account_number.
    full_name: Optional[str] = Field(None, max_length=500)
    address: Optional[str] = Field(None, max_length=4000)
    phone: Optional[str] = Field(None, max_length=100)
    bank_name: Optional[str] = Field(None, max_length=200)
    account_number: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = Field(None, max_length=8000)
    base_salary: Decimal = Field(default=Decimal("0"), ge=0)
    user_id: Optional[int] = Field(None, description="Link to existing app user (optional)")

    @field_validator("full_name", "address", "phone", "bank_name", "account_number", "notes", mode="before")
    @classmethod
    def _strip_optional_strs(cls, v: object) -> object:
        if v is None:
            return None
        s = str(v).strip()
        return s or None

    @field_validator("account_number", mode="before")
    @classmethod
    def _digits_only_account_number(cls, v: object) -> object:
        if v is None:
            return None
        s = str(v).strip()
        if not s:
            return None
        if not s.isdigit():
            raise ValueError("account_number must contain digits only")
        return s

    @model_validator(mode="after")
    def _conditional_required_fields(self):
        linked = self.user_id is not None
        if linked:
            return self

        missing: list[str] = []
        if not (self.full_name or "").strip():
            missing.append("full_name")
        if not (self.phone or "").strip():
            missing.append("phone")
        if not (self.address or "").strip():
            missing.append("address")
        if not (self.bank_name or "").strip():
            missing.append("bank_name")
        if not (self.account_number or "").strip():
            missing.append("account_number")

        if missing:
            raise ValueError(f"Missing required fields for standalone employee: {', '.join(missing)}")
        return self


class EmployeeAdminUpdate(BaseModel):
    full_name: Optional[str] = Field(None, min_length=1, max_length=500)
    address: Optional[str] = Field(None, max_length=4000)
    phone: Optional[str] = Field(None, max_length=100)
    bank_name: Optional[str] = Field(None, max_length=200)
    account_number: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = Field(None, max_length=8000)
    base_salary: Optional[Decimal] = Field(None, ge=0)
    user_id: Optional[int] = None

    @field_validator("bank_name", mode="before")
    @classmethod
    def _strip_bank_name_opt(cls, v: object) -> object:
        if v is None:
            return None
        s = str(v).strip()
        return s or None

    @field_validator("account_number", mode="before")
    @classmethod
    def _digits_only_account_number(cls, v: object) -> object:
        if v is None:
            return None
        s = str(v).strip()
        if not s:
            return None
        if not s.isdigit():
            raise ValueError("account_number must contain digits only")
        return s


class EmployeeSelfUpdate(BaseModel):
    full_name: Optional[str] = Field(None, min_length=1, max_length=500)
    address: Optional[str] = Field(None, max_length=4000)
    phone: Optional[str] = Field(None, max_length=100)
    bank_name: Optional[str] = Field(None, max_length=200)
    account_number: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = Field(None, max_length=8000)

    @field_validator("bank_name", mode="before")
    @classmethod
    def _strip_bank_name_self(cls, v: object) -> object:
        if v is None:
            return None
        s = str(v).strip()
        return s or None

    @field_validator("account_number", mode="before")
    @classmethod
    def _digits_only_account_number(cls, v: object) -> object:
        if v is None:
            return None
        s = str(v).strip()
        if not s:
            return None
        if not s.isdigit():
            raise ValueError("account_number must contain digits only")
        return s


class EmployeePenaltyCreate(BaseModel):
    description: str = Field(..., min_length=1, max_length=2000)
    amount: Decimal = Field(..., ge=0)
    confirm_financial_edit: bool = False


class EmployeeBonusCreate(BaseModel):
    description: str = Field(..., min_length=1, max_length=2000)
    amount: Decimal = Field(..., ge=0)
    confirm_financial_edit: bool = False


class EmployeeLatenessCreate(BaseModel):
    note: Optional[str] = Field(None, max_length=2000)
    confirm_financial_edit: bool = False


class EmployeePaymentUpdate(BaseModel):
    payment_status: Literal["paid", "unpaid"]
    payment_date: Optional[datetime] = None
    payment_reference: Optional[str] = Field(None, max_length=500)


# --- Contract employees + unified transactions ledger ---


ContractEmployeeStatus = Literal["active", "inactive"]
EmployeeTxnType = Literal["owed_increase", "owed_decrease", "payment", "reversal"]
# Payment lifecycle:
# requested -> approved_by_admin -> sent_to_finance -> paid
# Note: legacy data may still contain status="pending" (treated as sent_to_finance by the API for compatibility).
EmployeeTxnStatus = Literal[
    "requested",
    "approved_by_admin",
    "sent_to_finance",
    # Request resolution rule: once Admin sends any amount to finance, the request intent is closed (even if partial).
    "resolved",
    "pending",
    "paid",
    "cancelled",
]


class EmployeePaymentAllocationOut(BaseModel):
    contract_job_id: int
    amount: Decimal

    class Config:
        from_attributes = True


class ContractEmployeeCreate(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=500)
    bank_name: Optional[str] = Field(None, max_length=200)
    account_number: Optional[str] = Field(None, max_length=100)
    phone: Optional[str] = Field(None, max_length=100)
    address: Optional[str] = Field(None, max_length=4000)
    status: ContractEmployeeStatus = "active"

    @field_validator("full_name", mode="before")
    @classmethod
    def _strip_full_name(cls, v: object) -> object:
        if v is None:
            return v
        return str(v).strip()

    @field_validator("account_number", mode="before")
    @classmethod
    def _digits_only_account_number(cls, v: object) -> object:
        if v is None:
            return None
        s = str(v).strip()
        if not s:
            return None
        if not s.isdigit():
            raise ValueError("account_number must contain digits only")
        return s


class ContractEmployeeUpdate(BaseModel):
    full_name: Optional[str] = Field(None, min_length=1, max_length=500)
    bank_name: Optional[str] = Field(None, max_length=200)
    account_number: Optional[str] = Field(None, max_length=100)
    phone: Optional[str] = Field(None, max_length=100)
    address: Optional[str] = Field(None, max_length=4000)
    status: Optional[ContractEmployeeStatus] = None

    @field_validator("account_number", mode="before")
    @classmethod
    def _digits_only_account_number(cls, v: object) -> object:
        if v is None:
            return None
        s = str(v).strip()
        if not s:
            return None
        if not s.isdigit():
            raise ValueError("account_number must contain digits only")
        return s


class ContractEmployeeListItemOut(BaseModel):
    id: int
    full_name: str
    bank_name: Optional[str] = None
    account_number: Optional[str] = None
    phone: Optional[str] = None
    status: ContractEmployeeStatus
    total_paid: Decimal
    balance: Decimal
    active_jobs_count: int = 0
    pending_requests: int = 0
    unread_pending_requests: int = 0

    @computed_field(return_type=Decimal)
    @property
    def total(self) -> Decimal:
        # Total lifetime earnings: what has been paid + what remains in balance.
        return (self.total_paid or Decimal("0")) + (self.balance or Decimal("0"))

    class Config:
        from_attributes = True


class EmployeeTransactionOut(BaseModel):
    id: int
    created_at: datetime
    paid_at: Optional[datetime] = None
    contract_job_id: Optional[int] = None
    amount: Decimal
    txn_type: EmployeeTxnType
    status: EmployeeTxnStatus
    processed_by_role: Optional[str] = None
    processed_by: Optional[str] = None
    initiated_by: Optional[Literal["admin", "employee"]] = None
    note: Optional[str] = None
    receipt_url: Optional[str] = None
    running_balance: Optional[Decimal] = None
    reversal_of_id: Optional[int] = None
    cancelled_at: Optional[datetime] = None
    cancelled_reason: Optional[str] = None
    allocations: Optional[List[EmployeePaymentAllocationOut]] = None

    @field_serializer("created_at", "paid_at", "cancelled_at")
    def _serialize_txn_times(self, v: Optional[datetime]) -> Optional[datetime]:
        return datetime_for_api(v) if v is not None else None

    class Config:
        from_attributes = True


class ContractEmployeeOut(ContractEmployeeListItemOut):
    address: Optional[str] = None
    transactions: List[EmployeeTransactionOut] = []
    created_at: datetime
    updated_at: Optional[datetime] = None


class ContractEmployeeMeOut(BaseModel):
    """Contract employee portal profile payload."""

    id: int
    full_name: str
    bank_name: Optional[str] = None
    account_number: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    status: ContractEmployeeStatus
    total_paid: Decimal
    balance: Decimal
    needs_profile_completion: bool = False
    needs_password_change: bool = False
    created_at: datetime
    updated_at: Optional[datetime] = None

    @computed_field(return_type=Decimal)
    @property
    def total(self) -> Decimal:
        return (self.total_paid or Decimal("0")) + (self.balance or Decimal("0"))

    class Config:
        from_attributes = True


class ContractEmployeeMeUpdate(BaseModel):
    full_name: Optional[str] = Field(None, min_length=1, max_length=500)
    bank_name: Optional[str] = Field(None, max_length=200)
    account_number: Optional[str] = Field(None, max_length=100)
    phone: Optional[str] = Field(None, max_length=100)
    address: Optional[str] = Field(None, max_length=4000)

    @field_validator("account_number", mode="before")
    @classmethod
    def _digits_only_account_number(cls, v: object) -> object:
        if v is None:
            return None
        s = str(v).strip()
        if not s:
            return None
        if not s.isdigit():
            raise ValueError("account_number must contain digits only")
        return s



class ContractEmployeeLinkUser(BaseModel):
    user_id: int = Field(..., gt=0, description="User id with role=contract_employee")


# --- Contract jobs ---

ContractJobStatus = Literal["pending", "in_progress", "completed", "cancelled"]
ContractJobPaymentState = Literal["not_paid", "partially_paid", "fully_paid"]


class ContractJobCreateAdmin(BaseModel):
    contract_employee_id: int = Field(..., gt=0)
    description: str = Field(..., min_length=1, max_length=4000)
    image_url: Optional[str] = Field(None, max_length=2000)
    price_offer: Optional[Decimal] = Field(None, gt=0)

    @field_validator("description", mode="before")
    @classmethod
    def _strip_desc(cls, v: object) -> object:
        if v is None:
            return v
        return str(v).strip()


class ContractJobCreateEmployee(BaseModel):
    description: str = Field(..., min_length=1, max_length=4000)
    image_url: Optional[str] = Field(None, max_length=2000)
    price_offer: Optional[Decimal] = Field(None, gt=0)

    @field_validator("description", mode="before")
    @classmethod
    def _strip_desc(cls, v: object) -> object:
        if v is None:
            return v
        return str(v).strip()


class ContractJobOfferUpdate(BaseModel):
    price_offer: Decimal = Field(..., gt=0)
    note: Optional[str] = Field(None, max_length=2000)

    @field_validator("note", mode="before")
    @classmethod
    def _strip_note(cls, v: object) -> object:
        if v is None:
            return None
        s = str(v).strip()
        return s or None


class ContractJobCancelBody(BaseModel):
    note: str = Field(..., min_length=1, max_length=4000)


class ContractJobNegotiationEventOut(BaseModel):
    id: int
    kind: str
    offer_price: Decimal
    note: Optional[str] = None
    actor_user_id: Optional[int] = None
    actor_role: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class ContractJobOut(BaseModel):
    id: int
    contract_employee_id: int
    contract_employee_name: Optional[str] = None
    description: str
    image_url: Optional[str] = None
    price_offer: Optional[Decimal] = None
    last_offer_by_role: Optional[Literal["admin", "contract_employee"]] = None
    offer_updated_at: Optional[datetime] = None
    offer_version: int = 0
    negotiation_occurred: bool = False
    admin_accepted_at: Optional[datetime] = None
    employee_accepted_at: Optional[datetime] = None
    # Compatibility flags for UI/state rules.
    adminAccepted: bool = False
    employeeAccepted: bool = False
    hasNegotiation: bool = False
    final_price: Optional[Decimal] = None
    amount_paid: Decimal = Decimal("0")
    balance: Optional[Decimal] = None
    payment_state: ContractJobPaymentState = "not_paid"
    price_accepted_at: Optional[datetime] = None
    status: ContractJobStatus
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    cancelled_note: Optional[str] = None
    paid_flag: bool = False
    linked_transactions: List[EmployeeTransactionOut] = []
    negotiation_history: List[ContractJobNegotiationEventOut] = []

    class Config:
        from_attributes = True


# --- Notifications ---

NotificationKind = Literal[
    "job_assigned",
    "price_updated",
    "price_accepted",
    "job_cancelled",
    "payment_request_submitted",
    "payment_approved",
    "payment_sent_to_finance",
    "payment_completed",
    "system",
]


class NotificationOut(BaseModel):
    id: int
    kind: NotificationKind
    title: str
    message: Optional[str] = None
    entity_type: Optional[str] = None
    entity_id: Optional[int] = None
    created_at: datetime
    read_at: Optional[datetime] = None

    @field_serializer("created_at", "read_at")
    def _serialize_notification_times(self, v: Optional[datetime]) -> Optional[datetime]:
        return datetime_for_api(v) if v is not None else None

    class Config:
        from_attributes = True


class NotificationsPage(BaseModel):
    items: List[NotificationOut]
    unread_count: int


class ContractEmployeeIncreaseOwed(BaseModel):
    amount: Decimal = Field(..., gt=0)
    note: str = Field(..., min_length=1, max_length=2000)

    @field_validator("note", mode="before")
    @classmethod
    def _strip_note(cls, v: object) -> object:
        if v is None:
            return ""
        return str(v).strip()


class ContractEmployeeDecreaseOwed(BaseModel):
    amount: Decimal = Field(..., gt=0)
    note: str = Field(..., min_length=1, max_length=2000)

    @field_validator("note", mode="before")
    @classmethod
    def _strip_note_req(cls, v: object) -> object:
        if v is None:
            return ""
        return str(v).strip()


class EmployeeSendPaymentToFinance(BaseModel):
    amount: Decimal = Field(..., gt=0)
    note: Optional[str] = Field(None, max_length=2000)
    contract_job_id: Optional[int] = Field(None, gt=0)

    @field_validator("note", mode="before")
    @classmethod
    def _strip_note(cls, v: object) -> object:
        if v is None:
            return None
        s = str(v).strip()
        return s or None


class ContractEmployeeSendPaymentToFinanceIn(BaseModel):
    """Admin step: send a specific contract payment request to Finance."""

    request_id: int = Field(..., gt=0, description="EmployeeTransaction.id of the payment request to send.")
    amount: Decimal = Field(..., gt=0, description="Amount to pay now (can be partial, must be <= request amount).")
    note: Optional[str] = Field(None, max_length=2000)
    contract_job_id: Optional[int] = Field(None, gt=0)

    @field_validator("note", mode="before")
    @classmethod
    def _strip_note_req(cls, v: object) -> object:
        if v is None:
            return None
        s = str(v).strip()
        return s or None


class EmployeePaymentAllocationIn(BaseModel):
    contract_job_id: int = Field(..., gt=0)
    amount: Decimal = Field(..., gt=0)


class EmployeePaymentMarkPaidIn(BaseModel):
    amount_override: Optional[Decimal] = Field(None, gt=0, description="Optional adjusted amount to pay.")
    allocations: List[EmployeePaymentAllocationIn] = Field(..., min_length=1)


class ContractJobFinanceRow(BaseModel):
    id: int
    status: str
    final_price: Optional[Decimal] = None
    amount_paid: Decimal
    balance: Optional[Decimal] = None


class ContractEmployeeFinanceOut(BaseModel):
    id: int
    full_name: str
    total_paid: Decimal
    balance: Decimal
    pending_payment: Optional[EmployeeTransactionOut] = None
    jobs: List[ContractJobFinanceRow] = []
    transactions: List[EmployeeTransactionOut] = []

    @computed_field(return_type=Decimal)
    @property
    def total(self) -> Decimal:
        return (self.total_paid or Decimal("0")) + (self.balance or Decimal("0"))


class PendingEmployeePaymentItem(BaseModel):
    transaction: EmployeeTransactionOut
    employee_kind: Literal["monthly", "contract"]
    employee_id: int
    employee_name: str
    account_number: Optional[str] = None
    phone: Optional[str] = None
    period_label: Optional[str] = None
    # When the item entered the finance queue (best-effort; falls back to transaction.created_at).
    sent_to_finance_at: Optional[datetime] = None
    initiated_by: Optional[Literal["admin", "employee"]] = None
    notification_unread: bool = False


class EmployeePaymentsPageOut(BaseModel):
    """Paginated list of employee payment transactions (pending or history)."""

    total_pending_amount: Decimal = Field(default=Decimal("0"), description="Sum of amounts across ALL matching items (not just this page).")
    total: int = 0
    limit: int = 20
    offset: int = 0
    items: List[PendingEmployeePaymentItem]


# Backward-compatible alias (older frontend expects this name).
class PendingEmployeePaymentsOut(EmployeePaymentsPageOut):
    pass


class AdminApprovePaymentRequestIn(BaseModel):
    """Admin step: approve a request and optionally adjust the amount."""

    amount_override: Optional[Decimal] = Field(None, gt=0)
    note: Optional[str] = Field(None, max_length=2000)


class AdminSendPaymentToFinanceIn(BaseModel):
    """Admin step: send an approved request to Finance."""

    note: Optional[str] = Field(None, max_length=2000)


class ContractJobMiniOut(BaseModel):
    id: int
    status: str
    final_price: Optional[Decimal] = None


class PaymentRequestDetailOut(BaseModel):
    transaction: EmployeeTransactionOut
    employee_kind: Literal["monthly", "contract"]
    employee_id: int
    employee_name: str
    bank_name: Optional[str] = None
    account_number: Optional[str] = None
    requested_amount: Decimal
    adjusted_amount: Optional[Decimal] = None
    jobs: list[ContractJobMiniOut] = []
    note: Optional[str] = None


# --- Expense / petty cash ---

ExpenseEntryType = Literal["expense", "credit"]


class ExpenseEntryCreate(BaseModel):
    entry_date: datetime
    amount: Decimal = Field(..., gt=0)
    entry_type: ExpenseEntryType
    note: Optional[str] = Field(None, max_length=4000)


class ExpenseEntryUpdate(BaseModel):
    amount: Optional[Decimal] = Field(None, gt=0)
    entry_type: Optional[ExpenseEntryType] = None
    note: Optional[str] = Field(None, max_length=4000)


class ExpenseEntryOut(BaseModel):
    id: int
    entry_date: datetime
    amount: Decimal
    entry_type: ExpenseEntryType
    note: Optional[str] = None
    receipt_url: Optional[str] = None
    processed_by_role: Optional[str] = None
    processed_by: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class ExpenseSummaryOut(BaseModel):
    total_received: Decimal
    total_expenses: Decimal
    balance: Decimal
    today_total: Decimal


class ExpenseEntriesPageOut(BaseModel):
    items: List[ExpenseEntryOut]
    total: int = 0
    limit: int = 20
    offset: int = 0


# --- Production material tracking ---


ProductionMaterialSection = Literal["painters_dept", "mdf_section"]
ProductionMaterialTxnType = Literal["allocation", "reversal"]
ProductionMaterialTxnStatus = Literal["active", "voided", "superseded"]


class ProductionMaterialTypeCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    default_unit: Optional[str] = Field(None, max_length=50)


class ProductionMaterialTypeUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    default_unit: Optional[str] = Field(None, max_length=50)
    is_active: Optional[bool] = None


class ProductionMaterialTypeOut(BaseModel):
    id: int
    section: ProductionMaterialSection
    name: str
    default_unit: Optional[str] = None
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True

    @field_serializer("created_at")
    def _ser_created_at(self, v: datetime) -> datetime:
        return datetime_for_api(v)


class ProductionMaterialAssignmentCreate(BaseModel):
    contract_employee_id: int = Field(..., gt=0)


class ProductionMaterialAssignmentOut(BaseModel):
    id: int
    section: ProductionMaterialSection
    contract_employee_id: int
    full_name: str
    assigned_at: datetime
    assigned_by: Optional[str] = None

    class Config:
        from_attributes = True

    @field_serializer("assigned_at")
    def _ser_assigned_at(self, v: datetime) -> datetime:
        return datetime_for_api(v)


class ProductionMaterialTotalOut(BaseModel):
    material_type_id: Optional[int] = None
    material_name: str
    unit: Optional[str] = None
    total_quantity: Decimal


class ProductionMaterialDisplayColumnOut(BaseModel):
    material_type_id: Optional[int] = None
    material_name: str
    unit: Optional[str] = None
    is_selectable: bool = True


class ProductionMaterialEmployeeRowOut(BaseModel):
    assignment_id: int
    contract_employee_id: int
    full_name: str
    material_totals: List[ProductionMaterialTotalOut]


class ProductionMaterialSectionOverviewOut(BaseModel):
    section: ProductionMaterialSection
    section_label: str
    material_types: List[ProductionMaterialTypeOut]
    display_columns: List[ProductionMaterialDisplayColumnOut]
    employees: List[ProductionMaterialEmployeeRowOut]
    section_totals: List[ProductionMaterialTotalOut]


class ProductionMaterialTransactionCreate(BaseModel):
    material_type_id: int = Field(..., gt=0)
    quantity: Decimal = Field(..., gt=0)
    unit: Optional[str] = Field(None, max_length=50)
    transaction_at: datetime
    notes: Optional[str] = Field(None, max_length=4000)


class ProductionMaterialTransactionUpdate(BaseModel):
    material_type_id: Optional[int] = Field(None, gt=0)
    quantity: Optional[Decimal] = Field(None, gt=0)
    unit: Optional[str] = Field(None, max_length=50)
    transaction_at: Optional[datetime] = None
    notes: Optional[str] = Field(None, max_length=4000)


class ProductionMaterialTransactionReverse(BaseModel):
    quantity: Optional[Decimal] = Field(None, gt=0)
    notes: Optional[str] = Field(None, max_length=4000)
    transaction_at: Optional[datetime] = None


class ProductionMaterialTransactionVoid(BaseModel):
    reason: Optional[str] = Field(None, max_length=4000)


class ProductionMaterialTransactionOut(BaseModel):
    id: int
    section: ProductionMaterialSection
    contract_employee_id: int
    material_type_id: Optional[int] = None
    material_name: str
    quantity: Decimal
    unit: Optional[str] = None
    txn_type: ProductionMaterialTxnType
    notes: Optional[str] = None
    given_by: Optional[str] = None
    transaction_at: datetime
    created_at: datetime
    status: ProductionMaterialTxnStatus
    effective_quantity: Decimal
    reversal_of_id: Optional[int] = None
    supersedes_id: Optional[int] = None
    superseded_by_id: Optional[int] = None
    void_reason: Optional[str] = None

    class Config:
        from_attributes = True

    @field_serializer("transaction_at", "created_at")
    def _ser_dt(self, v: datetime) -> datetime:
        return datetime_for_api(v)


class ProductionMaterialContractEmployeeOption(BaseModel):
    id: int
    full_name: str
    status: str
    assigned_to_section: bool = False