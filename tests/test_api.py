import concurrent.futures
import uuid

import httpx

from tests.conftest import API_KEY

SAMPLE_SLOTS = [
    {
        "id": "s1",
        "provider": "Dr Ade",
        "start": "2026-12-10T09:00:00Z",
        "end": "2026-12-10T09:30:00Z",
    },
    {
        "id": "s2",
        "provider": "Dr Ade",
        "start": "2026-12-10T09:30:00Z",
        "end": "2026-12-10T10:00:00Z",
    },
    {
        "id": "s3",
        "provider": "Dr Bello",
        "start": "2026-12-10T09:00:00Z",
        "end": "2026-12-10T09:30:00Z",
    },
]


def reset(client: httpx.Client, slots: list[dict] | None = None) -> httpx.Response:
    payload = {"slots": SAMPLE_SLOTS if slots is None else slots}
    return client.post("/reset", json=payload)


def test_reset_with_valid_slots_returns_200(client: httpx.Client) -> None:
    res = reset(client)
    assert res.status_code == 200
    assert res.json() == {"ok": True}


def test_reset_with_malformed_body_returns_400(client: httpx.Client) -> None:
    # Not an object
    res = client.post("/reset", json=[])
    assert res.status_code == 400
    assert "error" in res.json()

    # Missing slots field
    res = client.post("/reset", json={})
    assert res.status_code == 400
    assert "error" in res.json()

    # Slot missing end
    res = client.post(
        "/reset",
        json={
            "slots": [
                {"id": "s1", "provider": "Dr Ade", "start": "2026-12-10T09:00:00Z"}
            ]
        },
    )
    assert res.status_code == 400
    assert "error" in res.json()

    # Duplicate slot ids
    res = client.post(
        "/reset",
        json={
            "slots": [
                {
                    "id": "s1",
                    "provider": "Dr Ade",
                    "start": "2026-12-10T09:00:00Z",
                    "end": "2026-12-10T09:30:00Z",
                },
                {
                    "id": "s1",
                    "provider": "Dr Bello",
                    "start": "2026-12-10T10:00:00Z",
                    "end": "2026-12-10T10:30:00Z",
                },
            ]
        },
    )
    assert res.status_code == 400
    assert "error" in res.json()


def test_list_slots_ordered_by_start_then_id(client: httpx.Client) -> None:
    reset(client)
    res = client.get("/slots")
    assert res.status_code == 200
    body = res.json()
    assert "slots" in body
    slots = body["slots"]
    assert len(slots) == 3

    # Both s1 and s3 start at 09:00:00Z, so order by start then id -> s1, s3, s2
    assert [s["id"] for s in slots] == ["s1", "s3", "s2"]
    for s in slots:
        assert s["available"] is True


def test_list_slots_filter_by_provider(client: httpx.Client) -> None:
    reset(client)
    res = client.get("/slots?provider=Dr%20Bello")
    assert res.status_code == 200
    slots = res.json()["slots"]
    assert len(slots) == 1
    assert slots[0]["id"] == "s3"
    assert slots[0]["provider"] == "Dr Bello"


def test_create_booking_returns_201_confirmed_and_marks_slot_unavailable(
    client: httpx.Client,
) -> None:
    reset(client)
    res = client.post(
        "/bookings",
        json={"slot_id": "s1", "name": "Ada Obi", "email": "ada@example.com"},
    )
    assert res.status_code == 201
    booking = res.json()
    assert booking["id"].startswith("bk_")
    assert booking["slot_id"] == "s1"
    assert booking["name"] == "Ada Obi"
    assert booking["email"] == "ada@example.com"
    assert booking["status"] == "confirmed"
    assert "T" in booking["created_at"]

    # Slot s1 should now have available = False
    slots_res = client.get("/slots")
    slots = {s["id"]: s for s in slots_res.json()["slots"]}
    assert slots["s1"]["available"] is False
    assert slots["s2"]["available"] is True


def test_create_booking_unknown_slot_returns_404(client: httpx.Client) -> None:
    reset(client)
    res = client.post(
        "/bookings",
        json={"slot_id": "nonexistent", "name": "Ada Obi", "email": "ada@example.com"},
    )
    assert res.status_code == 404
    assert res.json() == {"error": "slot not found"}


def test_create_booking_missing_or_empty_fields_returns_400(
    client: httpx.Client,
) -> None:
    reset(client)
    res = client.post(
        "/bookings",
        json={"slot_id": "s1", "name": ""},
    )
    assert res.status_code == 400
    assert "error" in res.json()


def test_get_booking_by_id_returns_200(client: httpx.Client) -> None:
    reset(client)
    create_res = client.post(
        "/bookings",
        json={"slot_id": "s1", "name": "Ada Obi", "email": "ada@example.com"},
    )
    booking_id = create_res.json()["id"]

    res = client.get(f"/bookings/{booking_id}")
    assert res.status_code == 200
    assert res.json() == create_res.json()


def test_get_booking_unknown_id_returns_404(client: httpx.Client) -> None:
    reset(client)
    res = client.get("/bookings/bk_unknown_id")
    assert res.status_code == 404
    assert res.json() == {"error": "booking not found"}


def test_unknown_route_returns_404_error_schema(client: httpx.Client) -> None:
    res = client.get("/nonexistent_endpoint")
    assert res.status_code == 404
    assert res.json() == {"error": "not found"}


def test_wrong_method_returns_405_error_schema(client: httpx.Client) -> None:
    res = client.put("/slots")
    assert res.status_code == 405
    assert res.json() == {"error": "method not allowed"}


def test_endpoints_without_api_key_return_401(
    unauthed_client: httpx.Client,
) -> None:
    endpoints = [
        ("POST", "/reset", {"slots": []}),
        ("GET", "/slots", None),
        ("POST", "/bookings", {"slot_id": "s1", "name": "Ada", "email": "a@b.com"}),
        ("GET", "/bookings", None),
        ("GET", "/bookings/bk_test", None),
        ("DELETE", "/bookings/bk_test", None),
    ]
    for method, path, payload in endpoints:
        # Missing key
        if method == "POST":
            res = unauthed_client.post(path, json=payload)
        elif method == "DELETE":
            res = unauthed_client.delete(path)
        else:
            res = unauthed_client.get(path)
        assert res.status_code == 401
        assert res.json() == {"error": "unauthorized"}

        # Wrong key
        headers = {"X-API-Key": "wrong_key"}
        if method == "POST":
            res = unauthed_client.post(path, json=payload, headers=headers)
        elif method == "DELETE":
            res = unauthed_client.delete(path, headers=headers)
        else:
            res = unauthed_client.get(path, headers=headers)
        assert res.status_code == 401
        assert res.json() == {"error": "unauthorized"}


def test_booking_with_invalid_email_format_returns_400(client: httpx.Client) -> None:
    reset(client)
    invalid_emails = [
        "notanemail",
        "missingatsign.com",
        "two@@signs.com",
        "@nodomain.com",
        "missingdomain@.com",
        "spaces in@domain.com",
        "domain@no dot",
    ]
    for bad_email in invalid_emails:
        res = client.post(
            "/bookings",
            json={"slot_id": "s1", "name": "Ada Obi", "email": bad_email},
        )
        assert res.status_code == 400
        assert "error" in res.json()


def test_booking_slot_already_started_returns_400(client: httpx.Client) -> None:
    # Load a slot in the past
    past_slots = [
        {
            "id": "past_1",
            "provider": "Dr Ade",
            "start": "2020-01-01T09:00:00Z",
            "end": "2020-01-01T09:30:00Z",
        }
    ]
    reset(client, slots=past_slots)
    res = client.post(
        "/bookings",
        json={"slot_id": "past_1", "name": "Ada Obi", "email": "ada@example.com"},
    )
    assert res.status_code == 400
    assert res.json() == {"error": "slot has already started"}


def test_booking_trims_name_and_stores_email_lowercase(client: httpx.Client) -> None:
    reset(client)
    res = client.post(
        "/bookings",
        json={
            "slot_id": "s1",
            "name": "   Ada Obi   ",
            "email": "   ADA@EXAMPLE.COM   ",
        },
    )
    assert res.status_code == 201
    booking = res.json()
    assert booking["name"] == "Ada Obi"
    assert booking["email"] == "ada@example.com"

    # Verify retrieved booking also has trimmed name and lowercased email
    get_res = client.get(f"/bookings/{booking['id']}")
    assert get_res.status_code == 200
    assert get_res.json()["name"] == "Ada Obi"
    assert get_res.json()["email"] == "ada@example.com"


def test_response_schemas_strict_fields_and_types(client: httpx.Client) -> None:
    reset_res = reset(client)
    assert set(reset_res.json().keys()) == {"ok"}
    assert reset_res.json()["ok"] is True

    slots_res = client.get("/slots")
    assert set(slots_res.json().keys()) == {"slots"}
    for slot in slots_res.json()["slots"]:
        assert set(slot.keys()) == {"id", "provider", "start", "end", "available"}
        assert isinstance(slot["id"], str)
        assert isinstance(slot["provider"], str)
        assert isinstance(slot["start"], str)
        assert isinstance(slot["end"], str)
        assert isinstance(slot["available"], bool)
        assert all(val is not None for val in slot.values())

    book_res = client.post(
        "/bookings",
        json={"slot_id": "s1", "name": "Ada Obi", "email": "ada@example.com"},
    )
    booking = book_res.json()
    assert set(booking.keys()) == {
        "id",
        "slot_id",
        "name",
        "email",
        "status",
        "created_at",
    }
    assert isinstance(booking["id"], str)
    assert isinstance(booking["slot_id"], str)
    assert isinstance(booking["name"], str)
    assert isinstance(booking["email"], str)
    assert booking["status"] in ("confirmed", "cancelled")
    assert isinstance(booking["created_at"], str)
    assert all(val is not None for val in booking.values())

    err_res = client.get("/bookings/nonexistent")
    assert set(err_res.json().keys()) == {"error"}
    assert isinstance(err_res.json()["error"], str)


def test_second_booking_for_same_slot_returns_409(client: httpx.Client) -> None:
    reset(client)
    res1 = client.post(
        "/bookings",
        json={"slot_id": "s1", "name": "Ada Obi", "email": "ada@example.com"},
    )
    assert res1.status_code == 201

    res2 = client.post(
        "/bookings",
        json={"slot_id": "s1", "name": "Bola Ahmed", "email": "bola@example.com"},
    )
    assert res2.status_code == 409
    assert res2.json() == {"error": "slot already booked"}


def test_concurrent_bookings_for_same_slot_gives_one_201_and_rest_409(
    base_url: str,
) -> None:
    with httpx.Client(
        base_url=base_url, timeout=30.0, headers={"X-API-Key": API_KEY}
    ) as client:
        reset(client)

    def attempt_booking(idx: int) -> int:
        with httpx.Client(
            base_url=base_url, timeout=30.0, headers={"X-API-Key": API_KEY}
        ) as c:
            res = c.post(
                "/bookings",
                json={
                    "slot_id": "s1",
                    "name": f"User {idx}",
                    "email": f"user_{idx}_{uuid.uuid4().hex[:6]}@example.com",
                },
            )
            return res.status_code

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(attempt_booking, i) for i in range(8)]
        status_codes = [f.result() for f in futures]

    assert status_codes.count(201) == 1
    assert status_codes.count(409) == 7


def test_cancel_booking_frees_slot_and_returns_cancelled_booking(
    client: httpx.Client,
) -> None:
    reset(client)
    book_res = client.post(
        "/bookings",
        json={"slot_id": "s1", "name": "Ada Obi", "email": "ada@example.com"},
    )
    booking_id = book_res.json()["id"]

    # Slot is now unavailable
    slots_res1 = client.get("/slots")
    slots1 = {s["id"]: s for s in slots_res1.json()["slots"]}
    assert slots1["s1"]["available"] is False

    # Cancel booking
    cancel_res = client.delete(f"/bookings/{booking_id}")
    assert cancel_res.status_code == 200
    cancelled_booking = cancel_res.json()
    assert cancelled_booking["id"] == booking_id
    assert cancelled_booking["status"] == "cancelled"
    assert cancelled_booking["slot_id"] == "s1"
    assert cancelled_booking["name"] == "Ada Obi"
    assert cancelled_booking["email"] == "ada@example.com"
    assert isinstance(cancelled_booking["created_at"], str)

    # Slot s1 is now freed and available again
    slots_res2 = client.get("/slots")
    slots2 = {s["id"]: s for s in slots_res2.json()["slots"]}
    assert slots2["s1"]["available"] is True

    # Can now be booked again
    rebook_res = client.post(
        "/bookings",
        json={"slot_id": "s1", "name": "Bola Ahmed", "email": "bola@example.com"},
    )
    assert rebook_res.status_code == 201
    assert rebook_res.json()["id"] != booking_id


def test_cancel_nonexistent_booking_returns_404(client: httpx.Client) -> None:
    reset(client)
    res = client.delete("/bookings/bk_nonexistent")
    assert res.status_code == 404
    assert res.json() == {"error": "booking not found"}


def test_cancel_already_cancelled_booking_returns_409(client: httpx.Client) -> None:
    reset(client)
    book_res = client.post(
        "/bookings",
        json={"slot_id": "s1", "name": "Ada Obi", "email": "ada@example.com"},
    )
    booking_id = book_res.json()["id"]

    # First cancel -> 200
    res1 = client.delete(f"/bookings/{booking_id}")
    assert res1.status_code == 200

    # Second cancel -> 409
    res2 = client.delete(f"/bookings/{booking_id}")
    assert res2.status_code == 409
    assert res2.json() == {"error": "booking already cancelled"}


def test_concurrent_cancels_gives_one_200_and_rest_409(base_url: str) -> None:
    with httpx.Client(
        base_url=base_url, timeout=30.0, headers={"X-API-Key": API_KEY}
    ) as client:
        reset(client)
        book_res = client.post(
            "/bookings",
            json={"slot_id": "s1", "name": "Ada Obi", "email": "ada@example.com"},
        )
        booking_id = book_res.json()["id"]

    def attempt_cancel() -> int:
        with httpx.Client(
            base_url=base_url, timeout=30.0, headers={"X-API-Key": API_KEY}
        ) as c:
            res = c.delete(f"/bookings/{booking_id}")
            return res.status_code

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(attempt_cancel) for _ in range(8)]
        status_codes = [f.result() for f in futures]

    assert status_codes.count(200) == 1
    assert status_codes.count(409) == 7


def test_idempotent_booking_replay_returns_same_response(client: httpx.Client) -> None:
    reset(client)
    idem_key = "idem_" + uuid.uuid4().hex
    payload = {"slot_id": "s1", "name": "Ada Obi", "email": "ada@example.com"}

    # First request -> 201
    res1 = client.post("/bookings", json=payload, headers={"Idempotency-Key": idem_key})
    assert res1.status_code == 201
    booking1 = res1.json()

    # Replay request with same key and body -> 201 with identical content
    res2 = client.post("/bookings", json=payload, headers={"Idempotency-Key": idem_key})
    assert res2.status_code == 201
    booking2 = res2.json()

    assert booking1 == booking2
    assert booking1["id"] == booking2["id"]

    # Verify only 1 booking was created
    slots_res = client.get("/slots")
    slots = {s["id"]: s for s in slots_res.json()["slots"]}
    assert slots["s1"]["available"] is False


def test_idempotent_booking_different_body_returns_422(client: httpx.Client) -> None:
    reset(client)
    idem_key = "idem_" + uuid.uuid4().hex

    res1 = client.post(
        "/bookings",
        json={"slot_id": "s1", "name": "Ada Obi", "email": "ada@example.com"},
        headers={"Idempotency-Key": idem_key},
    )
    assert res1.status_code == 201

    # Same key with different body -> 422
    res2 = client.post(
        "/bookings",
        json={"slot_id": "s2", "name": "Ada Obi", "email": "ada@example.com"},
        headers={"Idempotency-Key": idem_key},
    )
    assert res2.status_code == 422
    assert res2.json() == {"error": "idempotency key mismatch"}


def test_idempotent_booking_retry_after_failure_succeeds(client: httpx.Client) -> None:
    reset(client)
    idem_key = "idem_" + uuid.uuid4().hex

    # Attempt booking nonexistent slot -> 404 (failed, so not stored)
    res1 = client.post(
        "/bookings",
        json={"slot_id": "nonexistent", "name": "Ada Obi", "email": "ada@example.com"},
        headers={"Idempotency-Key": idem_key},
    )
    assert res1.status_code == 404

    # Retry with same key for valid slot -> succeeds with 201
    res2 = client.post(
        "/bookings",
        json={"slot_id": "s1", "name": "Ada Obi", "email": "ada@example.com"},
        headers={"Idempotency-Key": idem_key},
    )
    assert res2.status_code == 201
    assert res2.json()["slot_id"] == "s1"


def test_concurrent_idempotent_requests_produce_one_booking_and_identical_responses(
    base_url: str,
) -> None:
    with httpx.Client(
        base_url=base_url, timeout=30.0, headers={"X-API-Key": API_KEY}
    ) as client:
        reset(client)

    idem_key = "idem_concurrent_" + uuid.uuid4().hex
    payload = {"slot_id": "s1", "name": "Ada Obi", "email": "ada@example.com"}

    def attempt_idempotent_booking() -> tuple[int, dict]:
        with httpx.Client(
            base_url=base_url, timeout=30.0, headers={"X-API-Key": API_KEY}
        ) as c:
            res = c.post(
                "/bookings", json=payload, headers={"Idempotency-Key": idem_key}
            )
            return res.status_code, res.json()

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(attempt_idempotent_booking) for _ in range(4)]
        results = [f.result() for f in futures]

    status_codes = [r[0] for r in results]
    response_bodies = [r[1] for r in results]

    # All 4 requests should return 201
    assert all(code == 201 for code in status_codes)
    # All 4 bodies should be identical
    first_body = response_bodies[0]
    assert all(body == first_body for body in response_bodies)


def test_get_bookings_missing_email_or_invalid_limit_returns_400(
    client: httpx.Client,
) -> None:
    reset(client)

    # Missing email
    res1 = client.get("/bookings")
    assert res1.status_code == 400
    assert "error" in res1.json()

    # Empty email
    res2 = client.get("/bookings?email=")
    assert res2.status_code == 400
    assert "error" in res2.json()

    # Limit < 1
    res3 = client.get("/bookings?email=ada@example.com&limit=0")
    assert res3.status_code == 400
    assert "error" in res3.json()

    # Limit > 50
    res4 = client.get("/bookings?email=ada@example.com&limit=51")
    assert res4.status_code == 400
    assert "error" in res4.json()

    # Non-integer limit
    res5 = client.get("/bookings?email=ada@example.com&limit=abc")
    assert res5.status_code == 400
    assert "error" in res5.json()

    # Malformed cursor
    res6 = client.get("/bookings?email=ada@example.com&cursor=invalid_base64_!!")
    assert res6.status_code == 400
    assert "error" in res6.json()


def test_get_bookings_cursor_pagination_oldest_first_and_includes_cancelled(
    client: httpx.Client,
) -> None:
    four_slots = [
        {
            "id": "s1",
            "provider": "Dr Ade",
            "start": "2026-12-10T09:00:00Z",
            "end": "2026-12-10T09:30:00Z",
        },
        {
            "id": "s2",
            "provider": "Dr Ade",
            "start": "2026-12-10T09:30:00Z",
            "end": "2026-12-10T10:00:00Z",
        },
        {
            "id": "s3",
            "provider": "Dr Bello",
            "start": "2026-12-10T10:00:00Z",
            "end": "2026-12-10T10:30:00Z",
        },
        {
            "id": "s4",
            "provider": "Dr Bello",
            "start": "2026-12-10T11:00:00Z",
            "end": "2026-12-10T11:30:00Z",
        },
    ]
    reset(client, slots=four_slots)
    email = "ada@example.com"

    # Create 4 bookings for Ada (staying within 5 per email for Level 5 rate limit compatibility)
    b1 = client.post(
        "/bookings", json={"slot_id": "s1", "name": "Ada Obi", "email": email}
    ).json()
    b2 = client.post(
        "/bookings", json={"slot_id": "s2", "name": "Ada Obi", "email": email}
    ).json()
    b3 = client.post(
        "/bookings", json={"slot_id": "s3", "name": "Ada Obi", "email": email}
    ).json()
    b4 = client.post(
        "/bookings", json={"slot_id": "s4", "name": "Ada Obi", "email": email}
    ).json()

    # Cancel b2
    cancel_res = client.delete(f"/bookings/{b2['id']}")
    assert cancel_res.status_code == 200

    # Page 1: limit 2, email case-insensitive match
    p1_res = client.get("/bookings?email=ADA@EXAMPLE.COM&limit=2")
    assert p1_res.status_code == 200
    p1 = p1_res.json()
    assert len(p1["bookings"]) == 2
    assert p1["bookings"][0]["id"] == b1["id"]
    assert p1["bookings"][0]["status"] == "confirmed"
    assert p1["bookings"][1]["id"] == b2["id"]
    assert p1["bookings"][1]["status"] == "cancelled"
    cursor = p1["next_cursor"]
    assert cursor is not None
    assert isinstance(cursor, str)

    # Page 2: fetch next page with cursor
    p2_res = client.get(f"/bookings?email={email}&limit=2&cursor={cursor}")
    assert p2_res.status_code == 200
    p2 = p2_res.json()
    assert len(p2["bookings"]) == 2
    assert p2["bookings"][0]["id"] == b3["id"]
    assert p2["bookings"][1]["id"] == b4["id"]
    # The last page has exactly 2 items, matching the limit, and must return next_cursor: null
    assert p2["next_cursor"] is None
