# Clinic Booking API

A clinic appointment booking API and patient booking web page.

## What it is

The service lets patients view available doctor appointment slots, book an upcoming slot, and review confirmation details. The backend is built with FastAPI and Postgres on Neon using psycopg 3 in transaction-pooler mode. The frontend is a static page in `public/` using semantic HTML, vanilla JavaScript, and CSS.

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
- `API_KEY`: Secret string required in the `X-API-Key` header (enforced from Level 2).

## How to load the sample slots

Load 12 sample slots across two providers (Dr Ade and Dr Bello) in December 2026:
```bash
curl -X POST http://localhost:8000/reset -H "Content-Type: application/json" -d @sample_slots.json
```

## Endpoints

### POST /reset
Deletes every booking and replaces all slots with the ones sent, including slots in the past.
- Request body: `{"slots": [Slot, ...]}`
- Response 200: `{"ok": true}`

### GET /slots
Every slot, earliest start first. Optional query parameter `provider` (exact match).
- Query params: `provider` (optional)
- Response 200: `{"slots": [SlotWithAvailability, ...]}`

### POST /bookings
Creates a new confirmed booking for a slot.
- Request body: `NewBooking` (`slot_id`, `name`, `email`)
- Response 201: `Booking` (status `"confirmed"`)

### GET /bookings/{id}
Retrieves booking details by id.
- Response 200: `Booking`
- Response 404: `{"error": "booking not found"}`

## Known limitations

- Level 1 does not yet enforce API key authentication (added in Level 2).
- Level 1 does not yet prevent double booking of the same slot (added in Level 3).
- The API key in the web page (`public/app.js`) is client-side and visible to anyone who opens browser dev tools.
