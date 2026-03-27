from pydantic import BaseModel, EmailStr
from datetime import datetime
from typing import List, Optional
from enum import Enum

class OrderItemSchema(BaseModel):
    item_name: str
    description: Optional[str] = None
    quantity: int


class OrderCreate(BaseModel):
    customer_id: int
    items: List[OrderItemSchema]
    due_date: datetime

class OrderStatus(str, Enum):
    pending = "pending"
    in_progress = "in_progress"
    completed = "completed"
    delivered = "delivered"

class UserRole(str, Enum):
    showroom = "showroom"
    manager = "manager"
    admin = "admin"

class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: UserRole

class UserResponse(BaseModel):
    id: int
    name: str
    email: str
    role: UserRole

    class Config:
        orm_mode = True


class LoginRequest(BaseModel):
    email: str
    password: str


class OrderResponse(BaseModel):
    order_id: int
    status: str
    due_date: datetime