import os
import socket
import sys
import threading
import time
from collections.abc import Generator
from pathlib import Path

import httpx
import pytest
import uvicorn

root_dir = str(Path(__file__).resolve().parent.parent)
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

from main import app


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


from dotenv import load_dotenv

load_dotenv()

API_KEY = os.environ.get("API_KEY", "")


@pytest.fixture(scope="session")
def base_url() -> Generator[str, None, None]:
    url = os.environ.get("BASE_URL")
    if url:
        yield url.rstrip("/")
        return

    port = find_free_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    server_url = f"http://127.0.0.1:{port}"
    for _ in range(50):
        try:
            with httpx.Client(timeout=3.0) as probe_client:
                res = probe_client.get(
                    f"{server_url}/slots", headers={"X-API-Key": API_KEY}
                )
                if res.status_code == 200:
                    break
        except (httpx.TransportError, httpx.HTTPError):
            time.sleep(0.2)

    yield server_url
    server.should_exit = True
    thread.join(timeout=2.0)


@pytest.fixture
def client(base_url: str) -> Generator[httpx.Client, None, None]:
    with httpx.Client(
        base_url=base_url, timeout=30.0, headers={"X-API-Key": API_KEY}
    ) as http_client:
        yield http_client


@pytest.fixture
def unauthed_client(base_url: str) -> Generator[httpx.Client, None, None]:
    with httpx.Client(base_url=base_url, timeout=30.0) as http_client:
        yield http_client


@pytest.fixture(scope="session", autouse=True)
def restore_database_after_tests() -> Generator[None, None, None]:
    yield
    # Automatically restore full 4-provider schedule after test suite finishes
    sample_file = Path(root_dir) / "sample_slots.json"
    if sample_file.exists():
        import json
        with open(sample_file, "r") as f:
            data = json.load(f)
        from db import get_connection
        with get_connection() as conn, conn.transaction():
            conn.execute("DELETE FROM bookings")
            conn.execute("DELETE FROM idempotency_keys")
            conn.execute("DELETE FROM booking_attempts")
            conn.execute("DELETE FROM slots")
            for slot in data["slots"]:
                conn.execute(
                    "INSERT INTO slots (id, provider, starts_at, ends_at) VALUES (%s, %s, %s, %s)",
                    (slot["id"], slot["provider"], slot["start"], slot["end"]),
                )

