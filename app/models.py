from sqlalchemy import Boolean, Column, Integer, String, Float, Numeric, Text, UniqueConstraint, Date
from app.db.base_class import Base
from sqlalchemy import ForeignKey, DateTime
from sqlalchemy.orm import relationship, backref
from datetime import datetime
from sqlalchemy import JSON


class Draft(Base):
    __tablename__ = "drafts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    # Module key (one active draft per module per user).
    module = Column(String(64), nullable=False, index=True)
    # JSON payload representing the form state.
    data = Column(JSON, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    __table_args__ = (UniqueConstraint("user_id", "module", name="uq_drafts_user_module"),)

# USERS TABLE
class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    email = Column(String, unique=True, index=True)
    password = Column(String)
    role = Column(String)
    # Enforce first-login password change (used for contract employees and admin resets).
    must_change_password = Column(Boolean, nullable=False, default=False, server_default="false", index=True)
    password_changed_at = Column(DateTime, nullable=True)


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
    # New (preferred): array of URLs for multi-image upload. Kept nullable for backward compatibility.
    image_urls = Column(JSON, nullable=True)
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
    # "item" (default) or "subheading" (section title row in documents)
    line_type = Column(String, nullable=False, server_default="item")
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
    # "item" (default) or "subheading" (section title row in documents)
    line_type = Column(String, nullable=False, server_default="item")
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
    # "item" (default) or "subheading" (section title row in documents)
    line_type = Column(String, nullable=False, server_default="item")
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


class FactoryTool(Base):
    """Named factory tools (check-out / return tracking)."""

    __tablename__ = "factory_tools"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    notes = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    created_by_user = relationship("User", foreign_keys=[created_by_id])
    tracking_records = relationship("ToolTrackingRecord", back_populates="tool")


class ToolTrackingRecord(Base):
    """Single check-out event; returned_at null means tool still out."""

    __tablename__ = "tool_tracking_records"

    id = Column(Integer, primary_key=True, index=True)
    tool_id = Column(Integer, ForeignKey("factory_tools.id", ondelete="CASCADE"), nullable=False, index=True)
    checkout_at = Column(DateTime, nullable=False, index=True)
    returned_at = Column(DateTime, nullable=True, index=True)
    borrower_name = Column(String, nullable=True)
    notes = Column(String, nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    tool = relationship("FactoryTool", back_populates="tracking_records")
    created_by_user = relationship("User", foreign_keys=[created_by_id])


class FactoryMachine(Base):
    """Factory machines (usage + status similar to inventory materials)."""

    __tablename__ = "factory_machines"

    id = Column(Integer, primary_key=True, index=True)
    machine_name = Column(String, nullable=False)
    category = Column(String, nullable=True)
    serial_number = Column(String, nullable=True)
    location = Column(String, nullable=True)
    # available | in_use | maintenance
    status = Column(String, nullable=False, default="available")
    notes = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    updated_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    created_by_user = relationship("User", foreign_keys=[created_by_id])
    updated_by_user = relationship("User", foreign_keys=[updated_by_id])
    activities = relationship(
        "MachineActivity",
        back_populates="machine",
        cascade="all, delete-orphan",
    )


class MachineActivity(Base):
    """Append-only activity / usage log for a machine."""

    __tablename__ = "machine_activities"

    id = Column(Integer, primary_key=True, index=True)
    machine_id = Column(Integer, ForeignKey("factory_machines.id", ondelete="CASCADE"), nullable=False, index=True)
    # usage_start | usage_end | status_change | note
    kind = Column(String, nullable=False)
    message = Column(String, nullable=True)
    meta = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    machine = relationship("FactoryMachine", back_populates="activities")
    created_by_user = relationship("User", foreign_keys=[created_by_id])


class CompanyLocation(Base):
    """Reusable company-wide work locations for geo-attendance validation."""

    __tablename__ = "company_locations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False, unique=True, index=True)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    allowed_radius_meters = Column(Integer, nullable=False, default=0, server_default="0")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class SalaryPeriod(Base):
    """Calendar month bucket for payroll (lateness, penalties, bonuses, payment status)."""

    __tablename__ = "salary_periods"

    id = Column(Integer, primary_key=True, index=True)
    year = Column(Integer, nullable=False)
    month = Column(Integer, nullable=False)
    label = Column(String(64), nullable=False)
    # Exactly one period should be active: the current editable payroll month.
    is_active = Column(Boolean, nullable=False, default=False, server_default="false")
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("year", "month", name="uq_salary_periods_year_month"),)


class Employee(Base):
    """HR / payroll employee record (separate from app User; optional link via user_id)."""

    __tablename__ = "employees"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String, nullable=False)
    address = Column(Text, nullable=True)
    phone = Column(String, nullable=True)
    bank_name = Column(String, nullable=True)
    account_number = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    base_salary = Column(Numeric(14, 2), nullable=False, default=0)
    # JSON: [{ "id": str, "url": str, "label": str | null, "uploaded_at": str }]
    documents = Column(JSON, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, unique=True, index=True)
    # Optional geo-attendance assigned work location (Monthly Employees only; enforced at API layer).
    work_location_id = Column(Integer, ForeignKey("company_locations.id", ondelete="SET NULL"), nullable=True, index=True)
    deleted_at = Column(DateTime, nullable=True, index=True)
    deleted_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship(
        "User",
        foreign_keys=[user_id],
        backref=backref("employee_record", uselist=False),
    )
    deleted_by = relationship("User", foreign_keys=[deleted_by_id])
    work_location = relationship("CompanyLocation", foreign_keys=[work_location_id])
    lateness_entries = relationship(
        "EmployeeLatenessEntry",
        back_populates="employee",
        cascade="all, delete-orphan",
        order_by="EmployeeLatenessEntry.id",
    )
    penalties = relationship(
        "EmployeePenalty",
        back_populates="employee",
        cascade="all, delete-orphan",
        order_by="EmployeePenalty.id",
    )
    bonuses = relationship(
        "EmployeeBonus",
        back_populates="employee",
        cascade="all, delete-orphan",
        order_by="EmployeeBonus.id",
    )
    period_payrolls = relationship(
        "EmployeePeriodPayroll",
        back_populates="employee",
        cascade="all, delete-orphan",
    )


class EmployeePeriodPayroll(Base):
    """Per-employee, per-month payment state (prevents double-pay; optional audit)."""

    __tablename__ = "employee_period_payroll"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    period_id = Column(Integer, ForeignKey("salary_periods.id", ondelete="CASCADE"), nullable=False, index=True)
    payment_status = Column(String(16), nullable=False, default="unpaid")
    payment_date = Column(DateTime, nullable=True)
    payment_reference = Column(String(500), nullable=True)
    # Payroll adjustments (per period). These are optional and additive to the base payroll system.
    # - period_base_salary overrides Employee.base_salary for this period only when set.
    # - bonus/deduction/late_penalty are stored as positive numbers; they are applied in salary calculation.
    period_base_salary = Column(Numeric(14, 2), nullable=True)
    adjustment_bonus = Column(Numeric(14, 2), nullable=False, default=0)
    adjustment_deduction = Column(Numeric(14, 2), nullable=False, default=0)
    adjustment_late_penalty = Column(Numeric(14, 2), nullable=False, default=0)
    adjustment_note = Column(Text, nullable=True)
    updated_at = Column(DateTime, nullable=True)
    updated_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    __table_args__ = (UniqueConstraint("employee_id", "period_id", name="uq_employee_period_payroll_emp_period"),)

    employee = relationship("Employee", back_populates="period_payrolls")
    period = relationship("SalaryPeriod")
    updated_by = relationship("User", foreign_keys=[updated_by_id])


class EmployeeLatenessEntry(Base):
    """One lateness instance; deduction = count × ₦500 (constant in application code)."""

    __tablename__ = "employee_lateness_entries"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    period_id = Column(Integer, ForeignKey("salary_periods.id", ondelete="CASCADE"), nullable=False, index=True)
    # Optional link to a daily attendance record (Monthly Employees attendance system).
    # When set, attendance_id is unique to prevent duplicate lateness deductions for the same day.
    attendance_id = Column(Integer, ForeignKey("employee_attendance_entries.id", ondelete="SET NULL"), nullable=True, index=True)
    note = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    voided_at = Column(DateTime, nullable=True, index=True)
    voided_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    void_reason = Column(String, nullable=True)

    employee = relationship("Employee", back_populates="lateness_entries")
    period = relationship("SalaryPeriod")
    attendance = relationship("EmployeeAttendanceEntry", back_populates="lateness_entry", foreign_keys=[attendance_id])
    voided_by_user = relationship("User", foreign_keys=[voided_by_id])


class EmployeeAttendanceEntry(Base):
    """Monthly employee attendance (manual clock-in; one row per employee per date; Sundays excluded by API rules)."""

    __tablename__ = "employee_attendance_entries"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    period_id = Column(Integer, ForeignKey("salary_periods.id", ondelete="CASCADE"), nullable=False, index=True)

    attendance_date = Column(Date, nullable=False, index=True)
    check_in_at = Column(DateTime, nullable=False, index=True)
    is_late = Column(Boolean, nullable=False, default=False, server_default="false", index=True)
    late_minutes = Column(Integer, nullable=True)

    # Geo-attendance snapshot captured at clock-in (no manual entry).
    work_location_id = Column(Integer, ForeignKey("company_locations.id", ondelete="SET NULL"), nullable=True, index=True)
    employee_latitude = Column(Float, nullable=True)
    employee_longitude = Column(Float, nullable=True)
    distance_meters = Column(Float, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    __table_args__ = (UniqueConstraint("employee_id", "attendance_date", name="uq_employee_attendance_emp_date"),)

    employee = relationship("Employee")
    period = relationship("SalaryPeriod")
    work_location = relationship("CompanyLocation", foreign_keys=[work_location_id])
    lateness_entry = relationship(
        "EmployeeLatenessEntry",
        back_populates="attendance",
        uselist=False,
        primaryjoin="EmployeeAttendanceEntry.id==EmployeeLatenessEntry.attendance_id",
    )

class EmployeePenalty(Base):
    __tablename__ = "employee_penalties"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    period_id = Column(Integer, ForeignKey("salary_periods.id", ondelete="CASCADE"), nullable=False, index=True)
    description = Column(String, nullable=False)
    amount = Column(Numeric(14, 2), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    voided_at = Column(DateTime, nullable=True, index=True)
    voided_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    void_reason = Column(String, nullable=True)

    employee = relationship("Employee", back_populates="penalties")
    period = relationship("SalaryPeriod")
    voided_by_user = relationship("User", foreign_keys=[voided_by_id])


class EmployeeBonus(Base):
    __tablename__ = "employee_bonuses"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    period_id = Column(Integer, ForeignKey("salary_periods.id", ondelete="CASCADE"), nullable=False, index=True)
    description = Column(String, nullable=False)
    amount = Column(Numeric(14, 2), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    voided_at = Column(DateTime, nullable=True, index=True)
    voided_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    void_reason = Column(String, nullable=True)

    employee = relationship("Employee", back_populates="bonuses")
    period = relationship("SalaryPeriod")
    voided_by_user = relationship("User", foreign_keys=[voided_by_id])


# --- Contract employees (non-payroll) + unified ledger ---


class ContractEmployee(Base):
    """Contract/adhoc employees with owed + payment ledger."""

    __tablename__ = "contract_employees"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String, nullable=False)
    bank_name = Column(String, nullable=True)
    account_number = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    address = Column(Text, nullable=True)
    status = Column(String, nullable=False, default="active")  # active | inactive

    # Dedicated login for contract employees (optional link to app users).
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, unique=True, index=True)

    total_owed = Column(Numeric(14, 2), nullable=False, default=0)
    total_paid = Column(Numeric(14, 2), nullable=False, default=0)
    # Balance = total_owed - total_paid (positive => company owes employee)
    balance = Column(Numeric(14, 2), nullable=False, default=0)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", backref=backref("contract_employee_record", uselist=False))
    transactions = relationship(
        "EmployeeTransaction",
        back_populates="contract_employee",
        cascade="all, delete-orphan",
        order_by="EmployeeTransaction.id",
    )
    jobs = relationship(
        "ContractJob",
        back_populates="contract_employee",
        cascade="all, delete-orphan",
        order_by="ContractJob.id",
    )


class ContractJob(Base):
    """Contract employee job lifecycle with price lock and timeline."""

    __tablename__ = "contract_jobs"

    id = Column(Integer, primary_key=True, index=True)
    contract_employee_id = Column(Integer, ForeignKey("contract_employees.id", ondelete="CASCADE"), nullable=False, index=True)

    created_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_by_role = Column(String, nullable=True)  # admin | contract_employee

    # Human-readable job description (required by API; stored non-null for consistency).
    description = Column(Text, nullable=False, default="", server_default="")

    # Single image URL (Cloudinary). (If multi-image becomes required, mirror Order.image_urls approach.)
    image_url = Column(String, nullable=True)

    # Current offer before acceptance (can change via renegotiation). Final price is locked after employee acceptance.
    price_offer = Column(Numeric(14, 2), nullable=True)
    # Tracks who last updated `price_offer` (admin | contract_employee). Used for acceptance rules + badges.
    last_offer_by_role = Column(String, nullable=True, index=True)  # admin | contract_employee
    offer_updated_at = Column(DateTime, nullable=True, index=True)
    offer_version = Column(Integer, nullable=False, default=0, server_default="0", index=True)

    # Negotiation and acceptance state:
    # - negotiation_occurred becomes True once the offer has changed after an initial proposal.
    # - acceptance timestamps are per party and reset whenever the offer changes.
    negotiation_occurred = Column(Boolean, nullable=False, default=False, server_default="false", index=True)
    admin_accepted_at = Column(DateTime, nullable=True, index=True)
    employee_accepted_at = Column(DateTime, nullable=True, index=True)

    final_price = Column(Numeric(14, 2), nullable=True)
    price_accepted_at = Column(DateTime, nullable=True, index=True)

    status = Column(String, nullable=False, default="pending")  # pending | in_progress | completed | cancelled

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    started_at = Column(DateTime, nullable=True, index=True)
    completed_at = Column(DateTime, nullable=True, index=True)

    cancelled_at = Column(DateTime, nullable=True, index=True)
    cancelled_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    cancelled_note = Column(String(4000), nullable=True)

    # Manual admin/portal flag used by the daily reminder modal.
    # Important: this is informational only and does NOT affect any money calculations.
    paid_flag = Column(Boolean, nullable=False, default=False, server_default="false", index=True)

    contract_employee = relationship("ContractEmployee", back_populates="jobs")
    created_by_user = relationship("User", foreign_keys=[created_by_id])
    cancelled_by_user = relationship("User", foreign_keys=[cancelled_by_id])
    linked_transactions = relationship(
        "EmployeeTransaction",
        back_populates="contract_job",
        order_by="EmployeeTransaction.id",
    )
    negotiation_events = relationship(
        "ContractJobNegotiationEvent",
        back_populates="contract_job",
        cascade="all, delete-orphan",
        order_by="ContractJobNegotiationEvent.id",
    )


class ContractJobNegotiationEvent(Base):
    """Append-only negotiation timeline for a contract job (offer updates + optional notes)."""

    __tablename__ = "contract_job_negotiation_events"

    id = Column(Integer, primary_key=True, index=True)
    contract_job_id = Column(
        Integer,
        ForeignKey("contract_jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # offer_update (future-proofed in case we add other negotiation timeline events later)
    kind = Column(String(64), nullable=False, default="offer_update", server_default="offer_update", index=True)
    offer_price = Column(Numeric(14, 2), nullable=False)
    note = Column(String(2000), nullable=True)

    actor_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    actor_role = Column(String(64), nullable=True, index=True)  # admin | contract_employee | ...
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    contract_job = relationship("ContractJob", back_populates="negotiation_events")
    actor_user = relationship("User", foreign_keys=[actor_user_id])


class Notification(Base):
    """User notifications (supports 'real-time' polling + persistent badges)."""

    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    recipient_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    # job_assigned | price_updated | job_cancelled | payment_request_submitted | system
    kind = Column(String(64), nullable=False, index=True)
    title = Column(String(300), nullable=False)
    message = Column(String(4000), nullable=True)
    entity_type = Column(String(64), nullable=True, index=True)  # contract_job | employee_transaction | ...
    entity_id = Column(Integer, nullable=True, index=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    read_at = Column(DateTime, nullable=True, index=True)

    recipient_user = relationship("User", foreign_keys=[recipient_user_id])


class EmployeeTransaction(Base):
    """Append-only transaction ledger for employee payments and owed increases.

    - `status=pending` records a request awaiting Finance (or Admin) confirmation.
    - Once `status=paid`, the row is locked (no overwrites; only receipt can be attached before paid).
    """

    __tablename__ = "employee_transactions"

    id = Column(Integer, primary_key=True, index=True)
    # One of these is set (monthly payroll employee vs contract employee)
    employee_id = Column(Integer, ForeignKey("employees.id", ondelete="CASCADE"), nullable=True, index=True)
    contract_employee_id = Column(
        Integer, ForeignKey("contract_employees.id", ondelete="CASCADE"), nullable=True, index=True
    )
    contract_job_id = Column(Integer, ForeignKey("contract_jobs.id", ondelete="SET NULL"), nullable=True, index=True)
    # Optional payroll period link for monthly employees
    period_id = Column(Integer, ForeignKey("salary_periods.id", ondelete="CASCADE"), nullable=True, index=True)

    txn_type = Column(String, nullable=False)  # owed_increase | owed_decrease | payment | reversal
    amount = Column(Numeric(14, 2), nullable=False)
    status = Column(String, nullable=False, default="pending")  # pending | paid | cancelled

    note = Column(String, nullable=True)
    receipt_url = Column(String, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    paid_at = Column(DateTime, nullable=True, index=True)

    cancelled_at = Column(DateTime, nullable=True, index=True)
    cancelled_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    cancelled_reason = Column(String(4000), nullable=True)

    created_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    processed_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    processed_by_role = Column(String, nullable=True)  # admin | finance

    # Running balance after applying this txn (contract employees only; set when paid)
    running_balance = Column(Numeric(14, 2), nullable=True)

    # Reversal system (append-only): a reversal creates a NEW row with reversal_of_id set.
    # Original transaction remains unchanged.
    reversal_of_id = Column(Integer, ForeignKey("employee_transactions.id", ondelete="SET NULL"), nullable=True, index=True)

    employee = relationship("Employee")
    contract_employee = relationship("ContractEmployee", back_populates="transactions")
    contract_job = relationship("ContractJob", back_populates="linked_transactions")
    period = relationship("SalaryPeriod")
    created_by_user = relationship("User", foreign_keys=[created_by_id])
    processed_by_user = relationship("User", foreign_keys=[processed_by_id])
    cancelled_by_user = relationship("User", foreign_keys=[cancelled_by_id])
    reversal_of = relationship("EmployeeTransaction", remote_side=[id], foreign_keys=[reversal_of_id])


class EmployeePaymentAllocation(Base):
    """Allocation lines for a payment transaction across contract jobs.

    Required for contract employee payments so every payment is tied to one or more jobs.
    """

    __tablename__ = "employee_payment_allocations"

    id = Column(Integer, primary_key=True, index=True)
    transaction_id = Column(
        Integer,
        ForeignKey("employee_transactions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    contract_job_id = Column(
        Integer,
        ForeignKey("contract_jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    amount = Column(Numeric(14, 2), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    voided_at = Column(DateTime, nullable=True, index=True)
    voided_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    void_reason = Column(String(4000), nullable=True)

    transaction = relationship("EmployeeTransaction", backref=backref("allocations", cascade="all, delete-orphan"))
    contract_job = relationship("ContractJob")
    voided_by_user = relationship("User", foreign_keys=[voided_by_id])

    __table_args__ = (
        UniqueConstraint("transaction_id", "contract_job_id", name="uq_employee_payment_allocations_txn_job"),
    )


# --- Financial audit log (append-only, no retention purge) ---


class FinancialAuditLog(Base):
    """Durable audit trail for financial actions (never purged)."""

    __tablename__ = "financial_audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    action = Column(String, nullable=False)  # send_to_finance | confirm_payment | reversal | expense_create | owed_increase | ...
    entity_type = Column(String, nullable=False)  # employee_transaction | contract_employee | expense_entry | ...
    entity_id = Column(Integer, nullable=True)
    actor_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    actor_username = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    meta = Column(JSON, nullable=True)


# --- Expense / petty cash (separate from employee payments) ---


class ExpenseEntry(Base):
    __tablename__ = "expense_entries"

    id = Column(Integer, primary_key=True, index=True)
    entry_date = Column(DateTime, nullable=False, index=True)
    amount = Column(Numeric(14, 2), nullable=False)
    entry_type = Column(String, nullable=False)  # expense | credit
    note = Column(String, nullable=True)
    receipt_url = Column(String, nullable=True)

    processed_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    processed_by_role = Column(String, nullable=True)  # admin | finance
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    processed_by_user = relationship("User", foreign_keys=[processed_by_id])