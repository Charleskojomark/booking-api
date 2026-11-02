import math

from fastapi import HTTPException

from db import get_connection

# Limit booking attempts to 5 per sliding 60-second window per email to prevent spam.
RATE_LIMIT_MAX_ATTEMPTS = 5
RATE_LIMIT_WINDOW_SECONDS = 60


def check_and_record_rate_limit(email: str) -> None:
    with get_connection() as conn, conn.transaction():
        # Transaction-level advisory lock on email hash so concurrent attempts for the same email serialize
        conn.execute(
            "SELECT pg_advisory_xact_lock(hashtext(%s))", (f"ratelimit:{email}",)
        )

        # Delete attempts older than 60 seconds using database clock
        conn.execute(
            """
            DELETE FROM booking_attempts
            WHERE email = %s
              AND attempted_at < NOW() - INTERVAL '60 seconds'
            """,
            (email,),
        )

        # Query remaining attempts and calculate remaining time until the oldest leaves the 60-second window
        rows = conn.execute(
            """
            SELECT attempted_at,
                   EXTRACT(EPOCH FROM (attempted_at + INTERVAL '60 seconds' - NOW())) AS remaining_seconds
            FROM booking_attempts
            WHERE email = %s
            ORDER BY attempted_at ASC
            """,
            (email,),
        ).fetchall()

        if len(rows) >= RATE_LIMIT_MAX_ATTEMPTS:
            oldest_remaining = rows[0][1]
            retry_after = max(1, math.ceil(float(oldest_remaining)))
            # Attempts that end in 429 are not recorded
            raise HTTPException(
                status_code=429,
                detail="too many requests",
                headers={"Retry-After": str(retry_after)},
            )

        # Record the new attempt using database clock
        conn.execute(
            """
            INSERT INTO booking_attempts (email, attempted_at)
            VALUES (%s, NOW())
            """,
            (email,),
        )

