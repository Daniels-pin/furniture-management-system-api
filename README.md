# Furniture Order Management API

A FastAPI backend system for managing furniture manufacturing orders.

## Features

- JWT Authentication
- Role-Based Access Control (Admin, Manager, Showroom)
- Customer & Product Management
- Order Creation with Multiple Items
- Order Status Tracking
- Reminder System (due in 14 days)
- Automated Testing with pytest

## Tech Stack

- FastAPI
- PostgreSQL
- SQLAlchemy
- Pydantic
- Pytest

## Frontend (React)

The frontend lives in `frontend/` and connects to this API via `VITE_API_BASE_URL`.

```bash
cd frontend
npm install
npm run dev
```

## Setup

```bash
pip install -r requirements.txt