import os

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth.auth import get_current_user
from app.auth.auth import router as auth_router
from app.routes.customers import router as customers_router
from app.routes.dashboard import router as dashboard_router
from app.routes.invoices import router as invoices_router
from app.routes.orders import router as orders_router
from app.routes.users import router as users_router

app = FastAPI() 

frontend_origins_env = os.getenv("FRONTEND_ORIGINS", "")
frontend_origins = [o.strip() for o in frontend_origins_env.split(",") if o.strip()]

# CORS: comma-separated FRONTEND_ORIGINS (https://app.example.com,...).
# Temporary testing only: set FRONTEND_ORIGINS=* (wildcard; cannot use credentials with *).
_use_cors_wildcard = frontend_origins == ["*"]
if _use_cors_wildcard:
    _cors_origins = ["*"]
    _cors_regex = None
    _cors_credentials = False
elif frontend_origins:
    _cors_origins = [o for o in frontend_origins if o != "*"]
    _cors_regex = None
    _cors_credentials = True
else:
    _cors_origins = []
    _cors_regex = r"^http://(localhost|127\.0\.0\.1)(:\d+)?$"
    _cors_credentials = True

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_origin_regex=_cors_regex,
    allow_credentials=_cors_credentials,
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
app.include_router(invoices_router, tags=["Invoices"])
app.include_router(dashboard_router, tags=["Dashboard"])

