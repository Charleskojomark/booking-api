# Clinic Booking System (API & Web App)

A complete clinic appointment booking system consisting of a high-performance **FastAPI + PostgreSQL (Neon)** backend API and a modern **Next.js (React 19 + Tailwind CSS)** patient web portal.

Deployed live on Vercel:
- **Backend API Base URL**: `https://booking-api-ashy.vercel.app`
- **Patient Web Application URL**: `https://booking-clinic-web.vercel.app`

---

## Architecture Overview

```
                      ┌────────────────────────────────────────┐
                      │              Web Browser               │
                      │   (Patient UI: booking-clinic-web)     │
                      └──────────────────┬─────────────────────┘
                                         │ Requests (NO API KEY in browser)
                                         ▼
                      ┌────────────────────────────────────────┐
                      │            Next.js Server              │
                      │  - Securely holds API_KEY in env       │
                      │  - Proxies calls to FastAPI backend    │
                      │  - Attaches Idempotency-Key headers    │
                      └──────────────────┬─────────────────────┘
                                         │ Secure Internal Requests + X-API-Key
                                         ▼
                      ┌────────────────────────────────────────┐
                      │            FastAPI Backend             │
                      │      (https://booking-api-ashy...)     │
                      └──────────────────┬─────────────────────┘
                                         │ Transaction-Level Pooler
                                         ▼
                      ┌────────────────────────────────────────┐
                      │          PostgreSQL Database           │
                      │     (Neon Cloud - us-east-2 / AWS)     │
                      └────────────────────────────────────────┘
```

### Security & Decoupled Architecture
The frontend and backend reside in a single repository for version control clarity, but are deployed as two decoupled services:
1. **FastAPI Backend (`/`)**: Requires `X-API-Key` on every request. Direct database connectivity via `psycopg_pool`.
2. **Next.js Frontend (`/frontend`)**: Server-side Route Handlers (`/api/slots`, `/api/bookings`, `/api/reset`) securely read `API_KEY` from environment variables and forward requests to the FastAPI backend. **The API key is never exposed to the client bundle or browser DevTools network tab.**

---

## Five Levels of Implementation

### Level 1: Core Booking Flow
- `POST /reset`: Clears existing bookings and re-populates appointment slots.
- `GET /slots`: Lists slots ordered by `start` ASC, then `id` ASC. Automatically computes `available: boolean` (true if no confirmed booking exists for that slot). Supports `?provider=...` filtering.
- `POST /bookings`: Creates booking with a generated `bk_` ID and ISO-8601 UTC timestamp with millisecond precision.
- `GET /bookings/{id}`: Looks up a booking by ID.

### Level 2: Authentication & Strict Input Validation
- `X-API-Key` header enforced across all endpoints using constant-time string comparison (`secrets.compare_digest`). Missing or incorrect keys return `401 {"error": "unauthorized"}`.
- Validates non-empty string types, email regex pattern (`^[^@\s]+@[^@\s]+\.[^@\s]+$`), slot existence (`404`), and rejects booking slots that have already started (`400`). Trims patient name and normalizes email to lowercase.

### Level 3: Concurrency Protection & Cancellations
- **Zero Double-Bookings**: Backed by a PostgreSQL partial unique index:
  ```sql
  CREATE UNIQUE INDEX idx_bookings_slot_confirmed ON bookings (slot_id) WHERE status = 'confirmed';
  ```
  Even when concurrent requests hit at the exact same millisecond, exactly one succeeds (`201`) and all others receive `409 {"error": "slot already booked"}`.
- **Cancellations (`DELETE /bookings/{id}`)**: Atomic status update to `'cancelled'`. Concurrently cancelling the same booking yields exactly one `200` and `409` on subsequent attempts. Cancelling automatically frees the slot for other patients.

### Level 4: Idempotency & Keyset Pagination
- **Idempotency (`Idempotency-Key` header)**: Cached in `idempotency_keys` table with SHA-256 canonical payload hashing and PostgreSQL transaction advisory locks (`pg_advisory_xact_lock`).
  - Identical retry returns identical cached `201` response.
  - Same key with mismatched payload returns `422 {"error": "idempotency key mismatch"}`.
  - Failed attempts (e.g. 400, 404, 409) do not cache and allow clean retries.
- **Keyset Pagination (`GET /bookings?email=...&limit=...&cursor=...`)**:
  - Deterministic oldest-first ordering based on database identity column `seq`.
  - Base64 opaque cursor. Fetches `limit + 1` rows to cleanly produce `next_cursor` or `null` when exhausted.

### Level 5: Rate Limiting / Anti-Spam
- Enforces a sliding-window rate limit of **5 booking attempts per email per 60-second window**.
- Tracks attempts in a dedicated `booking_attempts` table.
- Atomic verification with database clock (`NOW() - INTERVAL '60 seconds'`) and advisory locking on the email.
- Exceeded rate limit returns `429 {"error": "rate limit exceeded"}` and a standard `Retry-After: <seconds>` header.
- Failed booking attempts (e.g. 409 slot taken) consume attempt quota; 429 rejections do not increment the count.

---

## Local Development & Setup

### 1. Backend Setup
Prerequisites: Python 3.11+
```bash
# Install dependencies
pip install -r requirements.txt -r requirements-dev.txt

# Configure environment (.env)
DATABASE_URL=postgresql://user:password@host/neondb?sslmode=require
API_KEY=your_api_key_here

# Run automated test suite (31 tests)
pytest -v

# Start FastAPI server
uvicorn main:app --port 8000 --reload
```

### 2. Frontend Setup
Prerequisites: Node.js 18+
```bash
cd frontend

# Install dependencies
npm install

# Configure environment (.env.local)
API_BASE_URL=http://localhost:8000
API_KEY=your_api_key_here

# Run Next.js development server
npm run dev
```

Visit `http://localhost:3000` to interact with the patient booking portal.

---

## Test Verification

The test suite in `tests/test_api.py` includes **31 end-to-end tests** covering:
- Contract status codes and schemas (`{"error": ...}` on every failure)
- API key authentication (present, missing, invalid)
- Concurrency test suites with multi-threaded workers for simultaneous bookings and simultaneous cancels
- Canonical idempotency payload matching, hash collisions, and retry semantics
- Keyset cursor pagination boundaries
- Rate limiting sliding window, `Retry-After` calculation, and reset behavior

To run the tests against the live deployed production API:
```bash
$env:BASE_URL="https://booking-api-ashy.vercel.app"
$env:API_KEY="your_api_key_here"
pytest -v
```
