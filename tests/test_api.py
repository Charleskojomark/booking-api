import httpx

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
