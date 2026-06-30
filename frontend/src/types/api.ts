export type Role = "showroom" | "factory" | "admin" | "root_admin" | "finance" | "contract_employee" | "staff";

export type DraftModule = "quotation" | "order" | "proforma";

export type DraftSummary = {
  module: DraftModule;
  updated_at: string;
};

export type DraftLatestResponse = { draft: DraftSummary | null };

export type DraftGetResponse<T = any> = {
  module: DraftModule;
  data: T;
  updated_at: string;
};

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

export type CustomerUpdate = Partial<{
  name: string;
  phone: string;
  address: string;
  email: string | null;
  birth_day: number | null;
  birth_month: number | null;
}>;

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
  role: Exclude<Role, "root_admin" | "contract_employee">;
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
  base_salary_used?: string | number;
  base_salary: string | number;
  period_base_salary?: string | number | null;
  lateness_count: number;
  lateness_deduction_auto?: string | number;
  lateness_deduction: string | number;
  lateness_deduction_override?: string | number | null;
  lateness_rate_naira?: string | number | null;
  early_sign_out_count?: number;
  early_sign_out_deduction_auto?: string | number;
  early_sign_out_deduction?: string | number;
  early_sign_out_deduction_override?: string | number | null;
  early_sign_out_rate_naira?: string | number | null;
  absence_count?: number;
  absence_deduction_auto?: string | number;
  absence_deduction?: string | number;
  absence_deduction_override?: string | number | null;
  absence_rate_naira?: string | number | null;
  attendance_deductions_eligible?: boolean;
  penalties_entries_total?: string | number;
  bonuses_entries_total?: string | number;
  increments_total?: string | number;
  adjustment_bonus?: string | number;
  adjustment_deduction?: string | number;
  adjustment_late_penalty?: string | number;
  penalties_total: string | number;
  bonuses_total: string | number;
  total_deductions: string | number;
  final_payable: string | number;
  adjustment_note?: string | null;
};

export type SalaryPeriod = {
  id: number;
  year: number;
  month: number;
  label: string;
  /** Only one month is editable; archived months are view-only for payroll. */
  is_active: boolean;
  /** Month-level completion when all salaries for the period are paid. */
  month_payment_status: "paid" | "pending_payment";
  paid_employee_count: number;
  total_employee_count: number;
  month_paid_at?: string | null;
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
  total_early_sign_out_deductions?: string | number;
  total_absence_deductions?: string | number;
  total_penalties: string | number;
  total_bonuses: string | number;
  total_deductions: string | number;
  net_payroll: string | number;
};

export type PayrollExportLineItem = {
  label: string;
  amount: string | number;
  date_label?: string | null;
};

export type PayrollExportEmployee = {
  employee_id: number;
  name: string;
  department: string;
  bank_name: string;
  account_name: string;
  account_number: string;
  salary_month: string;
  base_salary: string | number;
  bonuses_total: string | number;
  increments_total: string | number;
  lateness_deduction: string | number;
  absence_deduction: string | number;
  early_sign_out_deduction: string | number;
  manual_deductions: string | number;
  other_adjustments: string | number;
  total_deductions: string | number;
  final_payable: string | number;
  payment_status: "Paid" | "Pending";
  bonus_lines: PayrollExportLineItem[];
  increment_lines: PayrollExportLineItem[];
  lateness_lines: PayrollExportLineItem[];
  absence_lines: PayrollExportLineItem[];
  early_sign_out_lines: PayrollExportLineItem[];
  manual_deduction_lines: PayrollExportLineItem[];
};

export type PayrollExportSummary = {
  employee_count: number;
  total_base_salaries: string | number;
  total_bonuses: string | number;
  total_increments: string | number;
  total_deductions: string | number;
  grand_total_payable: string | number;
};

export type PayrollExport = {
  company_name: string;
  payroll_month: string;
  payroll_status: string;
  generated_by: string;
  generated_date: string;
  generated_time: string;
  period_id: number;
  period_year: number;
  period_month: number;
  employees: PayrollExportEmployee[];
  summary: PayrollExportSummary;
};

export type EmployeeDocumentItem = {
  id: string;
  url: string;
  label?: string | null;
  uploaded_at?: string | null;
};

export type EmployeeLatenessEntry = {
  id: number;
  attendance_id?: number | null;
  note?: string | null;
  created_at: string;
};

export type AttendanceShiftKey = "morning" | "full_day";

export type CompanyLocation = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  allowed_radius_meters: number;
  shift_mode_enabled: boolean;
  late_attendance_time: string;
  attendance_cutoff_time?: string | null;
  check_out_time: string;
  morning_shift_late_time?: string | null;
  morning_shift_closing_time?: string | null;
  full_day_shift_late_time?: string | null;
  full_day_shift_closing_time?: string | null;
  late_coming_fee_naira: string | number;
  early_sign_out_fee_naira: string | number;
  absence_fee_naira: string | number;
  created_at: string;
};

export type EmployeeAttendanceHistoryItem = {
  id: number;
  record_type: "attendance" | "absence";
  employee_id: number;
  period_id: number;
  attendance_date: string; // YYYY-MM-DD
  status: "present" | "late" | "absent" | "incomplete_day" | "checked_in" | "early_check_out" | "late_early_check_out" | "short_session";
  check_in_at?: string | null;
  check_out_at?: string | null;
  selected_shift?: AttendanceShiftKey | null;
  shift_label?: string | null;
  expected_late_time?: string | null;
  is_late: boolean;
  late_minutes?: number | null;
  is_early_check_out?: boolean;
  early_check_out_minutes?: number | null;
  expected_check_out_time?: string | null;
  attendance_duration_minutes?: number | null;
  late_deduction_naira?: string | number;
  early_sign_out_deduction_naira?: string | number;
  deduction_naira: string | number;
  lateness_entry_id?: number | null;
  early_sign_out_entry_id?: number | null;
  absence_entry_id?: number | null;
  work_location_id?: number | null;
  employee_latitude?: number | null;
  employee_longitude?: number | null;
  distance_meters?: number | null;
  check_out_latitude?: number | null;
  check_out_longitude?: number | null;
  check_out_distance_meters?: number | null;
  work_location?: CompanyLocation | null;
};

/** Clock-in responses use attendance rows; history lists use {@link EmployeeAttendanceHistoryItem}. */
export type EmployeeAttendanceEntry = EmployeeAttendanceHistoryItem & {
  check_in_at: string;
};

export type EmployeeClockInResponse = {
  status: "present" | "late" | "already_checked_in" | "already_checked_out" | "sunday";
  message?: string | null;
  entry?: EmployeeAttendanceEntry | null;
};

export type EmployeeClockOutResponse = {
  status: "checked_out" | "not_checked_in" | "already_checked_out" | "sunday";
  message?: string | null;
  entry?: EmployeeAttendanceEntry | null;
};

export type EmployeeSignOutPreview = {
  shift_label?: string | null;
  closing_time: string;
  current_time: string;
  is_early_sign_out: boolean;
  early_sign_out_fee_naira: string | number;
  message: string;
};

export type AttendanceMonitorFilterStatus =
  | "present"
  | "late"
  | "early_sign_out"
  | "absent"
  | "checked_in"
  | "incomplete_day";

export type AttendanceMonitorSummary = {
  attendance_date: string;
  expected_employees: number;
  present: number;
  late: number;
  early_sign_out: number;
  absent: number;
  checked_in_only: number;
  incomplete_day: number;
};

export type AttendanceMonitorRow = {
  employee_id: number;
  full_name: string;
  work_location?: CompanyLocation | null;
  shift_label?: string | null;
  check_in_at?: string | null;
  check_out_at?: string | null;
  status: EmployeeAttendanceHistoryItem["status"];
  monitor_filter_status: AttendanceMonitorFilterStatus;
};

export type AttendanceMonitorResponse = {
  attendance_date: string;
  summary: AttendanceMonitorSummary;
  rows: AttendanceMonitorRow[];
  rows_total?: number;
};

export type EmployeeAttendanceMonthSummary = {
  year: number;
  month: number;
  label: string;
  record_count: number;
};

export type EmployeeAttendanceHistoryPage = {
  year: number;
  month: number;
  items: EmployeeAttendanceHistoryItem[];
  total: number;
  limit: number;
  offset: number;
};

export type EmployeeAttendanceStats = {
  year: number;
  month: number;
  present: number;
  late: number;
  early_sign_out: number;
  absent: number;
  checked_in_only: number;
  incomplete_day: number;
};

export type EmployeeAttendanceOverview = {
  employee_id: number;
  full_name: string;
  work_location?: CompanyLocation | null;
  stats: EmployeeAttendanceStats;
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

export type PayrollAdjustmentType = "bonus" | "deduction" | "increment";

export type EmployeePayrollAdjustment = {
  id: number;
  adjustment_type: PayrollAdjustmentType;
  amount: string | number;
  reason: string;
  notes?: string | null;
  created_at: string;
  created_by_name?: string | null;
  updated_at?: string | null;
  updated_by_name?: string | null;
};

export type EmployeeDetail = {
  id: number;
  full_name: string;
  address?: string | null;
  phone?: string | null;
  bank_name?: string | null;
  account_number?: string | null;
  notes?: string | null;
  base_salary: string | number;
  documents?: EmployeeDocumentItem[] | null;
  user_id?: number | null;
  linked_username?: string | null;
  work_location_id?: number | null;
  work_location?: CompanyLocation | null;
  created_at: string;
  updated_at?: string | null;
  period: SalaryPeriod;
  payment: EmployeePayment;
  lateness_entries: EmployeeLatenessEntry[];
  penalties: EmployeePenalty[];
  bonuses: EmployeeBonus[];
  payroll_adjustments?: EmployeePayrollAdjustment[];
  salary: EmployeeSalaryBreakdown;
};

export type EmployeeListItem = {
  id: number;
  full_name: string;
  notes?: string | null;
  phone?: string | null;
  bank_name?: string | null;
  account_number?: string | null;
  base_salary: string | number;
  user_id?: number | null;
  period: SalaryPeriod;
  payment: EmployeePayment;
  salary: EmployeeSalaryBreakdown;
};

export type EmployeeLocationAssignmentItem = {
  id: number;
  full_name: string;
  work_location_id?: number | null;
  work_location?: CompanyLocation | null;
};

export type EmployeeCreatePayload = {
  full_name: string;
  address?: string | null;
  phone?: string | null;
  bank_name: string;
  account_number?: string | null;
  notes?: string | null;
  base_salary: number;
  user_id?: number | null;
};

export type EmployeeAdminUpdatePayload = {
  full_name?: string;
  address?: string | null;
  phone?: string | null;
  bank_name?: string | null;
  account_number?: string | null;
  notes?: string | null;
  base_salary?: number;
  user_id?: number | null;
};

export type EmployeeSelfUpdatePayload = {
  full_name?: string;
  address?: string | null;
  phone?: string | null;
  bank_name?: string | null;
  account_number?: string | null;
  notes?: string | null;
};

// --- Contract employees + unified payments ledger ---

export type ContractEmployeeStatus = "active" | "inactive";
export type EmployeeTxnType = "owed_increase" | "owed_decrease" | "payment" | "reversal";
export type EmployeeTxnStatus =
  | "requested"
  | "approved_by_admin"
  | "sent_to_finance"
  | "resolved"
  | "pending" // legacy
  | "paid"
  | "cancelled";

export type EmployeePaymentAllocation = {
  contract_job_id: number;
  amount: string | number;
};

export type EmployeeTransaction = {
  id: number;
  created_at: string;
  paid_at?: string | null;
  contract_job_id?: number | null;
  amount: string | number;
  txn_type: EmployeeTxnType;
  status: EmployeeTxnStatus;
  processed_by_role?: string | null;
  processed_by?: string | null;
  initiated_by?: "admin" | "employee" | null;
  note?: string | null;
  receipt_url?: string | null;
  running_balance?: string | number | null;
  reversal_of_id?: number | null;
  cancelled_at?: string | null;
  cancelled_reason?: string | null;
  allocations?: EmployeePaymentAllocation[] | null;
};

export type ContractEmployeeListItem = {
  id: number;
  full_name: string;
  bank_name?: string | null;
  account_number?: string | null;
  phone?: string | null;
  status: ContractEmployeeStatus;
  total: string | number;
  total_paid: string | number;
  balance: string | number;
  active_jobs_count?: number;
  pending_requests?: number;
  unread_pending_requests?: number;
};

export type ContractEmployeeDetail = ContractEmployeeListItem & {
  address?: string | null;
  transactions: EmployeeTransaction[];
  created_at: string;
  updated_at?: string | null;
};

export type ContractEmployeeCreatePayload = {
  username?: string;
  password?: string;
  full_name?: string;
  bank_name?: string | null;
  account_number?: string | null;
  phone?: string | null;
  address?: string | null;
  status: ContractEmployeeStatus;
};

export type ContractEmployeeUpdatePayload = Partial<ContractEmployeeCreatePayload>;

export type ContractEmployeeMe = {
  id: number;
  full_name: string;
  bank_name?: string | null;
  account_number?: string | null;
  phone?: string | null;
  address?: string | null;
  status: ContractEmployeeStatus;
  total: string | number;
  total_paid: string | number;
  balance: string | number;
  needs_profile_completion: boolean;
  needs_password_change?: boolean;
  created_at: string;
  updated_at?: string | null;
};

export type ContractJobStatus = "pending" | "in_progress" | "completed" | "cancelled";

export type ContractJobNegotiationEvent = {
  id: number;
  kind: string;
  offer_price: string | number;
  note?: string | null;
  actor_user_id?: number | null;
  actor_role?: string | null;
  created_at: string;
};

export type ContractJob = {
  id: number;
  contract_employee_id: number;
  contract_employee_name?: string | null;
  description: string;
  image_url?: string | null;
  price_offer?: string | number | null;
  last_offer_by_role?: "admin" | "contract_employee" | null;
  offer_updated_at?: string | null;
  offer_version?: number;
  negotiation_occurred?: boolean;
  admin_accepted_at?: string | null;
  employee_accepted_at?: string | null;
  adminAccepted?: boolean;
  employeeAccepted?: boolean;
  hasNegotiation?: boolean;
  final_price?: string | number | null;
  amount_paid: string | number;
  balance?: string | number | null;
  payment_state?: "not_paid" | "partially_paid" | "fully_paid";
  price_accepted_at?: string | null;
  status: ContractJobStatus;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  cancelled_note?: string | null;
  paid_flag: boolean;
  linked_transactions: EmployeeTransaction[];
  negotiation_history?: ContractJobNegotiationEvent[];
};

export type AdminJobsSummary = {
  jobs: { total: number; completed: number; pending: number; in_progress: number };
  financials: { total_paid: string | number; total_owed: string | number; balance: string | number };
};

export type PendingEmployeePaymentItem = {
  transaction: EmployeeTransaction;
  employee_kind: "monthly" | "contract";
  employee_id: number;
  employee_name: string;
  account_number?: string | null;
  phone?: string | null;
  period_label?: string | null;
  sent_to_finance_at?: string | null;
  initiated_by?: "admin" | "employee" | null;
  notification_unread?: boolean;
};

export type PendingEmployeePayments = {
  total_pending_amount: string | number;
  total: number;
  limit: number;
  offset: number;
  items: PendingEmployeePaymentItem[];
};

export type ContractJobFinanceRow = {
  id: number;
  status: ContractJobStatus | string;
  final_price?: string | number | null;
  amount_paid: string | number;
  balance?: string | number | null;
};

export type ContractEmployeeFinance = {
  id: number;
  full_name: string;
  total: string | number;
  total_paid: string | number;
  balance: string | number;
  pending_payment?: EmployeeTransaction | null;
  jobs: ContractJobFinanceRow[];
  transactions: EmployeeTransaction[];
};

// --- Notifications ---

export type NotificationKind =
  | "job_assigned"
  | "price_updated"
  | "price_accepted"
  | "job_cancelled"
  | "payment_request_submitted"
  | "payment_approved"
  | "payment_sent_to_finance"
  | "payment_completed"
  | "system";

export type NotificationItem = {
  id: number;
  kind: NotificationKind;
  title: string;
  message?: string | null;
  entity_type?: string | null;
  entity_id?: number | null;
  created_at: string;
  read_at?: string | null;
};

export type NotificationsPage = {
  items: NotificationItem[];
  unread_count: number;
};

// --- Expenses / petty cash ---

export type ExpenseEntryType = "expense" | "credit";

export type ExpenseEntry = {
  id: number;
  entry_date: string;
  amount: string | number;
  entry_type: ExpenseEntryType;
  note?: string | null;
  receipt_url?: string | null;
  processed_by_role?: Role | null;
  processed_by?: string | null;
  created_at: string;
};

export type ExpenseEntriesPage = {
  items: ExpenseEntry[];
  total: number;
  limit: number;
  offset: number;
};

export type ExpenseSummary = {
  total_received: string | number;
  total_expenses: string | number;
  balance: string | number;
  today_total: string | number;
};

// --- Production material tracking ---

export type ProductionMaterialSection = "painters_dept" | "mdf_section";
export type ProductionMaterialTxnType = "allocation" | "reversal";
export type ProductionMaterialTxnStatus = "active" | "voided" | "superseded";

export type ProductionMaterialType = {
  id: number;
  section: ProductionMaterialSection;
  name: string;
  default_unit?: string | null;
  is_active: boolean;
  created_at: string;
};

export type ProductionMaterialTotal = {
  material_type_id?: number | null;
  material_name: string;
  unit?: string | null;
  total_quantity: string | number;
};

export type ProductionMaterialDisplayColumn = {
  material_type_id?: number | null;
  material_name: string;
  unit?: string | null;
  is_selectable: boolean;
};

export type ProductionMaterialEmployeeRow = {
  assignment_id: number;
  contract_employee_id: number;
  full_name: string;
  material_totals: ProductionMaterialTotal[];
};

export type ProductionMaterialSectionOverview = {
  section: ProductionMaterialSection;
  section_label: string;
  material_types: ProductionMaterialType[];
  display_columns: ProductionMaterialDisplayColumn[];
  employees: ProductionMaterialEmployeeRow[];
  section_totals: ProductionMaterialTotal[];
};

export type ProductionMaterialTransaction = {
  id: number;
  section: ProductionMaterialSection;
  contract_employee_id: number;
  material_type_id?: number | null;
  material_name: string;
  quantity: string | number;
  unit?: string | null;
  txn_type: ProductionMaterialTxnType;
  notes?: string | null;
  given_by?: string | null;
  transaction_at: string;
  created_at: string;
  status: ProductionMaterialTxnStatus;
  effective_quantity: string | number;
  reversal_of_id?: number | null;
  supersedes_id?: number | null;
  superseded_by_id?: number | null;
  void_reason?: string | null;
};

export type ProductionMaterialContractEmployeeOption = {
  id: number;
  full_name: string;
  status: string;
  assigned_to_section: boolean;
};

export type ProductionMaterialSectionOption = {
  key: ProductionMaterialSection;
  label: string;
};

