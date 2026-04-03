import { api } from "./api";
import type {
  AuditLogItem,
  Customer,
  CustomerCreate,
  InvoiceDetail,
  InvoiceListItem,
  LoginRequest,
  LoginResponse,
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
  WaybillListItem
} from "../types/api";

export const authApi = {
  async login(payload: LoginRequest) {
    const { data } = await api.post<LoginResponse>("/auth/login", payload);
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
      total_price?: string | number | null;
      discount_type?: "fixed" | "percentage" | null;
      discount_value?: string | number | null;
      discount_amount?: string | number | null;
      final_price?: string | number | null;
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
      total_price?: string | number | null;
      discount_type?: "fixed" | "percentage" | null;
      discount_value?: string | number | null;
      discount_amount?: string | number | null;
      final_price?: string | number | null;
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
      tax?: string | number | null;
      balance?: string | number | null;
      payment_status?: string | null;
    }>(`/orders/${orderId}`, payload);
    return data;
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
    let filename = `proforma-${id}.html`;
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
    let filename = `quotation-${id}.html`;
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
  async create(orderId: number) {
    const { data } = await api.post<WaybillDetail>("/waybills", { order_id: orderId });
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
    let filename = `waybill-${id}.html`;
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

