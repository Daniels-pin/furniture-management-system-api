# Furniture Management Frontend

## Setup

1. Create env file:
   - Copy `.env.example` to `.env`
   - Set `VITE_API_URL` (or `VITE_API_BASE_URL`):
     - Dev: `http://localhost:8000` (or use `.env.development`)
     - Prod: your deployed backend URL (Vercel env recommended)

2. Install and run:

```bash
cd frontend
npm install
npm run dev
```

## Notes

- Auth token is stored in `localStorage` and attached via Axios interceptors.
- Routes are protected; unauthenticated users are redirected to `/login`.

