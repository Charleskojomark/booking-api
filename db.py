import os
from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path

from psycopg import Connection
from psycopg_pool import ConnectionPool


def _load_env_file() -> None:
    env_file = Path(".env")
    if env_file.is_file():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, val = line.split("=", 1)
                os.environ.setdefault(key.strip(), val.strip())


_load_env_file()

database_url = os.environ.get("DATABASE_URL", "")

# Neon pooler runs in transaction mode; server-side prepared statements must be disabled.
pool = ConnectionPool(
    conninfo=database_url,
    min_size=1,
    max_size=5,
    kwargs={"prepare_threshold": None},
    open=True,
)


@contextmanager
def get_connection() -> Generator[Connection, None, None]:
    with pool.connection() as connection:
        yield connection
