import { api } from "./api";
import type {
  Customer,
  CustomerCreate,
  InvoiceDetail,
  InvoiceListItem,
  LoginRequest,
  LoginResponse,
  Order,
  OrderAdminUpdate,
  User,
  UserCreate
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
      amount_paid?: string | number | null;
      balance?: string | number | null;
      payment_status?: string | null;
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
  async list() {
    const { data } = await api.get<InvoiceListItem[]>("/invoices");
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
  async sendEmail(invoiceId: number) {
    const { data } = await api.post<{ message: string }>(`/invoices/${invoiceId}/send-email`);
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

