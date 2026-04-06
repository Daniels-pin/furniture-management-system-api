import os

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth.auth import get_current_user
from app.auth.auth import router as auth_router
from app.routes.customers import router as customers_router
from app.routes.dashboard import router as dashboard_router
from app.routes.audit import router as audit_router
from app.routes.proforma import router as proforma_router
from app.routes.quotation import router as quotation_router
from app.routes.waybill import router as waybill_router
from app.routes.invoices import router as invoices_router
from app.routes.orders import router as orders_router
from app.routes.products import router as products_router
from app.routes.users import router as users_router
from app.routes.admin_impersonate import router as admin_impersonate_router
from app.routes.trash import router as trash_router
from app.routes.inventory import router as inventory_router

app = FastAPI() 

frontend_origins_env = os.getenv("FRONTEND_ORIGINS", "")
frontend_origins = [o.strip() for o in frontend_origins_env.split(",") if o.strip()]

# Stable CORS allowlist:
# - Works with credentials (Authorization header / cookies)
# - No wildcard origin ("*") so browsers can send credentials safely
# - Supports both local dev and deployed frontend(s)
_default_dev_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

_cors_origins = []
_cors_origins.extend(_default_dev_origins)
_cors_origins.extend([o for o in frontend_origins if o and o != "*"])
_cors_origins = list(dict.fromkeys(_cors_origins))  # de-dupe, keep order

_cors_credentials = True

# Phones and other devices hitting the Vite dev server use http://<LAN-IP>:5173, which is
# not in the localhost list above; without this, browsers block API calls after preflight.
_cors_allow_lan = os.getenv("CORS_ALLOW_LAN_ORIGINS", "1").strip().lower() in (
    "1",
    "true",
    "yes",
)
_private_net_origin_regex = (
    r"^https?://("
    r"localhost|127\.0\.0\.1|"
    r"192\.168\.\d{1,3}\.\d{1,3}|"
    r"10\.\d{1,3}\.\d{1,3}\.\d{1,3}|"
    r"172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}"
    r")(:\d+)?$"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=_cors_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_origin_regex=_private_net_origin_regex if _cors_allow_lan else None,
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
app.include_router(admin_impersonate_router)
app.include_router(trash_router)
app.include_router(products_router, tags=["Products"])
app.include_router(orders_router, tags=["Orders"])
app.include_router(invoices_router, tags=["Invoices"])
app.include_router(dashboard_router, tags=["Dashboard"])
app.include_router(audit_router, tags=["Audit"])
app.include_router(proforma_router, tags=["Proforma"])
app.include_router(quotation_router, tags=["Quotations"])
app.include_router(waybill_router, tags=["Waybills"])
app.include_router(inventory_router, tags=["Inventory"])

