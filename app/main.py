import os

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth.auth import get_current_user
from app.auth.auth import router as auth_router
from app.routes.customers import router as customers_router
from app.routes.dashboard import router as dashboard_router
from app.routes.audit import router as audit_router
from app.routes.invoices import router as invoices_router
from app.routes.orders import router as orders_router
from app.routes.users import router as users_router

app = FastAPI() 

frontend_origins_env = os.getenv("FRONTEND_ORIGINS", "")
frontend_origins = [o.strip() for o in frontend_origins_env.split(",") if o.strip()]

# Optional: comma-separated regex patterns for allowed origins (advanced).
# Example: FRONTEND_ORIGIN_REGEXES=^https://.+\\.vercel\\.app$,^https://app\\.example\\.com$
frontend_origin_regexes_env = os.getenv("FRONTEND_ORIGIN_REGEXES", "")
frontend_origin_regexes = [
    r.strip() for r in frontend_origin_regexes_env.split(",") if r.strip()
]

# CORS configuration:
# - Set FRONTEND_ORIGINS to a comma-separated list of allowed production origins
#   (e.g. "https://app.example.com,https://www.app.example.com").
# - Local development (localhost / 127.0.0.1) is allowed by default to enable running
#   the frontend locally against a deployed backend.
# - Avoid using "*" when credentials are required.
_allow_localhost = (os.getenv("ALLOW_LOCALHOST_CORS", "true") or "").strip().lower() in {
    "1",
    "true",
    "yes",
    "y",
    "on",
}

_use_cors_wildcard = frontend_origins == ["*"]
if _use_cors_wildcard:
    # Wildcard cannot be combined with credentials (cookies / auth) in browsers.
    _cors_origins = ["*"]
    _cors_regex = None
    _cors_credentials = False
else:
    _cors_origins = [o for o in frontend_origins if o != "*"]
    _cors_regex_parts: list[str] = []
    if _allow_localhost:
        _cors_regex_parts.append(r"^http://(localhost|127\.0\.0\.1)(:\d+)?$")
    _cors_regex_parts.extend(frontend_origin_regexes)
    _cors_regex = "|".join(f"(?:{p})" for p in _cors_regex_parts) if _cors_regex_parts else None
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
app.include_router(audit_router, tags=["Audit"])

