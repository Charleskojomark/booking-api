import json
import os
import secrets
import uuid
from datetime import UTC, datetime

import anyio.from_thread
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from db import get_connection
from schemas import Booking, SlotWithAvailability


def format_utc(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    else:
        dt = dt.astimezone(UTC)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def format_iso_ms(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    else:
        dt = dt.astimezone(UTC)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def parse_iso(val: str) -> datetime:
    clean = val.strip()
    if clean.endswith(("Z", "z")):
        clean = clean[:-1] + "+00:00"
    dt = datetime.fromisoformat(clean)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    else:
        dt = dt.astimezone(UTC)
    return dt


from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    message = exc.detail if isinstance(exc.detail, str) else "error"
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": message},
        headers=exc.headers,
    )


@app.exception_handler(StarletteHTTPException)
def starlette_http_exception_handler(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    message = (
        exc.detail
        if isinstance(exc.detail, str)
        else (
            "not found"
            if exc.status_code == 404
            else "method not allowed"
            if exc.status_code == 405
            else "error"
        )
    )
    if exc.status_code == 404 and message.lower() in ("not found", "not_found"):
        message = "not found"
    elif exc.status_code == 405 and message.lower() in (
        "method not allowed",
        "method_not_allowed",
    ):
        message = "method not allowed"
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": message},
        headers=exc.headers,
    )


@app.exception_handler(RequestValidationError)
def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    errors = exc.errors()
    if errors:
        first = errors[0]
        field = ".".join(str(loc) for loc in first.get("loc", []) if loc != "body")
        msg = first.get("msg", "validation error")
        message = f"invalid {field}: {msg}" if field else msg
    else:
        message = "invalid request"
    return JSONResponse(status_code=400, content={"error": message})


@app.exception_handler(Exception)
def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=500, content={"error": "internal error"})


def verify_api_key(request: Request) -> None:
    expected_key = os.environ.get("API_KEY", "")
    provided_key = request.headers.get("X-API-Key", "")
    if not expected_key or not secrets.compare_digest(provided_key, expected_key):
        raise HTTPException(status_code=401, detail="unauthorized")


@app.post("/reset")
def reset_database(request: Request) -> dict:
    verify_api_key(request)
    raw_bytes = anyio.from_thread.run(request.body)
    try:
        body = json.loads(raw_bytes.decode("utf-8")) if raw_bytes else None
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail="malformed json")

    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="body must be an object")

    if "slots" not in body or not isinstance(body["slots"], list):
        raise HTTPException(status_code=400, detail="slots must be a list")

    seen_ids = set()
    parsed_slots = []
    for item in body["slots"]:
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail="slot must be an object")
        for field in ("id", "provider", "start", "end"):
            if field not in item:
                raise HTTPException(
                    status_code=400, detail=f"missing slot field: {field}"
                )
        slot_id = item["id"]
        provider = item["provider"]
        start_raw = item["start"]
        end_raw = item["end"]

        if not isinstance(slot_id, str) or not slot_id:
            raise HTTPException(
                status_code=400, detail="slot id must be a non-empty string"
            )
        if not isinstance(provider, str) or not provider:
            raise HTTPException(
                status_code=400, detail="slot provider must be a non-empty string"
            )
        if slot_id in seen_ids:
            raise HTTPException(status_code=400, detail=f"duplicate slot id: {slot_id}")
        seen_ids.add(slot_id)

        if not isinstance(start_raw, str) or not isinstance(end_raw, str):
            raise HTTPException(
                status_code=400, detail="slot start and end must be strings"
            )

        try:
            start_dt = parse_iso(start_raw)
            end_dt = parse_iso(end_raw)
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="invalid timestamp format")

        parsed_slots.append((slot_id, provider, start_dt, end_dt))

    with get_connection() as conn, conn.transaction():
        conn.execute("DELETE FROM bookings;")
        conn.execute("DELETE FROM slots;")
        conn.execute(
            """
            DO $$ BEGIN
            IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'idempotency_keys') THEN
                DELETE FROM idempotency_keys;
            END IF;
            IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'booking_attempts') THEN
                DELETE FROM booking_attempts;
            END IF;
            END $$;
            """
        )
        if parsed_slots:
            with conn.cursor() as cur:
                cur.executemany(
                    "INSERT INTO slots (id, provider, starts_at, ends_at) VALUES (%s, %s, %s, %s)",
                    parsed_slots,
                )

    return {"ok": True}


@app.get("/slots")
def list_slots(request: Request, provider: str | None = None) -> dict[str, list[dict]]:
    verify_api_key(request)
    with get_connection() as conn:
        if provider is not None:
            rows = conn.execute(
                """
                SELECT
                    s.id,
                    s.provider,
                    s.starts_at,
                    s.ends_at,
                    NOT EXISTS (
                        SELECT 1 FROM bookings b
                        WHERE b.slot_id = s.id AND b.status = 'confirmed'
                    ) AS available
                FROM slots s
                WHERE s.provider = %s
                ORDER BY s.starts_at ASC, s.id ASC;
                """,
                (provider,),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT
                    s.id,
                    s.provider,
                    s.starts_at,
                    s.ends_at,
                    NOT EXISTS (
                        SELECT 1 FROM bookings b
                        WHERE b.slot_id = s.id AND b.status = 'confirmed'
                    ) AS available
                FROM slots s
                ORDER BY s.starts_at ASC, s.id ASC;
                """
            ).fetchall()

    slots = [
        SlotWithAvailability(
            id=row[0],
            provider=row[1],
            start=format_utc(row[2]),
            end=format_utc(row[3]),
            available=bool(row[4]),
        ).model_dump()
        for row in rows
    ]
    return {"slots": slots}


@app.post("/bookings", status_code=201)
def create_booking(request: Request) -> JSONResponse:
    verify_api_key(request)
    raw_bytes = anyio.from_thread.run(request.body)
    try:
        body = json.loads(raw_bytes.decode("utf-8")) if raw_bytes else None
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail="malformed json")

    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="body must be an object")

    for field in ("slot_id", "name", "email"):
        if field not in body:
            raise HTTPException(status_code=400, detail=f"missing field: {field}")
        if not isinstance(body[field], str):
            raise HTTPException(status_code=400, detail=f"{field} must be a string")

    slot_id = body["slot_id"].strip()
    name = body["name"].strip()
    email = body["email"].strip().lower()

    if not slot_id or not name or not email:
        raise HTTPException(status_code=400, detail="fields cannot be empty")

    with get_connection() as conn, conn.transaction():
        slot = conn.execute("SELECT id FROM slots WHERE id = %s", (slot_id,)).fetchone()
        if not slot:
            raise HTTPException(status_code=404, detail="slot not found")

        booking_id = "bk_" + uuid.uuid4().hex[:12]
        now_utc = datetime.now(UTC)
        created_at_str = format_iso_ms(now_utc)
        conn.execute(
            """
                INSERT INTO bookings (id, slot_id, name, email, status, created_at)
                VALUES (%s, %s, %s, %s, 'confirmed', %s)
                """,
            (booking_id, slot_id, name, email, now_utc),
        )

    booking = Booking(
        id=booking_id,
        slot_id=slot_id,
        name=name,
        email=email,
        status="confirmed",
        created_at=created_at_str,
    )
    return JSONResponse(status_code=201, content=booking.model_dump())


@app.get("/bookings/{id}")
def get_booking(id: str, request: Request) -> dict:
    verify_api_key(request)
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT id, slot_id, name, email, status, created_at
            FROM bookings
            WHERE id = %s
            """,
            (id,),
        ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="booking not found")

    booking = Booking(
        id=row[0],
        slot_id=row[1],
        name=row[2],
        email=row[3],
        status=row[4],
        created_at=format_iso_ms(row[5]),
    )
    return booking.model_dump()
