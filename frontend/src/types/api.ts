export type Role = "showroom" | "manager" | "admin";

export type LoginRequest = { email: string; password: string };
export type LoginResponse = { access_token: string; token_type: "bearer" | string };

export type Customer = {
  id: number;
  name: string;
  phone?: string;
  address?: string;
};

export type CustomerCreate = {
  name: string;
  phone: string;
  address: string;
};

export type OrderStatus = "pending" | "in_progress" | "completed" | "delivered";

export type OrderCreateItem = {
  item_name: string;
  description: string;
  quantity: number;
};

export type OrderItem = {
  id: number;
  item_name: string;
  description?: string | null;
  quantity: number;
};

export type Order = {
  id: number;
  status: OrderStatus;
  due_date?: string | null;
  created_at: string;
  image_url?: string | null;
  customer: Customer;
  items: OrderItem[];
  total_price?: string | number | null;
  amount_paid?: string | number | null;
  balance?: string | number | null;
  payment_status?: string | null;
};

export type OrderUploadResponse = {
  order_id: number;
  customer_id: number;
  quantity: number;
  item_name: string;
  description?: string | null;
  image_url?: string | null;
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

