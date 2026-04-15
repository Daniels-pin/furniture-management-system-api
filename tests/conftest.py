"""
Test setup: in-memory SQLite + dependency override so tests do not require DATABASE_URL
or pre-seeded users. Must set env vars before importing app modules that read config.
"""
from __future__ import annotations

import os

# Config used by app.config / database / JWT (before any app imports).
# Force a local SQLite URL for the app's module-level engine; requests use the in-memory override below.
os.environ["DATABASE_URL"] = "sqlite:///./_pytest_app_dummy.db"
os.environ.setdefault("SECRET_KEY", "pytest-secret-key-at-least-32-characters-long")
os.environ.setdefault("ALGORITHM", "HS256")
os.environ.setdefault("ACCESS_TOKEN_EXPIRE_MINUTES", "60")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth.utils import hash_password
from app.database import get_db
from app.db.base_class import Base

# Register ORM models on Base.metadata before importing the FastAPI app.
import app.db.base  # noqa: F401, E402
from app import models  # noqa: E402
from app.main import app as fastapi_app

_test_engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_test_engine)


def _seed_users() -> None:
    db = TestingSessionLocal()
    try:
        db.add(
            models.User(
                name="admin",
                email="admin@company.com",
                password=hash_password("admin123"),
                role="admin",
            )
        )
        db.add(
            models.User(
                name="showroom",
                email="showroom@company.com",
                password=hash_password("showroom123"),
                role="showroom",
            )
        )
        db.add(
            models.User(
                name="factory",
                email="factory@company.com",
                password=hash_password("factory123"),
                role="factory",
            )
        )
        db.commit()
    finally:
        db.close()


@pytest.fixture(autouse=True)
def _fresh_db() -> None:
    Base.metadata.drop_all(bind=_test_engine)
    Base.metadata.create_all(bind=_test_engine)
    _seed_users()
    yield


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


fastapi_app.dependency_overrides[get_db] = _override_get_db


@pytest.fixture
def client():
    from fastapi.testclient import TestClient

    return TestClient(fastapi_app)


@pytest.fixture
def db_session():
    """Direct DB access for tests (same engine as client override)."""
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def admin_token(client):
    r = client.post(
        "/auth/login",
        json={"email": "admin@company.com", "password": "admin123"},
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture
def showroom_token(client):
    r = client.post(
        "/auth/login",
        json={"email": "showroom@company.com", "password": "showroom123"},
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture
def factory_token(client):
    r = client.post(
        "/auth/login",
        json={"email": "factory@company.com", "password": "factory123"},
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]
