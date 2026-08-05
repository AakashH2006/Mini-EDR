"""
GET /stats — powers the five dashboard status cards.

None of these are stored as live state — they're derived from the
events table on each request, since we deliberately keep no in-memory
cache (per the "no large memory cache" agent constraint, and it'd be
redundant with SQLite as the source of truth anyway). At this data
volume the queries below are cheap and index-backed.

Derivation notes:
- running_processes: pids with a process_creation but no later
  process_termination. Uses EXCEPT so it's a single pass, no join.
  Known limitation: OS pid reuse over long uptimes could rarely
  under/over-count — acceptable for Phase 1 telemetry, not a security
  control.
- usb_devices: same EXCEPT pattern, but the drive letter lives inside
  the JSON `details` blob (not a dedicated column, since it only
  applies to two event types), pulled with json_extract.
- active_connections: connections seen within ACTIVE_CONN_WINDOW —
  we don't log a "connection closed" event (network collector only
  detects new connections), so "active" is a recency heuristic, not a
  live socket check.
- agent_status: online if the most recent event of any kind is within
  AGENT_OFFLINE_THRESHOLD; this is a proxy for "is a collector still
  writing," not a heartbeat protocol.
"""

from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

from app.db.database import connection

router = APIRouter()

AGENT_OFFLINE_THRESHOLD_SECONDS = 30
ACTIVE_CONN_WINDOW_MINUTES = 15


class Stats(BaseModel):
    agent_status: str  # "online" | "offline"
    last_event_at: Optional[str]
    events_today: int
    running_processes: int
    active_connections: int
    usb_devices: int


@router.get("/stats", response_model=Stats)
def get_stats():
    with connection() as conn:
        last_event_at = conn.execute(
            "SELECT timestamp FROM events ORDER BY id DESC LIMIT 1"
        ).fetchone()
        last_event_at = last_event_at[0] if last_event_at else None

        agent_status = "offline"
        if last_event_at:
            row = conn.execute(
                """SELECT (strftime('%s','now') - strftime('%s', ?)) <= ?""",
                (last_event_at, AGENT_OFFLINE_THRESHOLD_SECONDS),
            ).fetchone()
            agent_status = "online" if row[0] else "offline"

        events_today = conn.execute(
            "SELECT COUNT(*) FROM events WHERE date(timestamp) = date('now')"
        ).fetchone()[0]

        running_processes = conn.execute(
            """SELECT COUNT(*) FROM (
                 SELECT pid FROM events WHERE event_type='process_creation' AND pid IS NOT NULL
                 EXCEPT
                 SELECT pid FROM events WHERE event_type='process_termination' AND pid IS NOT NULL
               )"""
        ).fetchone()[0]

        active_connections = conn.execute(
            """SELECT COUNT(DISTINCT pid || ':' ||
                              json_extract(details,'$.remote_addr') || ':' ||
                              json_extract(details,'$.remote_port'))
               FROM events
               WHERE event_type = 'network_connection'
                 AND timestamp >= datetime('now', ?)""",
            (f"-{ACTIVE_CONN_WINDOW_MINUTES} minutes",),
        ).fetchone()[0]

        usb_devices = conn.execute(
            """SELECT COUNT(*) FROM (
                 SELECT json_extract(details,'$.drive') AS drive
                 FROM events WHERE event_type='usb_insert'
                 EXCEPT
                 SELECT json_extract(details,'$.drive')
                 FROM events WHERE event_type='usb_remove'
               )"""
        ).fetchone()[0]

    return Stats(
        agent_status=agent_status,
        last_event_at=last_event_at,
        events_today=events_today,
        running_processes=running_processes,
        active_connections=active_connections,
        usb_devices=usb_devices,
    )
