import os

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth.auth import get_current_user
from app.auth.auth import router as auth_router
from app.routes.customers import router as customers_router
from app.routes.orders import router as orders_router
from app.routes.products import router as products_router
from app.routes.users import router as users_router

app = FastAPI() 

frontend_origins_env = os.getenv("FRONTEND_ORIGINS", "")
frontend_origins = [o.strip() for o in frontend_origins_env.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=frontend_origins or ["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:5500"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
 )


@app.get("/")
def home():
    return {"message": "Furniture API is running 🚀"}

app.include_router(auth_router, prefix="/auth", tags=["Auth"])

@app.get("/protected")
def protected(user = Depends(get_current_user)):
    return {"message": f"Hello {user.name}, role: {user.role}"}

app.include_router(customers_router, tags=["Customers"])
app.include_router(users_router, tags=["Users"])
app.include_router(orders_router, tags=["Orders"])
app.include_router(products_router, tags=["Products"])

