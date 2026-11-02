# Clinic Booking API

A clinic appointment booking API built with FastAPI and PostgreSQL on Neon.

## What it is

The service lets clients view available doctor appointment slots, book an upcoming slot, and review confirmation details. The backend is built with FastAPI and Postgres on Neon using psycopg 3 in transaction-pooler mode.

## Run locally

Install dependencies:
```bash
pip install -r requirements.txt -r requirements-dev.txt
```

Apply database schema:
```bash
python -c "from db import get_connection; from pathlib import Path; sql = Path('schema.sql').read_text(); [conn.execute(sql) for conn in [None] if False];
with get_connection() as conn:
    conn.execute(sql)
    conn.commit()
"
```

Start the local server:
```bash
uvicorn main:app --port 8000
```

Run test suite:
```bash
pytest -v
```

## Environment variables

- `DATABASE_URL`: Postgres connection string (Neon pooled connection host containing `-pooler`).
- `API_KEY`: Secret string required in the `X-API-Key` header on every request. Missing or incorrect keys return 401.

## How to load the sample slots

Load 12 sample slots across two providers (Dr Ade and Dr Bello) in December 2026:
```bash
curl -X POST http://localhost:8000/reset \
  -H "X-API-Key: your_api_key_here" \
  -H "Content-Type: application/json" \
  --data-binary "@sample_slots.json"
```

## Endpoints

All requests require the `X-API-Key` header. Missing or invalid keys return 401 with `{"error": "unauthorized"}`.

### POST /reset
Deletes every booking and replaces all slots with the ones sent, including slots in the past.
- Request body: `{"slots": [Slot, ...]}`
- Response 200: `{"ok": true}`
- Response 400: Malformed body, missing fields, non-string id or provider, bad timestamps, or duplicate slot ids.

### GET /slots
Every slot, earliest start first. Optional query parameter `provider` (exact match).
- Query params: `provider` (optional)
- Response 200: `{"slots": [SlotWithAvailability, ...]}`

### POST /bookings
Creates a new confirmed booking for a slot.
- Request body: `NewBooking` (`slot_id`, `name`, `email`)
- Response 201: `Booking` (status `"confirmed"`)
- Response 400: Missing/empty fields, invalid email format, or slot has already started (`start <= now`). Name and email are trimmed; email is stored in lower case.
- Response 404: `{"error": "slot not found"}`

### GET /bookings/{id}
Retrieves booking details by id.
- Response 200: `Booking`
- Response 404: `{"error": "booking not found"}`

## Known limitations

- Level 2 does not yet prevent double booking of the same slot under concurrent requests (added in Level 3).
- Level 2 does not yet provide idempotency keys for safely retrying booking requests (added in Level 4).
- Level 2 does not yet rate limit booking attempts (added in Level 5).
