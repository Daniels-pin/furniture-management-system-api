import { api } from "./api";
import type {
  Customer,
  CustomerCreate,
  LoginRequest,
  LoginResponse,
  Order,
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
  async create(payload: CustomerCreate) {
    const { data } = await api.post<Customer>("/customers", payload);
    return data;
  }
};

export const ordersApi = {
  async list() {
    const { data } = await api.get<Order[]>("/orders");
    return data;
  },
  async createMultipart(form: FormData) {
    const { data } = await api.post<Order>("/orders", form, {
      headers: { "Content-Type": "multipart/form-data" }
    });
    return data;
  },
  async delete(orderId: number) {
    const { data } = await api.delete<{ message: string }>(`/orders/${orderId}`);
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

