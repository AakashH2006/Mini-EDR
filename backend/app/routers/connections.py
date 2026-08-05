"""
GET /connections — network_connection events with the JSON `details`
blob unpacked into real fields, since the frontend table needs
remote_addr/port etc. as first-class columns, not nested JSON.

`active` flag reuses the same recency heuristic as /stats
(ACTIVE_CONN_WINDOW_MINUTES) so the two stay consistent — a connection
counted in the "Active Connections" status card should also show as
active in this table.
"""

import json
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from app.db.database import connection
from app.routers.stats import ACTIVE_CONN_WINDOW_MINUTES

router = APIRouter()

SORTABLE_COLUMNS = {"timestamp", "process_name", "pid"}


class ConnectionOut(BaseModel):
    id: int
    timestamp: str
    pid: Optional[int]
    process_name: Optional[str]
    local_addr: Optional[str]
    local_port: Optional[int]
    remote_addr: Optional[str]
    remote_port: Optional[int]
    status: Optional[str]
    active: bool


class ConnectionList(BaseModel):
    total: int
    skip: int
    limit: int
    items: list[ConnectionOut]


@router.get("/connections", response_model=ConnectionList)
def list_connections(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    process_name: Optional[str] = None,
    remote_addr: Optional[str] = None,
    search: Optional[str] = None,
    sort_by: str = "timestamp",
    order: str = "desc",
):
    if sort_by not in SORTABLE_COLUMNS:
        raise HTTPException(400, f"sort_by must be one of {sorted(SORTABLE_COLUMNS)}")
    if order.lower() not in {"asc", "desc"}:
        raise HTTPException(400, "order must be 'asc' or 'desc'")

    where = ["event_type = 'network_connection'"]
    params: list = []
    if process_name:
        where.append("process_name = ?")
        params.append(process_name)
    if remote_addr:
        where.append("json_extract(details,'$.remote_addr') = ?")
        params.append(remote_addr)
    if search:
        where.append(
            "(process_name LIKE ? OR CAST(pid AS TEXT) LIKE ? OR json_extract(details,'$.remote_addr') LIKE ?)"
        )
        like = f"%{search}%"
        params.extend([like, like, like])

    where_sql = "WHERE " + " AND ".join(where)

    with connection() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM events {where_sql}", params).fetchone()[0]
        rows = conn.execute(
            f"""SELECT id, timestamp, pid, process_name, details,
                       (julianday('now') - julianday(timestamp)) * 1440.0 <= ? AS active
                FROM events {where_sql}
                ORDER BY {sort_by} {order.upper()}
                LIMIT ? OFFSET ?""",
            [ACTIVE_CONN_WINDOW_MINUTES, *params, limit, skip],
        ).fetchall()

    items = []
    for r in rows:
        d = json.loads(r["details"]) if r["details"] else {}
        items.append(
            ConnectionOut(
                id=r["id"],
                timestamp=r["timestamp"],
                pid=r["pid"],
                process_name=r["process_name"],
                local_addr=d.get("local_addr"),
                local_port=d.get("local_port"),
                remote_addr=d.get("remote_addr"),
                remote_port=d.get("remote_port"),
                status=d.get("status"),
                active=bool(r["active"]),
            )
        )

    return ConnectionList(total=total, skip=skip, limit=limit, items=items)
