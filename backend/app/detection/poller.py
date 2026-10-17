"""
The background loop that feeds events to the detection engine.

It is a second cursor over the same events table that ws_poller.py
reads, and the two are deliberately independent:

- The **WS poller** exists to put events on screen fast. It starts at
  the current MAX(id) so a client sees live activity, not a replay.
- The **detection poller** exists to not miss anything. It resumes from
  a cursor persisted in `detection_state`, so an API restart re-scores
  nothing already scored and skips nothing written while it was down.

A consequence worth naming: an event reaches the dashboard a moment
before its verdict does, so a row can appear as Information and then
turn red. Rather than hide that by delaying every event until it has
been scored, the engine emits an `event_update` message and the table
re-colours the row in place. Detection latency is real and an EDR
should show it rather than pretend events arrive pre-classified.

**Backfill.** On a database that has never been scored, the cursor
starts at the oldest event inside BACKFILL_DAYS rather than at zero.
Thirty days of process telemetry is a lot of rows to replay, and alerts
from three weeks ago aren't actionable — but a few days of history
means the dashboard has something to show the moment it starts, instead
of an empty alert list until something happens. Backfill runs in the
same batched loop as live detection, yielding between batches, so a
large replay never blocks the API from serving requests.
"""

import asyncio
import traceback

from app.db.database import connection, get_connection, get_state, iso_cutoff, set_state
from app.detection.engine import evaluate_batch
from app.ws_manager import manager

POLL_INTERVAL_SECONDS = 2

# Rows per transaction. Large enough that backfill isn't dominated by
# per-batch overhead, small enough that the event loop gets its turn
# back promptly and a crash loses little work.
BATCH_SIZE = 400

BACKFILL_DAYS = 7

CURSOR_KEY = "detection_cursor"


def _initial_cursor() -> int:
    """Where to start on a database that has never been scored: just
    before the oldest event inside the backfill window."""
    with connection() as conn:
        row = conn.execute(
            "SELECT MIN(id) AS first_id FROM events WHERE timestamp >= ?",
            (iso_cutoff(days=BACKFILL_DAYS),),
        ).fetchone()

        if row and row["first_id"] is not None:
            return row["first_id"] - 1

        # Nothing inside the window — start after everything already
        # stored so detection begins with the next event written.
        row = conn.execute("SELECT COALESCE(MAX(id), 0) AS max_id FROM events").fetchone()
        return row["max_id"]


def _load_cursor() -> int:
    stored = get_state(CURSOR_KEY)
    if stored is not None:
        try:
            return int(stored)
        except ValueError:
            pass  # corrupted value; fall through and re-derive

    cursor = _initial_cursor()
    set_state(CURSOR_KEY, str(cursor))
    return cursor


def _process_batch(cursor: int) -> tuple[int, dict, int]:
    """Score up to BATCH_SIZE events after `cursor`.

    Returns the new cursor, what changed, and how many rows were read —
    the row count is what tells the loop whether more work is waiting,
    which is not the same question as whether anything alerted.

    One connection and one transaction for the batch: alerts, incident
    rollups, event severity bumps and the cursor advance all commit
    together, so a crash mid-batch replays that batch rather than
    leaving alerts written for events the cursor has already passed.
    """
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM events WHERE id > ? ORDER BY id ASC LIMIT ?",
            (cursor, BATCH_SIZE),
        ).fetchall()

        if not rows:
            return cursor, {"alerts": [], "event_updates": [], "incidents": []}, 0

        events = [dict(r) for r in rows]
        result = evaluate_batch(conn, events)
        new_cursor = events[-1]["id"]

        conn.execute(
            """INSERT INTO detection_state (key, value) VALUES (?, ?)
               ON CONFLICT(key) DO UPDATE SET value = excluded.value""",
            (CURSOR_KEY, str(new_cursor)),
        )
        conn.commit()
        return new_cursor, result, len(events)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


async def _broadcast(result: dict) -> None:
    for update in result["event_updates"]:
        await manager.broadcast({"type": "event_update", "data": update})
    for alert in result["alerts"]:
        await manager.broadcast({"type": "alert", "data": alert})
    for incident in result["incidents"]:
        await manager.broadcast({"type": "incident", "data": incident})


async def detection_loop() -> None:
    cursor = await asyncio.to_thread(_load_cursor)
    print(f"[detection] starting from event id {cursor}")

    while True:
        try:
            cursor, result, processed = await asyncio.to_thread(_process_batch, cursor)
        except Exception as exc:
            # Keep the cursor where it was and retry on the next tick —
            # a transient lock or a malformed row shouldn't permanently
            # stop detection.
            print(f"[detection] batch failed at cursor {cursor}: {exc}\n{traceback.format_exc()}")
            await asyncio.sleep(POLL_INTERVAL_SECONDS)
            continue

        if result["alerts"] or result["event_updates"] or result["incidents"]:
            await _broadcast(result)

        # A full batch means more rows are already waiting — during
        # backfill, loop straight on (yielding to the event loop, not
        # sleeping) rather than pausing two seconds every 400 rows.
        # Most backfill batches produce no alerts at all, so the row
        # count, not the alert count, is what decides this.
        if processed < BATCH_SIZE:
            await asyncio.sleep(POLL_INTERVAL_SECONDS)
        else:
            await asyncio.sleep(0)
