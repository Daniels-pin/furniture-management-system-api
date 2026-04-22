import { api } from "./api";
import type {
  AuditLogItem,
  ChangePasswordRequest,
  Customer,
  CustomerCreate,
  ImpersonateResponse,
  InvoiceDetail,
  InvoiceListItem,
  LoginRequest,
  LoginResponse,
  StopImpersonationRequest,
  TrashItem,
  Order,
  OrderAdminUpdate,
  ProformaDetail,
  ProformaListItem,
  ProformaPayload,
  QuotationDetail,
  QuotationListItem,
  QuotationPayload,
  User,
  UserCreate,
  Paginated,
  WaybillDetail,
  WaybillListItem,
  InventoryFinancialSummary,
  InventoryMaterial,
  InventoryMaterialDetail,
  InventoryMovement,
  InventoryMovementAction,
  InventoryPayment,
  InventorySupplierFinancialRow,
  FactoryTool,
  ToolTrackingDaysPage,
  ToolTrackingRecordsPage,
  ToolTrackingRecord,
  FactoryMachine,
  FactoryMachineDetail,
  FactoryToolDetail,
  MachineActivity,
  MachineStatus,
  EmployeeBonus,
  EmployeeCreatePayload,
  EmployeeDetail,
  EmployeeListItem,
  EmployeeAdminUpdatePayload,
  EmployeeSelfUpdatePayload,
  PayrollPeriodsNav,
  PayrollSummary,
  SalaryPeriod,
  ContractEmployeeCreatePayload,
  ContractEmployeeDetail,
  ContractEmployeeListItem,
  ContractEmployeeUpdatePayload,
  EmployeeTransaction,
  PendingEmployeePayments
  ,
  ExpenseEntry,
  ExpenseSummary,
  DraftGetResponse,
  DraftLatestResponse,
  DraftModule,
  DraftSummary
} from "../types/api";

export const authApi = {
  async login(payload: LoginRequest) {
    const { data } = await api.post<LoginResponse>("/auth/login", payload);
    return data;
  },
  async changePassword(payload: ChangePasswordRequest) {
    const { data } = await api.post<{ message: string }>("/auth/change-password", payload);
    return data;
  }
};

export const draftsApi = {
  async latest(params?: { modules?: DraftModule[] }) {
    const qp: Record<string, any> = {};
    if (params?.modules?.length) qp.modules = params.modules.join(",");
    const { data } = await api.get<DraftLatestResponse>("/drafts/latest", { params: qp });
    return data;
  },
  async list() {
    const { data } = await api.get<{ items: DraftSummary[] }>("/drafts");
    return data;
  },
  async get<T = any>(module: DraftModule) {
    const { data } = await api.get<DraftGetResponse<T>>(`/drafts/${module}`);
    return data;
  },
  async upsert(module: DraftModule, body: Record<string, unknown>) {
    const { data } = await api.put<{ module: DraftModule; updated_at: string }>(`/drafts/${module}`, body);
    return data;
  },
  async remove(module: DraftModule) {
    const { data } = await api.delete<{ message: string }>(`/drafts/${module}`);
    return data;
  }
};

export const trashApi = {
  async list() {
    const { data } = await api.get<{ items: TrashItem[] }>("/trash");
    return data;
  },
  async restore(entity_type: string, entity_id: number) {
    const { data } = await api.post<{ message: string }>("/trash/restore", {
      entity_type,
      entity_id
    });
    return data;
  },
  /** Permanently delete one trashed row (POST avoids DELETE being blocked by some proxies). */
  async purge(entity_type: string, entity_id: number) {
    const { data } = await api.post<{ message: string }>("/trash/purge", { entity_type, entity_id });
    return data;
  },
  async purgeBulk(items: { entity_type: string; entity_id: number }[]) {
    const { data } = await api.post<{ purged: number; failed: { entity_type: string; entity_id: number; detail: string }[] }>(
      "/trash/purge-bulk",
      { items }
    );
    return data;
  },
  async purgeAll() {
    const { data } = await api.post<{ purged: number; failed: { entity_type: string; entity_id: number; detail: string; label?: string }[] }>(
      "/trash/purge-all",
      { confirm: "PERMANENTLY_DELETE_ALL_TRASH" as const }
    );
    return data;
  }
};

export const adminApi = {
  async impersonate(userId: number) {
    const { data } = await api.post<ImpersonateResponse>(`/admin/impersonate/${userId}`);
    return data;
  },
  async stopImpersonation(body: StopImpersonationRequest) {
    const { data } = await api.post<LoginResponse>("/admin/stop-impersonation", body);
    return data;
  }
};

export const customersApi = {
  async list() {
    const { data } = await api.get<Customer[]>("/customers");
    return data;
  },
  async birthdaysToday() {
    const { data } = await api.get<Customer[]>("/customers/birthdays/today");
    return data;
  },
  async create(payload: CustomerCreate) {
    const { data } = await api.post<Customer>("/customers", payload);
    return data;
  },
  async delete(customerId: number) {
    const { data } = await api.delete<{ message: string }>(`/customers/${customerId}`);
    return data;
  },
  async exportContacts(kind: "phones" | "emails") {
    const res = await api.get("/customers/export", { params: { kind }, responseType: "blob" });
    const blob = res.data as Blob;
    const cd = res.headers["content-disposition"] as string | undefined;
    let filename = kind === "phones" ? "customer-phones.csv" : "customer-emails.csv";
    if (cd) {
      const m = /filename="([^"]+)"/.exec(cd);
      if (m) filename = m[1];
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
};

export const ordersApi = {
  async list(params?: {
    search?: string;
    status?: "pending" | "in_progress" | "completed";
    page?: number;
    limit?: number;
  }) {
    const qp: Record<string, any> = {};
    if (params?.search) qp.search = params.search;
    if (params?.status) qp.status = params.status;
    if (params?.page) qp.page = params.page;
    if (params?.limit) qp.limit = params.limit;

    const { data } = await api.get<{
      data: Order[];
      total: number;
      page: number;
      total_pages: number;
    }>("/orders", { params: qp });
    return data;
  },
  async get(orderId: number) {
    const { data } = await api.get<{
      order_id: number;
      customer: Customer | null;
      items: Order["items"];
      status: Order["status"];
      due_date?: string | null;
      image_url?: string | null;
      image_urls?: string[] | null;
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
      invoice_id?: number | null;
    }>(`/orders/${orderId}`);
    return data;
  },
  async updateAdmin(orderId: number, payload: OrderAdminUpdate) {
    const { data } = await api.put<{
      order_id: number;
      customer: Customer | null;
      items: Order["items"];
      status: Order["status"];
      due_date?: string | null;
      image_url?: string | null;
      image_urls?: string[] | null;
      total_price?: string | number | null;
      discount_type?: "fixed" | "percentage" | null;
      discount_value?: string | number | null;
      discount_amount?: string | number | null;
      final_price?: string | number | null;
      tax_percent?: string | number | null;
      tax?: string | number | null;
      amount_paid?: string | number | null;
      balance?: string | number | null;
      payment_status?: string | null;
      invoice_id?: number | null;
    }>(`/orders/${orderId}`, payload);
    return data;
  },
  async updatePricing(orderId: number, payload: { total_price?: number | null; amount_paid?: number | null; tax?: number | null }) {
    const { data } = await api.patch<{
      id: number;
      total_price?: string | number | null;
      amount_paid?: string | number | null;
      tax_percent?: string | number | null;
      tax?: string | number | null;
      balance?: string | number | null;
      payment_status?: string | null;
    }>(`/orders/${orderId}`, payload);
    return data;
  },
  async sendEmail(orderId: number) {
    const { data } = await api.post<{ message: string }>(`/orders/${orderId}/send-email`);
    return data;
  },
  async download(orderId: number) {
    const res = await api.post(`/orders/${orderId}/download`, {}, { responseType: "blob" });
    const blob = res.data as Blob;
    const cd = res.headers["content-disposition"] as string | undefined;
    let filename = `order-${orderId}.pdf`;
    if (cd) {
      const m = /filename="([^"]+)"/.exec(cd);
      if (m) filename = m[1];
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
  async createMultipart(form: FormData) {
    const { data } = await api.post<Order>("/orders", form, {
      headers: { "Content-Type": "multipart/form-data" }
    });
    return data;
  },
  async updateStatus(orderId: number, status: "pending" | "in_progress" | "completed") {
    const form = new FormData();
    form.append("status", status);
    const { data } = await api.patch<{ message: string }>(`/orders/${orderId}/status`, form, {
      headers: { "Content-Type": "multipart/form-data" }
    });
    return data;
  },
  async markFullyPaid(orderId: number) {
    const { data } = await api.post<{ message: string }>(`/orders/${orderId}/mark_paid`);
    return data;
  },
  async alerts() {
    const { data } = await api.get<{
      due_soon_count: number;
      orders: Array<{
        order_id: number;
        status: Order["status"];
        due_date?: string | null;
        customer: { name: string | null } | null;
      }>;
    }>("/orders/alerts");
    return data;
  },
  async delete(orderId: number) {
    const { data } = await api.delete<{ message: string }>(`/orders/${orderId}`);
    return data;
  }
};

export const invoicesApi = {
  async list(params?: { limit?: number; offset?: number }) {
    const qp: Record<string, any> = {};
    if (typeof params?.limit === "number") qp.limit = params.limit;
    if (typeof params?.offset === "number") qp.offset = params.offset;
    const { data } = await api.get<Paginated<InvoiceListItem>>("/invoices", { params: qp });
    return data;
  },
  async get(invoiceId: number) {
    const { data } = await api.get<InvoiceDetail>(`/invoices/${invoiceId}`);
    return data;
  },
  async getByOrder(orderId: number) {
    const { data } = await api.get<InvoiceDetail>(`/invoices/order/${orderId}`);
    return data;
  },
  async issueForOrder(
    orderId: number,
    options?: { orderEditedBeforeInvoice?: boolean }
  ) {
    const params =
      options?.orderEditedBeforeInvoice === true
        ? { order_edited_before_invoice: true }
        : undefined;
    const { data } = await api.post<{
      message: string;
      invoice_id: number;
      invoice_number: string;
      order_id: number;
    }>(`/invoices/order/${orderId}`, undefined, { params });
    return data;
  },
  async sendEmail(invoiceId: number) {
    const { data } = await api.post<{ message: string }>(`/invoices/${invoiceId}/send-email`);
    return data;
  },
  async recordPrint(invoiceId: number) {
    const { data } = await api.post<{ message: string }>(`/invoices/${invoiceId}/print`);
    return data;
  },
  async download(invoiceId: number) {
    const res = await api.post(`/invoices/${invoiceId}/download`, {}, { responseType: "blob" });
    const blob = res.data as Blob;
    const cd = res.headers["content-disposition"] as string | undefined;
    let filename = `invoice-${invoiceId}.pdf`;
    if (cd) {
      const m = /filename="([^"]+)"/.exec(cd);
      if (m) filename = m[1];
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
  async delete(invoiceId: number) {
    const { data } = await api.delete<{ message: string; order_id?: number }>(`/invoices/${invoiceId}`);
    return data;
  }
};

export const usersApi = {
  async list() {
    const { data } = await api.get<User[]>("/users");
    return data;
  },
  async create(payload: UserCreate) {
    const { data } = await api.post<User>("/users", payload);
    return data;
  },
  async delete(userId: number) {
    const { data } = await api.delete<{ message: string }>(`/users/${userId}`);
    return data;
  }
};

export const dashboardApi = {
  async get() {
    const { data } = await api.get<{
      total_orders: number;
      total_customers: number;
      pending_orders: number;
      in_progress_orders: number;
      completed_orders: number;
      total_revenue?: string | number;
      amount_paid?: string | number;
      outstanding_balance?: string | number;
      upcoming_due_orders: Array<{
        order_id: number;
        status: Order["status"];
        due_date?: string | null;
        customer: { name: string | null } | null;
      }>;
      recent_orders: Array<{
        order_id: number;
        status: Order["status"];
        due_date?: string | null;
        customer: { name: string | null } | null;
      }>;
    }>("/dashboard");
    return data;
  }
};

export const proformaApi = {
  async list(params?: { limit?: number; offset?: number }) {
    const qp: Record<string, any> = {};
    if (typeof params?.limit === "number") qp.limit = params.limit;
    if (typeof params?.offset === "number") qp.offset = params.offset;
    const { data } = await api.get<Paginated<ProformaListItem>>("/proforma", { params: qp });
    return data;
  },
  async get(id: number) {
    const { data } = await api.get<ProformaDetail>(`/proforma/${id}`);
    return data;
  },
  async create(payload: ProformaPayload) {
    const { data } = await api.post<ProformaDetail>("/proforma", payload);
    return data;
  },
  async update(id: number, payload: ProformaPayload) {
    const { data } = await api.put<ProformaDetail>(`/proforma/${id}`, payload);
    return data;
  },
  async finalize(id: number) {
    const { data } = await api.patch<ProformaDetail>(`/proforma/${id}/finalize`);
    return data;
  },
  async sendEmail(id: number) {
    const { data } = await api.post<{ message: string }>(`/proforma/${id}/send-email`);
    return data;
  },
  async recordPrint(id: number) {
    const { data } = await api.post<{ message: string }>(`/proforma/${id}/print`);
    return data;
  },
  async download(id: number) {
    const res = await api.post(`/proforma/${id}/download`, {}, { responseType: "blob" });
    const blob = res.data as Blob;
    const cd = res.headers["content-disposition"] as string | undefined;
    let filename = `proforma-${id}.pdf`;
    if (cd) {
      const m = /filename="([^"]+)"/.exec(cd);
      if (m) filename = m[1];
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
  async convertToInvoice(id: number, payload?: { amount_paid?: number | null }) {
    const { data } = await api.post<{
      message: string;
      order_id: number;
      invoice_id: number;
      amount_paid?: string;
      grand_total?: string;
      balance?: string;
      payment_status?: string;
    }>(`/proforma/${id}/convert-to-invoice`, payload ?? {});
    return data;
  },
  async delete(id: number) {
    const { data } = await api.delete<{ message: string }>(`/proforma/${id}`);
    return data;
  }
};

export const quotationApi = {
  async list(params?: { limit?: number; offset?: number }) {
    const qp: Record<string, any> = {};
    if (typeof params?.limit === "number") qp.limit = params.limit;
    if (typeof params?.offset === "number") qp.offset = params.offset;
    const { data } = await api.get<Paginated<QuotationListItem>>("/quotations", { params: qp });
    return data;
  },
  async get(id: number) {
    const { data } = await api.get<QuotationDetail>(`/quotations/${id}`);
    return data;
  },
  async create(payload: QuotationPayload) {
    const { data } = await api.post<QuotationDetail>("/quotations", payload);
    return data;
  },
  async update(id: number, payload: QuotationPayload) {
    const { data } = await api.put<QuotationDetail>(`/quotations/${id}`, payload);
    return data;
  },
  async finalize(id: number) {
    const { data } = await api.patch<QuotationDetail>(`/quotations/${id}/finalize`);
    return data;
  },
  async sendEmail(id: number) {
    const { data } = await api.post<{ message: string }>(`/quotations/${id}/send-email`);
    return data;
  },
  async recordPrint(id: number) {
    const { data } = await api.post<{ message: string }>(`/quotations/${id}/print`);
    return data;
  },
  async download(id: number) {
    const res = await api.post(`/quotations/${id}/download`, {}, { responseType: "blob" });
    const blob = res.data as Blob;
    const cd = res.headers["content-disposition"] as string | undefined;
    let filename = `quotation-${id}.pdf`;
    if (cd) {
      const m = /filename="([^"]+)"/.exec(cd);
      if (m) filename = m[1];
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
  async convertToProforma(id: number) {
    const { data } = await api.post<{ message: string; proforma_id: number }>(`/quotations/${id}/convert-to-proforma`);
    return data;
  },
  async convertToInvoice(id: number, payload?: { amount_paid?: number | null }) {
    const { data } = await api.post<{
      message: string;
      order_id: number;
      invoice_id: number;
      amount_paid?: string;
      grand_total?: string;
      balance?: string;
      payment_status?: string;
    }>(`/quotations/${id}/convert-to-invoice`, payload ?? {});
    return data;
  },
  async delete(id: number) {
    const { data } = await api.delete<{ message: string }>(`/quotations/${id}`);
    return data;
  }
};

export const waybillApi = {
  async list(params?: { limit?: number; offset?: number }) {
    const qp: Record<string, any> = {};
    if (typeof params?.limit === "number") qp.limit = params.limit;
    if (typeof params?.offset === "number") qp.offset = params.offset;
    const { data } = await api.get<Paginated<WaybillListItem>>("/waybills", { params: qp });
    return data;
  },
  async get(id: number) {
    const { data } = await api.get<WaybillDetail>(`/waybills/${id}`);
    return data;
  },
  async create(payload: {
    order_id: number;
    driver_name: string;
    driver_phone: string;
    vehicle_plate: string;
  }) {
    const { data } = await api.post<WaybillDetail>("/waybills", payload);
    return data;
  },
  async updateLogistics(
    id: number,
    body: { driver_name: string; driver_phone: string; vehicle_plate: string }
  ) {
    const { data } = await api.patch<WaybillDetail>(`/waybills/${id}/logistics`, body);
    return data;
  },
  async recordView(id: number) {
    const { data } = await api.post<{ message: string }>(`/waybills/${id}/record-view`);
    return data;
  },
  async updateStatus(id: number, delivery_status: "pending" | "shipped" | "delivered") {
    const { data } = await api.patch<WaybillDetail>(`/waybills/${id}/status`, { delivery_status });
    return data;
  },
  async sendEmail(id: number) {
    const { data } = await api.post<{ message: string }>(`/waybills/${id}/send-email`);
    return data;
  },
  async recordPrint(id: number) {
    const { data } = await api.post<{ message: string }>(`/waybills/${id}/print`);
    return data;
  },
  async download(id: number) {
    const res = await api.post(`/waybills/${id}/download`, {}, { responseType: "blob" });
    const blob = res.data as Blob;
    const cd = res.headers["content-disposition"] as string | undefined;
    let filename = `waybill-${id}.pdf`;
    if (cd) {
      const m = /filename="([^"]+)"/.exec(cd);
      if (m) filename = m[1];
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
  async delete(id: number) {
    const { data } = await api.delete<{ message: string }>(`/waybills/${id}`);
    return data;
  }
};

export const auditApi = {
  async list(params?: { limit?: number; offset?: number }) {
    const qp: Record<string, any> = {};
    if (typeof params?.limit === "number") qp.limit = params.limit;
    if (typeof params?.offset === "number") qp.offset = params.offset;
    const { data } = await api.get<Paginated<AuditLogItem>>("/audit/logs", { params: qp });
    return data;
  }
};

export const inventoryApi = {
  async units() {
    const { data } = await api.get<{ units: string[] }>("/inventory/units");
    return data;
  },
  async suppliers() {
    const { data } = await api.get<{ suppliers: string[] }>("/inventory/suppliers");
    return data;
  },
  async lowStockCount() {
    const { data } = await api.get<{ count: number }>("/inventory/low-stock-count");
    return data;
  },
  async list(params?: {
    search?: string;
    stock_level?: InventoryMaterial["stock_level"];
    supplier?: string;
    payment_status?: InventoryMaterial["payment_status"];
  }) {
    const qp: Record<string, string> = {};
    if (params?.search?.trim()) qp.search = params.search.trim();
    if (params?.stock_level) qp.stock_level = params.stock_level;
    if (params?.supplier?.trim()) qp.supplier = params.supplier.trim();
    if (params?.payment_status) qp.payment_status = params.payment_status;
    const { data } = await api.get<InventoryMaterial[]>("/inventory", { params: qp });
    return data;
  },
  async getDetail(materialId: number) {
    const { data } = await api.get<InventoryMaterialDetail>(`/inventory/${materialId}`);
    return data;
  },
  async create(payload: Record<string, unknown>) {
    const { data } = await api.post<InventoryMaterial>("/inventory", payload);
    return data;
  },
  async update(materialId: number, payload: Record<string, unknown>) {
    const { data } = await api.put<InventoryMaterial>(`/inventory/${materialId}`, payload);
    return data;
  },
  async remove(materialId: number) {
    const { data } = await api.delete<{ message: string }>(`/inventory/${materialId}`);
    return data;
  },
  async postMovement(
    materialId: number,
    body: { action: InventoryMovementAction; quantity_delta: string | number; note?: string | null }
  ) {
    const { data } = await api.post<InventoryMovement>(`/inventory/${materialId}/movements`, body);
    return data;
  },
  async postPurchase(
    materialId: number,
    body: { quantity: string | number; purchase_amount?: string | number | null; note?: string | null }
  ) {
    const { data } = await api.post<InventoryMaterialDetail>(`/inventory/${materialId}/purchase`, body);
    return data;
  },
  async movements(params?: { material_id?: number; limit?: number; offset?: number }) {
    const qp: Record<string, number> = {};
    if (params?.material_id) qp.material_id = params.material_id;
    if (typeof params?.limit === "number") qp.limit = params.limit;
    if (typeof params?.offset === "number") qp.offset = params.offset;
    const { data } = await api.get<InventoryMovement[]>("/inventory/movements", { params: qp });
    return data;
  },
  async bulkDelete(ids: number[]) {
    const { data } = await api.post<{ message: string; deleted_ids: number[] }>("/inventory/bulk-delete", { ids });
    return data;
  },
  async bulkStockLevel(ids: number[], stock_level: InventoryMaterial["stock_level"]) {
    const { data } = await api.post<{ message: string; updated_ids: number[] }>("/inventory/bulk-stock-level", {
      ids,
      stock_level
    });
    return data;
  },
  async financialSummary() {
    const { data } = await api.get<InventoryFinancialSummary>("/inventory/financial-summary");
    return data;
  },
  async supplierFinancials() {
    const { data } = await api.get<InventorySupplierFinancialRow[]>("/inventory/supplier-financials");
    return data;
  },
  async listPayments(materialId: number) {
    const { data } = await api.get<InventoryPayment[]>(`/inventory/${materialId}/payments`);
    return data;
  },
  async addPayment(materialId: number, body: { amount: string | number; paid_at: string; note?: string | null }) {
    const { data } = await api.post<InventoryPayment>(`/inventory/${materialId}/payments`, body);
    return data;
  },
  async deletePayment(materialId: number, paymentId: number) {
    const { data } = await api.delete<{ message: string }>(
      `/inventory/${materialId}/payments/${paymentId}`
    );
    return data;
  },
  async bulkUpdate(
    ids: number[],
    patch: {
      stock_level?: InventoryMaterial["stock_level"];
      supplier_name?: string;
      category?: string | null;
    }
  ) {
    const { data } = await api.post<{ message: string; updated_ids: number[] }>("/inventory/bulk-update", {
      ids,
      ...patch
    });
    return data;
  }
};

export const toolsApi = {
  async list() {
    const { data } = await api.get<FactoryTool[]>("/tools");
    return data;
  },
  async getDetail(toolId: number, params?: { history_limit?: number }) {
    const { data } = await api.get<FactoryToolDetail>(`/tools/${toolId}`, { params });
    return data;
  },
  async create(body: { name: string; notes?: string | null }) {
    const { data } = await api.post<FactoryTool>("/tools", body);
    return data;
  },
  async update(toolId: number, body: { name?: string; notes?: string | null }) {
    const { data } = await api.put<FactoryTool>(`/tools/${toolId}`, body);
    return data;
  },
  async remove(toolId: number) {
    const { data } = await api.delete<{ message: string }>(`/tools/${toolId}`);
    return data;
  },
  async trackingDays(params?: { page?: number; per_page?: number }) {
    const { data } = await api.get<ToolTrackingDaysPage>("/tools/tracking/days", { params });
    return data;
  },
  async trackingByDay(params: {
    date: string;
    status?: "all" | "returned" | "in_use";
    page?: number;
    per_page?: number;
  }) {
    const { data } = await api.get<ToolTrackingRecordsPage>("/tools/tracking/by-day", { params });
    return data;
  },
  async checkout(body: { tool_id: number; borrower_name?: string | null; notes?: string | null; checkout_at?: string }) {
    const { data } = await api.post<ToolTrackingRecord>("/tools/tracking/checkout", body);
    return data;
  },
  async returnRecord(recordId: number, body?: { returned_at?: string | null }) {
    const { data } = await api.post<ToolTrackingRecord>(`/tools/tracking/${recordId}/return`, body ?? {});
    return data;
  }
};

export const machinesApi = {
  async list(params?: { search?: string; status?: MachineStatus }) {
    const { data } = await api.get<FactoryMachine[]>("/machines", { params });
    return data;
  },
  async create(body: Record<string, unknown>) {
    const { data } = await api.post<FactoryMachine>("/machines", body);
    return data;
  },
  async getDetail(machineId: number, params?: { activity_limit?: number }) {
    const { data } = await api.get<FactoryMachineDetail>(`/machines/${machineId}`, { params });
    return data;
  },
  async update(machineId: number, body: Record<string, unknown>) {
    const { data } = await api.put<FactoryMachine>(`/machines/${machineId}`, body);
    return data;
  },
  async remove(machineId: number) {
    const { data } = await api.delete<{ message: string }>(`/machines/${machineId}`);
    return data;
  },
  async postActivity(machineId: number, body: { kind: MachineActivity["kind"]; message?: string | null; new_status?: MachineStatus }) {
    const { data } = await api.post<MachineActivity>(`/machines/${machineId}/activities`, body);
    return data;
  }
};

export type EmployeePeriodParams = { period_year?: number; period_month?: number };

export const employeesApi = {
  async payrollPeriodsNav() {
    const { data } = await api.get<PayrollPeriodsNav>("/employees/periods");
    return data;
  },
  async startNextPayrollMonth() {
    const { data } = await api.post<PayrollPeriodsNav>("/employees/periods/start-next-month");
    return data;
  },
  async payrollSummary(params?: EmployeePeriodParams) {
    const { data } = await api.get<PayrollSummary>("/employees/payroll/summary", { params });
    return data;
  },
  async list(params?: EmployeePeriodParams) {
    const { data } = await api.get<EmployeeListItem[]>("/employees", { params });
    return data;
  },
  async exportCsv(params?: EmployeePeriodParams) {
    const res = await api.get("/employees/export", { responseType: "blob", params });
    const blob = res.data as Blob;
    const cd = res.headers["content-disposition"] as string | undefined;
    let filename = "employees_payroll_export.csv";
    if (cd) {
      const m = /filename="([^"]+)"/.exec(cd);
      if (m) filename = m[1];
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
  async getMe() {
    const { data } = await api.get<EmployeeDetail>("/employees/me");
    return data;
  },
  async patchMe(body: EmployeeSelfUpdatePayload) {
    const { data } = await api.patch<EmployeeDetail>("/employees/me", body);
    return data;
  },
  async get(employeeId: number, params?: EmployeePeriodParams) {
    const { data } = await api.get<EmployeeDetail>(`/employees/${employeeId}`, { params });
    return data;
  },
  async create(body: EmployeeCreatePayload) {
    const { data } = await api.post<EmployeeDetail>("/employees", body);
    return data;
  },
  async update(employeeId: number, body: EmployeeAdminUpdatePayload, params?: EmployeePeriodParams) {
    const { data } = await api.patch<EmployeeDetail>(`/employees/${employeeId}`, body, { params });
    return data;
  },
  async updatePayment(
    employeeId: number,
    body: { payment_status: "paid" | "unpaid"; payment_date?: string | null; payment_reference?: string | null },
    period: { period_year: number; period_month: number }
  ) {
    const { data } = await api.patch<EmployeeDetail>(`/employees/${employeeId}/payment`, body, {
      params: period
    });
    return data;
  },
  async remove(employeeId: number) {
    const { data } = await api.delete<{ message: string }>(`/employees/${employeeId}`);
    return data;
  },
  async addLateness(
    employeeId: number,
    body: { note?: string | null; confirm_financial_edit?: boolean },
    params?: EmployeePeriodParams
  ) {
    const { data } = await api.post<EmployeeDetail>(`/employees/${employeeId}/lateness`, body, { params });
    return data;
  },
  async deleteLateness(employeeId: number, entryId: number, params?: EmployeePeriodParams & { confirm_financial_edit?: boolean }) {
    const { data } = await api.delete<EmployeeDetail>(`/employees/${employeeId}/lateness/${entryId}`, { params });
    return data;
  },
  async addPenalty(
    employeeId: number,
    body: { description: string; amount: number; confirm_financial_edit?: boolean },
    params?: EmployeePeriodParams
  ) {
    const { data } = await api.post<EmployeeDetail>(`/employees/${employeeId}/penalties`, body, { params });
    return data;
  },
  async deletePenalty(employeeId: number, penaltyId: number, params?: EmployeePeriodParams & { confirm_financial_edit?: boolean }) {
    const { data } = await api.delete<EmployeeDetail>(`/employees/${employeeId}/penalties/${penaltyId}`, { params });
    return data;
  },
  async addBonus(
    employeeId: number,
    body: { description: string; amount: number; confirm_financial_edit?: boolean },
    params?: EmployeePeriodParams
  ) {
    const { data } = await api.post<EmployeeDetail>(`/employees/${employeeId}/bonuses`, body, { params });
    return data;
  },
  async deleteBonus(employeeId: number, bonusId: number, params?: EmployeePeriodParams & { confirm_financial_edit?: boolean }) {
    const { data } = await api.delete<EmployeeDetail>(`/employees/${employeeId}/bonuses/${bonusId}`, { params });
    return data;
  },
  async uploadDocument(employeeId: number, file: File, label?: string, params?: EmployeePeriodParams) {
    const fd = new FormData();
    fd.append("file", file);
    if (label?.trim()) fd.append("label", label.trim());
    const { data } = await api.post<EmployeeDetail>(`/employees/${employeeId}/documents`, fd, { params });
    return data;
  },
  async deleteDocument(employeeId: number, docId: string, params?: EmployeePeriodParams) {
    const { data } = await api.delete<EmployeeDetail>(`/employees/${employeeId}/documents/${encodeURIComponent(docId)}`, {
      params
    });
    return data;
  },
  async sendPaymentToFinance(
    employeeId: number,
    body: { amount: string | number; note?: string | null },
    period: { period_year: number; period_month: number }
  ) {
    const { data } = await api.post<EmployeeTransaction>(`/employees/${employeeId}/payments/send-to-finance`, body, {
      params: period
    });
    return data;
  },
  async transactions(employeeId: number, params?: EmployeePeriodParams) {
    const { data } = await api.get<EmployeeTransaction[]>(`/employees/${employeeId}/transactions`, { params });
    return data;
  }
};

export const contractEmployeesApi = {
  async list(params?: { search?: string; status?: "active" | "inactive"; overpaid?: boolean }) {
    const { data } = await api.get<ContractEmployeeListItem[]>("/contract-employees", { params });
    return data;
  },
  async get(employeeId: number) {
    const { data } = await api.get<ContractEmployeeDetail>(`/contract-employees/${employeeId}`);
    return data;
  },
  async create(body: ContractEmployeeCreatePayload) {
    const { data } = await api.post<ContractEmployeeDetail>("/contract-employees", body);
    return data;
  },
  async update(employeeId: number, body: ContractEmployeeUpdatePayload) {
    const { data } = await api.patch<ContractEmployeeDetail>(`/contract-employees/${employeeId}`, body);
    return data;
  },
  async increaseOwed(employeeId: number, body: { amount: string | number; note?: string | null }) {
    const { data } = await api.post<ContractEmployeeDetail>(`/contract-employees/${employeeId}/owed/increase`, body);
    return data;
  },
  async sendPaymentToFinance(employeeId: number, body: { amount: string | number; note?: string | null }) {
    const { data } = await api.post<EmployeeTransaction>(`/contract-employees/${employeeId}/payments/send-to-finance`, body);
    return data;
  },
  async remove(employeeId: number) {
    const { data } = await api.delete<{ action: "deleted" | "inactivated"; message: string }>(`/contract-employees/${employeeId}`);
    return data;
  }
};

export const employeePaymentsApi = {
  async pending(params?: {
    search?: string;
    kind?: "monthly" | "contract";
    overpaid?: boolean;
    sort?: "oldest" | "newest" | "amount_desc" | "amount_asc";
  }) {
    const { data } = await api.get<PendingEmployeePayments>("/employee-payments/pending", { params });
    return data;
  },
  async uploadReceipt(transactionId: number, file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const { data } = await api.post<EmployeeTransaction>(`/employee-payments/${transactionId}/receipt`, fd, {
      headers: { "Content-Type": "multipart/form-data" }
    });
    return data;
  },
  async markPaid(
    transactionId: number,
    options?: { confirm_without_receipt?: boolean; confirm_overpay?: boolean }
  ) {
    const params: Record<string, any> = {};
    if (options?.confirm_without_receipt === true) params.confirm_without_receipt = true;
    if (options?.confirm_overpay === true) params.confirm_overpay = true;
    const { data } = await api.post<EmployeeTransaction>(`/employee-payments/${transactionId}/mark-paid`, undefined, {
      params: Object.keys(params).length ? params : undefined
    });
    return data;
  },
  async reverse(transactionId: number, params?: { reason?: string }) {
    const { data } = await api.post<EmployeeTransaction>(`/employee-payments/${transactionId}/reverse`, undefined, { params });
    return data;
  },
  async cancelPending(transactionId: number) {
    const { data } = await api.post<EmployeeTransaction>(`/employee-payments/${transactionId}/cancel-pending`);
    return data;
  },
  async exportTransactions(params: { employee_id?: number; contract_employee_id?: number }) {
    const res = await api.get("/employee-payments/export", { responseType: "blob", params });
    const blob = res.data as Blob;
    const cd = res.headers["content-disposition"] as string | undefined;
    let filename = "employee_transactions.csv";
    if (cd) {
      const m = /filename="([^"]+)"/.exec(cd);
      if (m) filename = m[1];
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
  async bulkSend(body: {
    items: Array<{
      employee_kind: "monthly" | "contract";
      employee_id: number;
      period_year?: number;
      period_month?: number;
      amount: string | number;
      note?: string | null;
    }>;
  }) {
    const { data } = await api.post<{ created_transaction_ids: number[]; created: number }>("/employee-payments/bulk-send", body);
    return data;
  }
};

export const expensesApi = {
  async list(params?: { limit?: number; offset?: number }) {
    const { data } = await api.get<ExpenseEntry[]>("/expenses", { params });
    return data;
  },
  async summary() {
    const { data } = await api.get<ExpenseSummary>("/expenses/summary");
    return data;
  },
  async create(body: { entry_date: string; amount: string | number; entry_type: "expense" | "credit"; note?: string | null }) {
    const { data } = await api.post<ExpenseEntry>("/expenses", body);
    return data;
  },
  async uploadReceipt(entryId: number, file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const { data } = await api.post<ExpenseEntry>(`/expenses/${entryId}/receipt`, fd, {
      headers: { "Content-Type": "multipart/form-data" }
    });
    return data;
  },
  async exportCsv() {
    const res = await api.get("/expenses/export", { responseType: "blob" });
    const blob = res.data as Blob;
    const cd = res.headers["content-disposition"] as string | undefined;
    let filename = "petty_cash_expenses.csv";
    if (cd) {
      const m = /filename="([^"]+)"/.exec(cd);
      if (m) filename = m[1];
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
};

