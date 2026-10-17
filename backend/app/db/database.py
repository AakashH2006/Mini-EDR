"""
SQLite layer for Mini EDR.

Design notes:
- WAL mode: lets agent (writer) and API (reader) hit the DB concurrently
  without locking each other out. Critical since agent writes are frequent
  and API needs to serve reads + WS polling at the same time.
- Indices on timestamp, process_name, event_type: these are the three
  columns every dashboard query filters/sorts on (event table, search,
  timeline). Without them, /events with filters would full-scan.
- `parent_pid` is a real column, not just a key inside the `details`
  JSON blob: Phase 3's process-tree walk queries "all children of pid X"
  once per tree level, and json_extract can't use an index — that walk
  would full-scan the table at every level. The collector writes the
  column, and migrate() backfills it out of `details` for rows written
  before the column existed.
- 30-day retention: enforced by a DELETE on startup + a periodic cleanup
  call, not a background thread. Keeps agent lightweight (no scheduler
  running inside the collector process).

Phase 2/3 tables (alerts, incidents, case_notes, rule_state,
detection_state) live in this same database rather than a second file,
so inserting an alert and raising its triggering event's severity
happen in one transaction.
"""

import sqlite3
from datetime import datetime, timedelta, timezone
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
                                        -- logon | logoff | logon_failed | special_logon
    process_name    TEXT,
    parent_process  TEXT,
    pid             INTEGER,
    parent_pid      INTEGER,
    user            TEXT,
    severity        TEXT    NOT NULL DEFAULT 'Information',
    details         TEXT                -- JSON blob, event-type-specific fields
);

-- Phase 2: detection -------------------------------------------------

CREATE TABLE IF NOT EXISTS incidents (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at    TEXT    NOT NULL,
    first_seen    TEXT    NOT NULL,
    last_seen     TEXT    NOT NULL,
    title         TEXT    NOT NULL,
    severity      TEXT    NOT NULL,     -- max severity across member alerts
    score         INTEGER NOT NULL DEFAULT 0,
    status        TEXT    NOT NULL DEFAULT 'open',  -- open|investigating|contained|closed|false_positive
    root_pid      INTEGER,
    root_process  TEXT,
    user          TEXT,
    alert_count   INTEGER NOT NULL DEFAULT 0,
    tactics       TEXT,                 -- JSON array, ATT&CK tactics observed
    summary       TEXT
);

CREATE TABLE IF NOT EXISTS alerts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp       TEXT    NOT NULL,   -- when the triggering activity happened
    created_at      TEXT    NOT NULL,   -- when the rule fired (detection lag stays visible)
    rule_id         TEXT    NOT NULL,
    rule_name       TEXT    NOT NULL,
    severity        TEXT    NOT NULL,   -- Low | Medium | High | Critical
    score           INTEGER NOT NULL DEFAULT 0,   -- 0-100 risk score
    title           TEXT    NOT NULL,   -- one line, instance-specific
    description     TEXT,               -- what the rule means, for the analyst
    mitre_id        TEXT,               -- e.g. T1059.001
    mitre_tactic    TEXT,               -- e.g. execution
    mitre_technique TEXT,               -- e.g. PowerShell
    event_id        INTEGER,            -- primary triggering event
    process_name    TEXT,
    pid             INTEGER,
    user            TEXT,
    status          TEXT    NOT NULL DEFAULT 'new',  -- new|investigating|resolved|false_positive
    incident_id     INTEGER,
    dedup_key       TEXT    NOT NULL,   -- rule + entity; suppresses alert storms
    evidence        TEXT,               -- JSON, the fields that made it match
    FOREIGN KEY (event_id)    REFERENCES events (id)    ON DELETE SET NULL,
    FOREIGN KEY (incident_id) REFERENCES incidents (id) ON DELETE SET NULL
);

-- Supporting events beyond the primary one. Correlation rules fire on
-- a pattern, not a single line, so they cite every event that took part
-- and the drawer can show the whole burst.
CREATE TABLE IF NOT EXISTS alert_events (
    alert_id  INTEGER NOT NULL,
    event_id  INTEGER NOT NULL,
    PRIMARY KEY (alert_id, event_id),
    FOREIGN KEY (alert_id) REFERENCES alerts (id) ON DELETE CASCADE
);

-- Per-rule enable/disable, toggled from the dashboard. A rule missing
-- from this table is enabled: the rule pack in code owns which rules
-- exist, this table only records deviations from their defaults.
CREATE TABLE IF NOT EXISTS rule_state (
    rule_id    TEXT PRIMARY KEY,
    enabled    INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT
);

-- Cursor store, so detection resumes where it left off across API
-- restarts instead of re-scoring the whole events table.
CREATE TABLE IF NOT EXISTS detection_state (
    key   TEXT PRIMARY KEY,
    value TEXT
);

-- Phase 3: behavioral analysis / investigations ----------------------

-- The pids an incident has claimed. Membership is decided by process
-- lineage; re-walking every open incident's tree on each new alert
-- would be the expensive way to ask "does this belong to an existing
-- case?", so each incident's pid set is materialised here and matched
-- with one indexed lookup.
CREATE TABLE IF NOT EXISTS incident_pids (
    incident_id INTEGER NOT NULL,
    pid         INTEGER NOT NULL,
    PRIMARY KEY (incident_id, pid),
    FOREIGN KEY (incident_id) REFERENCES incidents (id) ON DELETE CASCADE
);

-- Investigation workflow: analyst notes and an audit trail of status
-- changes share one table so a case reads as a single chronology.
CREATE TABLE IF NOT EXISTS case_notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_id INTEGER NOT NULL,
    created_at  TEXT    NOT NULL,
    author      TEXT,
    kind        TEXT    NOT NULL DEFAULT 'note',  -- note | status_change | system
    body        TEXT    NOT NULL,
    FOREIGN KEY (incident_id) REFERENCES incidents (id) ON DELETE CASCADE
);
"""

# Indices are applied *after* migrate(), not as part of SCHEMA above.
# CREATE TABLE IF NOT EXISTS is a no-op on a database from an earlier
# phase, so its `events` table has no parent_pid column yet — and an
# index over a column that does not exist is an error, not a no-op.
# Creating tables, then adding missing columns, then indexing, is the
# only order that works on both a fresh database and an upgraded one.
INDICES = """
CREATE INDEX IF NOT EXISTS idx_events_timestamp    ON events (timestamp);
CREATE INDEX IF NOT EXISTS idx_events_process_name ON events (process_name);
CREATE INDEX IF NOT EXISTS idx_events_event_type   ON events (event_type);
CREATE INDEX IF NOT EXISTS idx_events_pid          ON events (pid);
CREATE INDEX IF NOT EXISTS idx_events_parent_pid   ON events (parent_pid);

CREATE INDEX IF NOT EXISTS idx_incidents_last_seen ON incidents (last_seen);
CREATE INDEX IF NOT EXISTS idx_incidents_status    ON incidents (status);

CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts (timestamp);
CREATE INDEX IF NOT EXISTS idx_alerts_severity  ON alerts (severity);
CREATE INDEX IF NOT EXISTS idx_alerts_status    ON alerts (status);
CREATE INDEX IF NOT EXISTS idx_alerts_rule      ON alerts (rule_id);
CREATE INDEX IF NOT EXISTS idx_alerts_incident  ON alerts (incident_id);
CREATE INDEX IF NOT EXISTS idx_alerts_dedup     ON alerts (dedup_key, created_at);

CREATE INDEX IF NOT EXISTS idx_incident_pids_pid ON incident_pids (pid);

CREATE INDEX IF NOT EXISTS idx_case_notes_incident ON case_notes (incident_id, created_at);
"""


def utc_now_iso() -> str:
    """The canonical timestamp format for this database.

    Every collector writes UTC with millisecond precision and a +00:00
    offset, and every comparison against the `timestamp` column relies
    on that being universal: two ISO strings only order correctly as
    text if they share a format and an offset. A local-time timestamp
    mixed in would sort as though it were UTC and land in the wrong
    window.
    """
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def iso_cutoff(days: int = 0, minutes: int = 0, seconds: int = 0) -> str:
    """A timestamp `days`/`minutes`/`seconds` in the past, in the exact
    format the collectors write.

    Use this instead of SQLite's datetime('now', '-N days') whenever
    the result is compared against the `timestamp` column. datetime()
    renders "YYYY-MM-DD HH:MM:SS" while our timestamps are ISO-8601
    with a "T" separator and an offset; compared as strings, the "T"
    (0x54) sorts above the space (0x20), so every stored timestamp
    looks later than any datetime() value from the same day. The
    comparison is then wrong by up to a day, in whichever direction
    costs you — rows kept that should have been purged, or counted
    that fell outside the window.

    Returning a bound parameter also keeps the query an index range
    scan on `timestamp`, which wrapping the column in strftime() would
    not.
    """
    moment = datetime.now(timezone.utc) - timedelta(days=days, minutes=minutes, seconds=seconds)
    return moment.isoformat(timespec="milliseconds")


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


def migrate() -> None:
    """Idempotent upgrades for databases created by an earlier phase.

    Every new table is covered by CREATE TABLE IF NOT EXISTS, so the
    only real work is the column added to the pre-existing `events`
    table — SQLite has no ADD COLUMN IF NOT EXISTS, hence the PRAGMA
    check.
    """
    with connection() as conn:
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(events)")}

        if "parent_pid" not in columns:
            conn.execute("ALTER TABLE events ADD COLUMN parent_pid INTEGER")

        # Backfill from the JSON blob for rows written before the column
        # existed. Only process_creation rows ever carried a parent_pid,
        # and only NULLs are touched, so re-running this costs nothing.
        conn.execute(
            """UPDATE events
                  SET parent_pid = json_extract(details, '$.parent_pid')
                WHERE parent_pid IS NULL
                  AND event_type = 'process_creation'
                  AND json_extract(details, '$.parent_pid') IS NOT NULL"""
        )


def init_db() -> None:
    """Tables, then column migrations, then indices — see INDICES for
    why that order is load-bearing."""
    with connection() as conn:
        conn.executescript(SCHEMA)
    migrate()
    with connection() as conn:
        conn.executescript(INDICES)


def purge_old_events(days: int = RETENTION_DAYS) -> int:
    """Delete events older than `days`. Returns rows deleted.
    Call on API startup and optionally on a daily timer — cheap query,
    indexed on timestamp."""
    with connection() as conn:
        cur = conn.execute(
            "DELETE FROM events WHERE timestamp < ?", (iso_cutoff(days=days),)
        )
        return cur.rowcount


def purge_old_detections(days: int = RETENTION_DAYS) -> dict:
    """Alerts and incidents age out on the same window as events.

    Keeping an alert after its evidence is gone would leave the details
    drawer pointing at rows that no longer exist, so the two are tied
    together. An incident goes once it holds no alerts: alerts.incident_id
    is ON DELETE SET NULL, so an incident is never left silently empty
    without this pass collecting it.
    """
    with connection() as conn:
        alerts = conn.execute(
            "DELETE FROM alerts WHERE timestamp < ?", (iso_cutoff(days=days),)
        ).rowcount
        incidents = conn.execute(
            """DELETE FROM incidents
                WHERE id NOT IN (SELECT incident_id FROM alerts WHERE incident_id IS NOT NULL)"""
        ).rowcount
        return {"alerts": alerts, "incidents": incidents}


def insert_event(
    timestamp: str,
    event_type: str,
    process_name: str | None = None,
    parent_process: str | None = None,
    pid: int | None = None,
    parent_pid: int | None = None,
    user: str | None = None,
    severity: str = "Information",
    details: str | None = None,
) -> int:
    """Single-row insert used by the agent. Returns new row id.
    No batching — event volume on a single endpoint is low enough
    (per your 'no large memory cache' constraint) that per-event commit
    is fine and keeps the agent simple/crash-safe (nothing buffered).

    Collectors still write severity='Information'. Raising it is the
    detection engine's job, so a collector never needs to know what a
    rule considers interesting.
    """
    with connection() as conn:
        cur = conn.execute(
            """INSERT INTO events
               (timestamp, event_type, process_name, parent_process, pid, parent_pid,
                user, severity, details)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (timestamp, event_type, process_name, parent_process, pid, parent_pid,
             user, severity, details),
        )
        return cur.lastrowid


def get_state(key: str, default: str | None = None) -> str | None:
    with connection() as conn:
        row = conn.execute("SELECT value FROM detection_state WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else default


def set_state(key: str, value: str) -> None:
    with connection() as conn:
        conn.execute(
            """INSERT INTO detection_state (key, value) VALUES (?, ?)
               ON CONFLICT(key) DO UPDATE SET value = excluded.value""",
            (key, value),
        )


if __name__ == "__main__":
    init_db()
    print(f"DB initialized at {DB_PATH}")
