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
- Header: `Idempotency-Key` (optional string)
- Request body: `NewBooking` (`slot_id`, `name`, `email`)
- Response 201: `Booking` (status `"confirmed"`)
- Response 400: Missing/empty fields, invalid email format, or slot has already started (`start <= now`). Name and email are trimmed; email is stored in lower case.
- Response 404: `{"error": "slot not found"}`
- Response 409: `{"error": "slot already booked"}`
- Response 422: `{"error": "idempotency key mismatch"}` (same key sent with different payload)

### GET /bookings
Returns that person's bookings, oldest first, using keyset cursor pagination.
- Query params: `email` (required, case-insensitive), `limit` (optional integer 1–50, default 10), `cursor` (optional opaque base64 string)
- Response 200: `{"bookings": [Booking, ...], "next_cursor": string or null}`
- Response 400: Missing email, invalid limit, or malformed cursor.

### GET /bookings/{id}
Retrieves booking details by id.
- Response 200: `Booking`
- Response 404: `{"error": "booking not found"}`

### DELETE /bookings/{id}
Sets status to cancelled and frees the slot.
- Response 200: `Booking` (status `"cancelled"`)
- Response 404: `{"error": "booking not found"}`
- Response 409: `{"error": "booking already cancelled"}`

## How Level 3 works

Slot uniqueness is guaranteed in PostgreSQL using a partial unique index on `bookings(slot_id) WHERE status = 'confirmed'`. Concurrent booking attempts on the same slot trigger a database unique violation that is caught and translated to `409` conflict without error-prone check-then-insert application logic. Cancellations use a single atomic `UPDATE ... WHERE id = ... AND status = 'confirmed' RETURNING ...`, falling back to an ID lookup only when no row was updated to distinguish between `404` and `409`. This ensures concurrent cancellations of the same booking yield exactly one `200` and all others `409`.

## How Level 4 works

Idempotency on `POST /bookings` uses a transaction-level advisory lock (`pg_advisory_xact_lock`) on the hash of the key so concurrent requests with the same key serialize safely. The request body is hashed using canonical JSON with sorted keys before trimming. Stored records are created in the same database transaction as the booking so they commit or roll back together, caching only successful 201 responses. Keyset pagination on `GET /bookings` uses the monotonically increasing `seq` identity column with an opaque URL-safe base64 cursor, querying `limit + 1` rows to deterministically compute `next_cursor` even across concurrent booking insertions and cancellations.

## Known limitations

- Level 4 does not yet rate limit booking attempts (added in Level 5).
