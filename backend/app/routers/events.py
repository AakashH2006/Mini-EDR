"""
GET /events   - paginated, filterable, searchable, sortable list
GET /events/{id} - single event

Query building notes:
- All filter values are bound params, never string-interpolated into
  SQL, even though this is a local single-user tool — good habit, and
  it's free with sqlite3's `?` placeholders.
- `category` maps to the dashboard's four filter buttons (Processes /
  Network / USB / Authentication) onto the underlying event_type
  values, so the frontend doesn't need to know the raw type strings.
- `search` matches across process_name, user, pid, event_type in one
  go, per the spec's "Search: Process, PID, User, Event Type" — uses
  the process_name/event_type indices where possible, falls back to a
  LIKE scan for the free-text case (fine at this data volume).
- sort_by is whitelisted against real column names to avoid building
  a query with an unvalidated column identifier.
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from app.db.database import connection
from app.models import Event, EventList

router = APIRouter()

CATEGORY_MAP = {
    "processes": ["process_creation", "process_termination"],
    "network": ["network_connection"],
    "usb": ["usb_insert", "usb_remove"],
    "authentication": ["logon", "logoff"],
}

SORTABLE_COLUMNS = {"timestamp", "process_name", "event_type", "severity", "pid", "id"}


@router.get("/events", response_model=EventList)
def list_events(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    category: Optional[str] = Query(None, description="processes | network | usb | authentication"),
    event_type: Optional[str] = None,
    process_name: Optional[str] = None,
    pid: Optional[int] = None,
    user: Optional[str] = None,
    search: Optional[str] = None,
    sort_by: str = "timestamp",
    order: str = "desc",
):
    if sort_by not in SORTABLE_COLUMNS:
        raise HTTPException(400, f"sort_by must be one of {sorted(SORTABLE_COLUMNS)}")
    if order.lower() not in {"asc", "desc"}:
        raise HTTPException(400, "order must be 'asc' or 'desc'")

    where = []
    params: list = []

    if category:
        types = CATEGORY_MAP.get(category.lower())
        if not types:
            raise HTTPException(400, f"category must be one of {list(CATEGORY_MAP)}")
        where.append(f"event_type IN ({','.join('?' * len(types))})")
        params.extend(types)

    if event_type:
        where.append("event_type = ?")
        params.append(event_type)
    if process_name:
        where.append("process_name = ?")
        params.append(process_name)
    if pid is not None:
        where.append("pid = ?")
        params.append(pid)
    if user:
        where.append("user = ?")
        params.append(user)
    if search:
        where.append(
            "(process_name LIKE ? OR user LIKE ? OR event_type LIKE ? OR CAST(pid AS TEXT) LIKE ?)"
        )
        like = f"%{search}%"
        params.extend([like, like, like, like])

    where_clause = f"WHERE {' AND '.join(where)}" if where else ""

    with connection() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM events {where_clause}", params).fetchone()[0]
        rows = conn.execute(
            f"""SELECT * FROM events {where_clause}
                ORDER BY {sort_by} {order.upper()}
                LIMIT ? OFFSET ?""",
            [*params, limit, skip],
        ).fetchall()

    return EventList(
        total=total,
        skip=skip,
        limit=limit,
        items=[Event(**dict(r)) for r in rows],
    )


@router.get("/events/{event_id}", response_model=Event)
def get_event(event_id: int):
    with connection() as conn:
        row = conn.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Event not found")
    return Event(**dict(row))
