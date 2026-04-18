export type Role = "showroom" | "factory" | "admin";

export type LoginRequest = { email: string; password: string };
export type LoginResponse = { access_token: string; token_type: "bearer" | string };

export type ChangePasswordRequest = {
  current_password: string;
  new_password: string;
  confirm_password: string;
};

export type TrashItem = {
  entity_type: string;
  entity_id: number;
  deleted_at: string;
  deleted_by_id: number;
  deleted_by_username?: string | null;
  label: string;
};

export type ImpersonateResponse = {
  access_token: string;
  token_type: "bearer" | string;
  restore_token: string;
};

export type StopImpersonationRequest = { restore_token: string };

export type Customer = {
  id: number;
  name: string;
  phone?: string;
  address?: string;
  email?: string | null;
  birth_day?: number | null;
  birth_month?: number | null;
  /** Local-part of creator email, when known */
  created_by?: string | null;
};

export type CustomerCreate = {
  name: string;
  phone: string;
  address: string;
  email?: string | null;
  birth_day?: number | null;
  birth_month?: number | null;
};

export type OrderStatus = "pending" | "in_progress" | "completed" | "delivered";

export type OrderCreateItem = {
  line_type?: "item" | "subheading";
  item_name: string;
  description: string;
  quantity?: number;
  amount?: string | number | null;
};

export type OrderItem = {
  id: number;
  line_type?: "item" | "subheading";
  item_name: string;
  description?: string | null;
  quantity?: number;
  amount?: string | number | null;
};

export type Order = {
  id: number;
  status: OrderStatus;
  due_date?: string | null;
  created_at: string;
  image_url?: string | null;
  image_urls?: string[] | null;
  customer?: Customer | null;
  items: OrderItem[];
  total_price?: string | number | null;
  discount_type?: "fixed" | "percentage" | null;
  discount_value?: string | number | null;
  discount_amount?: string | number | null;
  final_price?: string | number | null;
  tax_percent?: string | number | null;
  tax?: string | number | null;
  total?: string | number | null;
  amount_paid?: string | number | null;
  balance?: string | number | null;
  payment_status?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_by_id?: number | null;
};

export type OrderUploadResponse = {
  order_id: number;
  customer_id: number;
  quantity: number;
  item_name: string;
  description?: string | null;
  image_url?: string | null;
  image_urls?: string[] | null;
  total_price?: string | number | null;
  amount_paid?: string | number | null;
  balance?: string | number | null;
  payment_status?: string | null;
  status: OrderStatus;
  due_date?: string | null;
};

export type User = {
  id: number;
  username: string;
  role: Role;
};

export type UserCreate = {
  username: string;
  password: string;
  role: Role;
};

export type InvoiceListItem = {
  id: number;
  invoice_number: string;
  order_id: number;
  customer_id: number;
  total_price?: string | number | null;
  deposit_paid?: string | number | null;
  balance?: string | number | null;
  status: string;
  created_at: string;
  due_date?: string | null;
  customer?: Customer | null;
  discount_type?: "fixed" | "percentage" | null;
  discount_value?: string | number | null;
  discount_amount?: string | number | null;
  final_price?: string | number | null;
  tax_percent?: string | number | null;
  tax?: string | number | null;
  total?: string | number | null;
  created_by?: string | null;
};

export type InvoiceDetail = InvoiceListItem & {
  items: OrderItem[];
};

export type ProformaItem = {
  id: number;
  line_type?: "item" | "subheading";
  item_name: string;
  description?: string | null;
  quantity?: number;
  amount?: string | number | null;
};

export type ProformaListItem = {
  id: number;
  proforma_number: string;
  status: string;
  customer_name: string;
  grand_total?: string | number | null;
  created_at: string;
  created_by?: string | null;
};

export type ProformaDetail = {
  id: number;
  proforma_number: string;
  status: string;
  customer_name: string;
  phone: string;
  address: string;
  email?: string | null;
  due_date?: string | null;
  items: ProformaItem[];
  discount_type?: "fixed" | "percentage" | null;
  discount_value?: string | number | null;
  discount_amount?: string | number | null;
  tax_percent?: string | number | null;
  tax?: string | number | null;
  subtotal?: string | number | null;
  final_price?: string | number | null;
  grand_total?: string | number | null;
  created_at: string;
  updated_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  converted_order_id?: number | null;
};

export type ProformaPayload = {
  customer_name: string;
  phone: string;
  address: string;
  email?: string | null;
  due_date?: string | null;
  items: Array<{
    line_type?: "item" | "subheading";
    item_name: string;
    description: string;
    quantity?: number;
    amount?: number | null;
  }>;
  discount_type?: "fixed" | "percentage" | null;
  discount_value?: number | null;
  tax?: number | null;
  save_as_draft: boolean;
};

export type QuotationItem = ProformaItem;

export type QuotationListItem = {
  id: number;
  quote_number: string;
  status: string;
  customer_name: string;
  grand_total?: string | number | null;
  created_at: string;
  created_by?: string | null;
};

export type QuotationDetail = {
  id: number;
  quote_number: string;
  status: string;
  customer_name: string;
  phone: string;
  address: string;
  email?: string | null;
  due_date?: string | null;
  items: QuotationItem[];
  discount_type?: "fixed" | "percentage" | null;
  discount_value?: string | number | null;
  discount_amount?: string | number | null;
  tax_percent?: string | number | null;
  tax?: string | number | null;
  subtotal?: string | number | null;
  final_price?: string | number | null;
  grand_total?: string | number | null;
  created_at: string;
  updated_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  converted_order_id?: number | null;
  converted_proforma_id?: number | null;
};

export type QuotationPayload = ProformaPayload;

export type Paginated<T> = { items: T[]; total: number };

export type WaybillListItem = {
  id: number;
  waybill_number: string;
  order_id: number;
  customer_name: string;
  delivery_status: string;
  created_at: string;
  created_by?: string | null;
};

export type WaybillDetail = {
  id: number;
  waybill_number: string;
  order_id: number;
  delivery_status: string;
  driver_name?: string | null;
  driver_phone?: string | null;
  vehicle_plate?: string | null;
  customer_name: string;
  phone: string;
  address: string;
  email?: string | null;
  items: Array<{
    id: number;
    item_name: string;
    description?: string | null;
    quantity: number;
    amount?: string | number | null;
  }>;
  created_at: string;
  updated_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
};

export type AuditLogItem = {
  id: number;
  action: string;
  entity_type: string;
  entity_id?: number | null;
  actor?: string | null;
  created_at: string;
  meta?: any;
};

export type OrderAdminUpdate = {
  status: OrderStatus;
  due_date?: string | null;
  items: OrderCreateItem[];
  total_price?: string | number | null;
  amount_paid?: string | number | null;
  discount_type?: "fixed" | "percentage" | null;
  discount_value?: string | number | null;
  tax?: string | number | null;
  /** When set, activity log records this update as part of invoice preparation. */
  update_context?: "before_invoice";
};

export type InventoryTrackingMode = "numeric" | "status_only";
export type InventoryStockLevel = "low" | "medium" | "full";
export type InventoryPaymentStatus = "paid" | "partial" | "unpaid";
export type InventoryMovementAction = "added" | "used" | "adjusted";

export type InventoryMaterial = {
  id: number;
  material_name: string;
  category?: string | null;
  tracking_mode: InventoryTrackingMode;
  quantity?: string | number | null;
  unit: string;
  stock_level: InventoryStockLevel;
  supplier_name: string;
  payment_status: InventoryPaymentStatus;
  cost?: string | number | null;
  amount_paid: string | number;
  balance?: string | number | null;
  notes?: string | null;
  created_at: string;
  updated_at?: string | null;
  added_by?: string | null;
  last_updated_by?: string | null;
};

export type InventoryPayment = {
  id: number;
  material_id: number;
  amount: string | number;
  paid_at: string;
  note?: string | null;
  created_at: string;
  recorded_by?: string | null;
};

export type InventoryFinancialSummary = {
  total_cost: string | number;
  total_paid: string | number;
  total_outstanding: string | number;
  material_count: number;
};

export type InventorySupplierFinancialRow = {
  supplier_name: string;
  total_cost: string | number;
  total_paid: string | number;
  outstanding: string | number;
};

export type InventoryMovement = {
  id: number;
  material_id: number;
  material_name: string;
  action: string;
  quantity_delta?: string | number | null;
  meta?: Record<string, unknown> | null;
  actor_username?: string | null;
  created_at: string;
};

export type InventoryMaterialQtyStats = {
  total_quantity_purchased: string | number;
  total_quantity_used: string | number;
  current_quantity?: string | number | null;
};

export type InventoryMaterialDetail = {
  material: InventoryMaterial;
  stats: InventoryMaterialQtyStats;
};

export type FactoryTool = {
  id: number;
  name: string;
  notes?: string | null;
  in_use: boolean;
  created_at: string;
};

export type ToolTrackingDaySummary = {
  date: string;
  checkouts: number;
  still_out: number;
};

export type ToolTrackingDaysPage = {
  items: ToolTrackingDaySummary[];
  page: number;
  per_page: number;
  total_days: number;
};

export type ToolTrackingRecord = {
  id: number;
  tool_id: number;
  tool_name: string;
  checkout_at: string;
  returned_at?: string | null;
  borrower_name?: string | null;
  notes?: string | null;
  checked_out_by?: string | null;
};

export type ToolTrackingRecordsPage = {
  date: string;
  status_filter: "all" | "returned" | "in_use";
  items: ToolTrackingRecord[];
  page: number;
  per_page: number;
  total: number;
};

export type MachineStatus = "available" | "in_use" | "maintenance";
export type MachineActivityKind = "usage_start" | "usage_end" | "status_change" | "note";

export type FactoryMachine = {
  id: number;
  machine_name: string;
  category?: string | null;
  serial_number?: string | null;
  location?: string | null;
  status: MachineStatus;
  notes?: string | null;
  created_at: string;
  updated_at: string;
};

export type MachineActivity = {
  id: number;
  machine_id: number;
  kind: MachineActivityKind;
  message?: string | null;
  meta?: Record<string, unknown> | null;
  created_at: string;
  recorded_by?: string | null;
};

export type FactoryMachineDetail = {
  machine: FactoryMachine;
  activities: MachineActivity[];
};

export type FactoryToolDetail = {
  tool: FactoryTool;
  records: ToolTrackingRecord[];
  current_record_id?: number | null;
};

/** HR / payroll (admin); amounts often arrive as numeric strings from the API */
export type EmployeeSalaryBreakdown = {
  base_salary: string | number;
  lateness_count: number;
  lateness_deduction: string | number;
  lateness_rate_naira: string | number;
  penalties_total: string | number;
  bonuses_total: string | number;
  total_deductions: string | number;
  final_payable: string | number;
};

export type SalaryPeriod = {
  id: number;
  year: number;
  month: number;
  label: string;
  /** Only one month is editable; archived months are view-only for payroll. */
  is_active: boolean;
};

export type PayrollPeriodsNav = {
  active_period: SalaryPeriod | null;
  periods: SalaryPeriod[];
};

export type EmployeePayment = {
  status: "paid" | "unpaid";
  payment_date?: string | null;
  payment_reference?: string | null;
};

export type PayrollSummary = {
  period: SalaryPeriod;
  employee_count: number;
  total_base_salary: string | number;
  total_lateness_deductions: string | number;
  total_penalties: string | number;
  total_bonuses: string | number;
  total_deductions: string | number;
  net_payroll: string | number;
};

export type EmployeeDocumentItem = {
  id: string;
  url: string;
  label?: string | null;
  uploaded_at?: string | null;
};

export type EmployeeLatenessEntry = {
  id: number;
  note?: string | null;
  created_at: string;
};

export type EmployeePenalty = {
  id: number;
  description: string;
  amount: string | number;
  created_at: string;
};

export type EmployeeBonus = {
  id: number;
  description: string;
  amount: string | number;
  created_at: string;
};

export type EmployeeDetail = {
  id: number;
  full_name: string;
  address?: string | null;
  phone?: string | null;
  account_number?: string | null;
  notes?: string | null;
  base_salary: string | number;
  documents?: EmployeeDocumentItem[] | null;
  user_id?: number | null;
  linked_username?: string | null;
  created_at: string;
  updated_at?: string | null;
  period: SalaryPeriod;
  payment: EmployeePayment;
  lateness_entries: EmployeeLatenessEntry[];
  penalties: EmployeePenalty[];
  bonuses: EmployeeBonus[];
  salary: EmployeeSalaryBreakdown;
};

export type EmployeeListItem = {
  id: number;
  full_name: string;
  phone?: string | null;
  account_number?: string | null;
  base_salary: string | number;
  user_id?: number | null;
  period: SalaryPeriod;
  payment: EmployeePayment;
  salary: EmployeeSalaryBreakdown;
};

export type EmployeeCreatePayload = {
  full_name: string;
  address?: string | null;
  phone?: string | null;
  account_number?: string | null;
  notes?: string | null;
  base_salary: number;
  user_id?: number | null;
};

export type EmployeeAdminUpdatePayload = {
  full_name?: string;
  address?: string | null;
  phone?: string | null;
  account_number?: string | null;
  notes?: string | null;
  base_salary?: number;
  user_id?: number | null;
};

export type EmployeeSelfUpdatePayload = {
  full_name?: string;
  address?: string | null;
  phone?: string | null;
  account_number?: string | null;
  notes?: string | null;
};

