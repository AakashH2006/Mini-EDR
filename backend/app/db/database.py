"""
SQLite layer for Mini EDR.

Design notes:
- WAL mode: lets agent (writer) and API (reader) hit the DB concurrently
  without locking each other out. Critical since agent writes are frequent
  and API needs to serve reads + WS polling at the same time.
- Indices on timestamp, process_name, event_type: these are the three
  columns every dashboard query filters/sorts on (event table, search,
  timeline). Without them, /events with filters would full-scan.
- 30-day retention: enforced by a DELETE on startup + a periodic cleanup
  call, not a background thread. Keeps agent lightweight (no scheduler
  running inside the collector process).
"""

import sqlite3
from pathlib import Path
from contextlib import contextmanager

DB_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "edr.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

RETENTION_DAYS = 30

SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp       TEXT    NOT NULL,   -- ISO 8601 UTC
    event_type      TEXT    NOT NULL,   -- process_creation | process_termination |
                                         -- network_connection | usb_insert | usb_remove |
                                         -- logon | logoff
    process_name    TEXT,
    parent_process  TEXT,
    pid             INTEGER,
    user            TEXT,
    severity        TEXT    NOT NULL DEFAULT 'Information',
    details         TEXT                -- JSON blob, event-type-specific fields
);

CREATE INDEX IF NOT EXISTS idx_events_timestamp    ON events (timestamp);
CREATE INDEX IF NOT EXISTS idx_events_process_name ON events (process_name);
CREATE INDEX IF NOT EXISTS idx_events_event_type   ON events (event_type);
"""


def get_connection() -> sqlite3.Connection:
    """New connection per call — sqlite3 connections aren't thread-safe
    to share, and both agent (separate process) and API (async handlers)
    need their own."""
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    conn.row_factory = sqlite3.Row
    return conn


@contextmanager
def connection():
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with connection() as conn:
        conn.executescript(SCHEMA)


def purge_old_events(days: int = RETENTION_DAYS) -> int:
    """Delete events older than `days`. Returns rows deleted.
    Call on API startup and optionally on a daily timer — cheap query,
    indexed on timestamp."""
    with connection() as conn:
        cur = conn.execute(
            "DELETE FROM events WHERE timestamp < datetime('now', ?)",
            (f"-{days} days",),
        )
        return cur.rowcount


def insert_event(
    timestamp: str,
    event_type: str,
    process_name: str | None = None,
    parent_process: str | None = None,
    pid: int | None = None,
    user: str | None = None,
    severity: str = "Information",
    details: str | None = None,
) -> int:
    """Single-row insert used by the agent. Returns new row id.
    No batching — event volume on a single endpoint is low enough
    (per your 'no large memory cache' constraint) that per-event commit
    is fine and keeps the agent simple/crash-safe (nothing buffered)."""
    with connection() as conn:
        cur = conn.execute(
            """INSERT INTO events
               (timestamp, event_type, process_name, parent_process, pid, user, severity, details)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (timestamp, event_type, process_name, parent_process, pid, user, severity, details),
        )
        return cur.lastrowid


if __name__ == "__main__":
    init_db()
    print(f"DB initialized at {DB_PATH}")
