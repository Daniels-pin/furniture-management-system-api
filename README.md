# Furniture Order Management API

A FastAPI backend and React frontend for managing furniture manufacturing orders, presales documents (quotations, proforma invoices), invoices, waybills, and customer workflows.

## Features

- JWT authentication and role-based access (admin, manager, showroom)
- Customers, products, and multi-line orders with status tracking
- **Quotations** and **proforma invoices** (draft → finalized → conversion)
- **Invoices** linked to orders, with payment-related fields
- **Waybills** for delivery documentation
- Dashboard and reminders (e.g. orders due within 14 days)
- **PDF export** for invoices, quotations, proforma, waybills, and orders (server renders the same React “document” views via headless Chromium)
- Optional **HTML email** with PDF attachments (SMTP) and optional **Cloudinary** for assets
- Database migrations with **Alembic**; automated tests with **pytest**

## Project layout

| Path | Purpose |
|------|---------|
| `app/` | FastAPI application (routes, models, auth, utilities) |
| `alembic/` | SQLAlchemy/Alembic migration scripts |
| `frontend/` | Vite + React SPA (dashboard, forms, document previews, `/pdf-export/...` routes for PDF generation) |
| `tests/` | pytest suite (uses in-memory SQLite; no Postgres required for tests) |
| `scripts/playwright_render_install.sh` | Installs Chromium for Playwright (e.g. on Render after `pip install`) |

## Tech stack

**Backend:** FastAPI, PostgreSQL, SQLAlchemy 2, Pydantic, Alembic, Uvicorn, Playwright (Chromium for PDFs)

**Frontend:** React, Vite, TypeScript, Tailwind CSS

## Prerequisites

- Python 3.11+ (recommended)
- Node.js 18+ (for the frontend)
- PostgreSQL (for local/production API; tests use SQLite only)

## Backend setup

From the repository root:

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate

pip install -r requirements.txt
```

Create a `.env` file in the project root (see [Environment variables](#environment-variables)). Apply migrations:

```bash
alembic upgrade head
```

Run the API (reload for development):

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API root: `http://localhost:8000` — OpenAPI docs: `http://localhost:8000/docs`.

### PDF generation (Playwright)

PDFs are produced by opening the deployed or local SPA’s `/pdf-export/{document}/{id}?token=...` in headless Chromium. Install a browser once:

```bash
python -m playwright install chromium
```

On constrained hosts (e.g. Render), use the provided script after `pip install` so the browser path matches runtime:

```bash
bash scripts/playwright_render_install.sh
```

Optional: `PDF_RENDER_TIMEOUT_MS` (default `120000`), `PLAYWRIGHT_BROWSERS_PATH` (custom browser install directory).

## Frontend setup

The SPA lives in `frontend/` and talks to the API using `VITE_API_URL` or `VITE_API_BASE_URL`.

```bash
cd frontend
npm install
cp .env.example .env.local   # then set VITE_API_URL to your API origin
npm run dev
```

Default dev server: `http://localhost:5173`. CORS allows common localhost ports and, by default, private LAN origins (`CORS_ALLOW_LAN_ORIGINS`, see below).

Production build:

```bash
npm run build
npm run preview   # optional local preview of dist/
```

### Logo URL for documents and PDFs

Set the same absolute logo URL on the API (`INVOICE_LOGO_URL` or `PUBLIC_LOGO_URL`) and on the frontend (`VITE_LOGO_URL` or `VITE_PUBLIC_LOGO_URL`) so emails, on-screen documents, and PDFs stay consistent.

## Environment variables

### Required for a real database

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string, e.g. `postgresql+psycopg2://user:pass@host:5432/dbname` |
| `SECRET_KEY` | Long random string for JWT signing |
| `ALGORITHM` | JWT algorithm (commonly `HS256`) |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Access token lifetime (e.g. `60`) |

### CORS and frontend origins

| Variable | Description |
|----------|-------------|
| `FRONTEND_ORIGINS` | Comma-separated allowed origins (e.g. `https://app.example.com`) |
| `FRONTEND_DEV_URL` | Optional single origin fallback for tooling/PDF base resolution |
| `CORS_ALLOW_LAN_ORIGINS` | Default `1` — allows regex for common private LAN dev URLs |

### PDF rendering (API must reach the SPA)

| Variable | Description |
|----------|-------------|
| `FRONTEND_PDF_BASE_URL` | **Preferred:** full origin of the built SPA used for PDF (e.g. `https://your-spa.example.com`). On cloud hosting, must not be `localhost` if the API cannot reach your laptop. |
| `RENDER` | When set to `true`/`1`/`yes`, localhost PDF base URLs are rejected to avoid silent failures. |

Resolution order for the PDF base URL: `FRONTEND_PDF_BASE_URL` → first `FRONTEND_ORIGINS` entry → `FRONTEND_DEV_URL` → `http://127.0.0.1:5173`.

### Email (optional)

| Variable | Description |
|----------|-------------|
| `SMTP_HOST` | SMTP server hostname |
| `SMTP_PORT` | Port (default `587`) |
| `SMTP_USER` / `SMTP_PASSWORD` | Credentials if required |
| `SMTP_FROM` | From address (defaults to `SMTP_USER`) |
| `SMTP_TLS` | Default `true` |

### Other (optional)

| Variable | Description |
|----------|-------------|
| `INVOICE_LOGO_URL` / `PUBLIC_LOGO_URL` | Absolute URL to logo in HTML emails |
| `CLOUD_NAME`, `API_KEY`, `API_SECRET` | Cloudinary (if used) |

## Testing

```bash
pytest
```

Tests set `DATABASE_URL` to a local SQLite file and seed data via `tests/conftest.py`; you do not need Postgres running for pytest.
