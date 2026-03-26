from fastapi import FastAPI
from app.database import engine, Base
from app import models
from app.auth.auth import router as auth_router
from fastapi import Depends
from app.auth.auth import get_current_user
from app.routes.customers import router as customers_router
from app.routes.users import router as users_router
from app.routes.orders import router as orders_router
from app.routes.products import router as products_router


app = FastAPI()
# Create tables
Base.metadata.create_all(bind=engine)

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


