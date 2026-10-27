"""SQLite access layer.

Deliberately thin: hand-written, parameterised SQL against well-indexed tables gives
predictable sub-millisecond queries. Each request receives its own connection
(SQLite connections are cheap) tuned via PRAGMAs for a read-heavy workload.
"""
from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator, Iterable, Sequence
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..config import settings

SCHEMA_PATH = Path(__file__).with_name("schema.sql")

PRAGMAS = (
    "PRAGMA journal_mode = WAL",        # concurrent readers while writing
    "PRAGMA synchronous = NORMAL",      # safe with WAL, much faster than FULL
    "PRAGMA foreign_keys = ON",
    "PRAGMA temp_store = MEMORY",
    "PRAGMA cache_size = -32000",       # ~32MB page cache
    "PRAGMA mmap_size = 268435456",     # 256MB memory-mapped I/O
    "PRAGMA busy_timeout = 5000",
)


def _dict_factory(cursor: sqlite3.Cursor, row: tuple) -> dict[str, Any]:
    return {col[0]: row[idx] for idx, col in enumerate(cursor.description)}


def connect() -> sqlite3.Connection:
    settings.database_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(settings.database_path, check_same_thread=False, isolation_level=None)
    conn.row_factory = _dict_factory
    for p in PRAGMAS:
        conn.execute(p)
    return conn


def init_db() -> None:
    with closing_conn() as conn:
        conn.executescript(SCHEMA_PATH.read_text())
        conn.execute("PRAGMA optimize")


@contextmanager
def closing_conn() -> Iterator[sqlite3.Connection]:
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


def get_db() -> Iterator[sqlite3.Connection]:
    """FastAPI dependency."""
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise


# ---------------------------------------------------------------------------
# Small query helpers
# ---------------------------------------------------------------------------
def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch_one(conn: sqlite3.Connection, sql: str, params: Sequence | dict = ()) -> dict | None:
    return conn.execute(sql, params).fetchone()


def fetch_all(conn: sqlite3.Connection, sql: str, params: Sequence | dict = ()) -> list[dict]:
    return conn.execute(sql, params).fetchall()


def insert(conn: sqlite3.Connection, table: str, data: dict[str, Any]) -> int:
    cols = ", ".join(data)
    marks = ", ".join(f":{k}" for k in data)
    cur = conn.execute(f"INSERT INTO {table} ({cols}) VALUES ({marks})", _encode(data))
    return int(cur.lastrowid)


def update(conn: sqlite3.Connection, table: str, row_id: int, data: dict[str, Any], touch: bool = True) -> None:
    if not data:
        return
    if touch:
        data = {**data, "updated_at": now_iso()}
    sets = ", ".join(f"{k} = :{k}" for k in data)
    conn.execute(f"UPDATE {table} SET {sets} WHERE id = :__id", {**_encode(data), "__id": row_id})


def _encode(data: dict[str, Any]) -> dict[str, Any]:
    out = {}
    for k, v in data.items():
        if isinstance(v, (list, dict)):
            v = json.dumps(v)
        elif isinstance(v, bool):
            v = int(v)
        out[k] = v
    return out


def decode_json(row: dict | None, *fields: str) -> dict | None:
    if row is None:
        return None
    for f in fields:
        if f in row and isinstance(row[f], str):
            try:
                row[f] = json.loads(row[f])
            except json.JSONDecodeError:
                pass
    return row


def decode_rows(rows: Iterable[dict], *fields: str) -> list[dict]:
    return [decode_json(r, *fields) for r in rows]  # type: ignore[misc]
