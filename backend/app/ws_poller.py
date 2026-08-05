"""
Polls the events table for rows newer than the last one we've seen and
broadcasts each as a WS message. Runs as an asyncio background task
started on API startup.

- Starts from the current MAX(id) at boot, not 0 — clients get live
  updates, not a replay of history (history is what GET /events is
  for).
- DB reads happen via asyncio.to_thread since sqlite3 is synchronous;
  without that, a slow query would block the whole event loop and
  stall every connected WS client, not just delay this poll cycle.
- Poll interval is short (1s) since this is a local single-endpoint
  tool — negligible CPU cost, and it keeps perceived latency low
  without needing SQLite's (fiddlier, overkill here) update hooks.
"""

import asyncio
from app.db.database import connection
from app.ws_manager import manager

POLL_INTERVAL_SECONDS = 1


def _fetch_new_events(since_id: int):
    with connection() as conn:
        rows = conn.execute(
            "SELECT * FROM events WHERE id > ? ORDER BY id ASC", (since_id,)
        ).fetchall()
        return [dict(r) for r in rows]


def _current_max_id() -> int:
    with connection() as conn:
        row = conn.execute("SELECT COALESCE(MAX(id), 0) FROM events").fetchone()
        return row[0]


async def event_poll_loop():
    last_id = await asyncio.to_thread(_current_max_id)
    while True:
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
        try:
            new_rows = await asyncio.to_thread(_fetch_new_events, last_id)
        except Exception as exc:
            print(f"WS poll error: {exc}")
            continue

        for row in new_rows:
            last_id = row["id"]
            await manager.broadcast({"type": "event", "data": row})
