from app.database import SessionLocal
from app.models import User
from app.auth.utils import hash_password

db = SessionLocal()

admin = User(
    name="Admin",
    email="admin@nolimits.com",
    password=hash_password("admin123"),
    role="admin"
)

db.add(admin)
db.commit()
db.close()

print("Admin created successfully ✅")
