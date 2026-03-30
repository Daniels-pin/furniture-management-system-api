from pydantic import BaseModel, EmailStr
from datetime import datetime
from typing import List, Optional
from enum import Enum

class OrderItemCreate(BaseModel):
    item_name: str
    description: Optional[str] = None
    quantity: int

class CustomerCreate(BaseModel):
    name: str
    phone: str
    address: str

class OrderCreate(BaseModel):
    customer: CustomerCreate    #instead of customer_id
    items: List[OrderItemCreate]
    due_date: Optional[datetime] = None

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

class OrderItemResponse(BaseModel):
    id: int
    item_name: str
    description: Optional[str]
    quantity: int

    class Config:
        orm_mode = True

class OrderResponse(BaseModel):
    id: int
    customer_id: int
    status: OrderStatus
    due_date: Optional[datetime]
    created_at: datetime
    items: List[OrderItemResponse]

    class Config:
        orm_mode = True