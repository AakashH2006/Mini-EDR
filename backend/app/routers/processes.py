"""
GET /processes — one row per process instance (pid + its creation
event), enriched with a best-effort termination lookup.

Why a correlated subquery instead of a JOIN:
A plain JOIN between creation and termination rows on pid can multiply
rows if a pid is reused (fork/exit cycles across the retention window),
producing duplicate process rows. The correlated subquery picks the
*earliest* termination at/after the creation timestamp for that pid,
which is deterministic and keeps one row per creation event.
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from app.db.database import connection

router = APIRouter()

SORTABLE_COLUMNS = {"first_seen", "process_name", "pid", "last_seen"}


class ProcessOut(BaseModel):
    id: int
    pid: Optional[int]
    process_name: Optional[str]
    parent_process: Optional[str]
    user: Optional[str]
    first_seen: str
    last_seen: str
    status: str  # "running" | "terminated"


class ProcessList(BaseModel):
    total: int
    skip: int
    limit: int
    items: list[ProcessOut]


@router.get("/processes", response_model=ProcessList)
def list_processes(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    status: Optional[str] = Query(None, description="running | terminated"),
    search: Optional[str] = None,
    sort_by: str = "first_seen",
    order: str = "desc",
):
    if sort_by not in SORTABLE_COLUMNS:
        raise HTTPException(400, f"sort_by must be one of {sorted(SORTABLE_COLUMNS)}")
    if order.lower() not in {"asc", "desc"}:
        raise HTTPException(400, "order must be 'asc' or 'desc'")
    if status and status not in {"running", "terminated"}:
        raise HTTPException(400, "status must be 'running' or 'terminated'")

    select_core = """
        SELECT c.id, c.pid, c.process_name, c.parent_process, c.user,
               c.timestamp AS first_seen,
               (SELECT MIN(t.timestamp) FROM events t
                 WHERE t.pid = c.pid AND t.event_type = 'process_termination'
                   AND t.timestamp >= c.timestamp) AS terminated_at
        FROM events c
        WHERE c.event_type = 'process_creation'
    """

    where = []
    params: list = []
    if search:
        where.append("(c.process_name LIKE ? OR CAST(c.pid AS TEXT) LIKE ?)")
        like = f"%{search}%"
        params.extend([like, like])

    where_sql = (" AND " + " AND ".join(where)) if where else ""

    with connection() as conn:
        rows = conn.execute(select_core + where_sql, params).fetchall()

    # status filter + sort applied in Python: terminated_at is a derived
    # column, cheapest to finish assembling here rather than wrapping
    # the query in another SELECT just to filter/order on it.
    items = []
    for r in rows:
        terminated_at = r["terminated_at"]
        items.append(
            ProcessOut(
                id=r["id"],
                pid=r["pid"],
                process_name=r["process_name"],
                parent_process=r["parent_process"],
                user=r["user"],
                first_seen=r["first_seen"],
                last_seen=terminated_at or r["first_seen"],
                status="terminated" if terminated_at else "running",
            )
        )

    if status:
        items = [i for i in items if i.status == status]

    reverse = order.lower() == "desc"
    items.sort(key=lambda i: getattr(i, sort_by) or "", reverse=reverse)

    total = len(items)
    page = items[skip: skip + limit]

    return ProcessList(total=total, skip=skip, limit=limit, items=page)
