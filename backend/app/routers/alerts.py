"""
GET   /alerts              paginated, filterable alert list
GET   /alerts/stats        severity/status counts for the summary cards
GET   /alerts/{id}         one alert with its evidence events
PATCH /alerts/{id}         triage: change status

Mirrors the shape of /events (skip/limit/search/sort_by/order) so the
dashboard's pagination and toolbar components work against it unchanged.

Sorting defaults to severity rather than time. An alert list is a work
queue, not a feed: the Critical from twenty minutes ago outranks the
Low from twenty seconds ago. `severity` is stored as a word, so
ordering it alphabetically would read Critical, High, Information, Low,
Medium — meaningless. The CASE expression below maps it to rank order
instead.
"""

import json
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from app.db.database import connection, iso_cutoff
from app.detection.mitre import SEVERITIES

router = APIRouter()

ALERT_STATUSES = {"new", "investigating", "resolved", "false_positive"}

# Open = still demands attention. Used by the sidebar badge and the
# default list filter, so "what's left to triage" is one concept defined
# in one place.
OPEN_STATUSES = ("new", "investigating")

SORTABLE_COLUMNS = {"timestamp", "severity", "score", "rule_id", "process_name", "id"}

# Severity sorts by rank, not alphabetically.
_SEVERITY_ORDER_SQL = "CASE severity " + " ".join(
    f"WHEN '{name}' THEN {rank}" for rank, name in enumerate(SEVERITIES)
) + " ELSE -1 END"


class AlertOut(BaseModel):
    id: int
    timestamp: str
    created_at: str
    rule_id: str
    rule_name: str
    severity: str
    score: int
    title: str
    description: Optional[str] = None
    mitre_id: Optional[str] = None
    mitre_tactic: Optional[str] = None
    mitre_technique: Optional[str] = None
    event_id: Optional[int] = None
    process_name: Optional[str] = None
    pid: Optional[int] = None
    user: Optional[str] = None
    status: str
    incident_id: Optional[int] = None
    evidence: Optional[str] = None  # raw JSON string; frontend parses


class AlertList(BaseModel):
    total: int
    skip: int
    limit: int
    items: list[AlertOut]


class AlertEvent(BaseModel):
    id: int
    timestamp: str
    event_type: str
    process_name: Optional[str] = None
    parent_process: Optional[str] = None
    pid: Optional[int] = None
    user: Optional[str] = None
    severity: str
    details: Optional[str] = None
    role: str  # "trigger" | "supporting"


class AlertDetail(AlertOut):
    events: list[AlertEvent]


class AlertStats(BaseModel):
    total: int
    open: int
    by_severity: dict[str, int]
    by_status: dict[str, int]
    last_24h: int
    top_rules: list[dict]


class StatusUpdate(BaseModel):
    status: str


def _where(
    severity: Optional[str],
    status: Optional[str],
    rule_id: Optional[str],
    tactic: Optional[str],
    incident_id: Optional[int],
    search: Optional[str],
) -> tuple[str, list]:
    where: list[str] = []
    params: list = []

    if severity:
        names = [s.strip().title() for s in severity.split(",") if s.strip()]
        invalid = [n for n in names if n not in SEVERITIES]
        if invalid:
            raise HTTPException(400, f"Unknown severity: {invalid}")
        where.append(f"severity IN ({','.join('?' * len(names))})")
        params.extend(names)

    if status:
        if status == "open":
            where.append(f"status IN ({','.join('?' * len(OPEN_STATUSES))})")
            params.extend(OPEN_STATUSES)
        else:
            names = [s.strip() for s in status.split(",") if s.strip()]
            invalid = [n for n in names if n not in ALERT_STATUSES]
            if invalid:
                raise HTTPException(400, f"Unknown status: {invalid}")
            where.append(f"status IN ({','.join('?' * len(names))})")
            params.extend(names)

    if rule_id:
        where.append("rule_id = ?")
        params.append(rule_id)
    if tactic:
        where.append("mitre_tactic = ?")
        params.append(tactic)
    if incident_id is not None:
        where.append("incident_id = ?")
        params.append(incident_id)

    if search:
        where.append(
            """(title LIKE ? OR rule_name LIKE ? OR rule_id LIKE ?
                OR process_name LIKE ? OR user LIKE ? OR mitre_id LIKE ?
                OR CAST(pid AS TEXT) LIKE ?)"""
        )
        like = f"%{search}%"
        params.extend([like] * 7)

    return (f"WHERE {' AND '.join(where)}" if where else "", params)


@router.get("/alerts", response_model=AlertList)
def list_alerts(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    severity: Optional[str] = Query(None, description="comma-separated, e.g. High,Critical"),
    status: Optional[str] = Query(None, description="'open' or comma-separated statuses"),
    rule_id: Optional[str] = None,
    tactic: Optional[str] = None,
    incident_id: Optional[int] = None,
    search: Optional[str] = None,
    sort_by: str = "severity",
    order: str = "desc",
):
    if sort_by not in SORTABLE_COLUMNS:
        raise HTTPException(400, f"sort_by must be one of {sorted(SORTABLE_COLUMNS)}")
    if order.lower() not in {"asc", "desc"}:
        raise HTTPException(400, "order must be 'asc' or 'desc'")

    where_clause, params = _where(severity, status, rule_id, tactic, incident_id, search)
    direction = order.upper()

    # Severity ties break on recency, so equally-severe alerts still
    # read newest-first rather than in insertion order.
    order_sql = (
        f"{_SEVERITY_ORDER_SQL} {direction}, timestamp DESC"
        if sort_by == "severity"
        else f"{sort_by} {direction}, id {direction}"
    )

    with connection() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM alerts {where_clause}", params).fetchone()[0]
        rows = conn.execute(
            f"SELECT * FROM alerts {where_clause} ORDER BY {order_sql} LIMIT ? OFFSET ?",
            [*params, limit, skip],
        ).fetchall()

    return AlertList(
        total=total, skip=skip, limit=limit,
        items=[AlertOut(**dict(r)) for r in rows],
    )


@router.get("/alerts/stats", response_model=AlertStats)
def alert_stats():
    """Counts for the Alerts page summary cards.

    Declared before /alerts/{id} because FastAPI matches routes in
    definition order — registered after it, "stats" would be parsed as
    an alert id and 422 on the int conversion.
    """
    with connection() as conn:
        total = conn.execute("SELECT COUNT(*) FROM alerts").fetchone()[0]

        by_severity = {s: 0 for s in SEVERITIES if s != "Information"}
        for row in conn.execute("SELECT severity, COUNT(*) AS n FROM alerts GROUP BY severity"):
            by_severity[row["severity"]] = row["n"]

        by_status = {s: 0 for s in sorted(ALERT_STATUSES)}
        for row in conn.execute("SELECT status, COUNT(*) AS n FROM alerts GROUP BY status"):
            by_status[row["status"]] = row["n"]

        last_24h = conn.execute(
            "SELECT COUNT(*) FROM alerts WHERE timestamp >= ?", (iso_cutoff(days=1),)
        ).fetchone()[0]

        top_rules = [
            {"rule_id": r["rule_id"], "rule_name": r["rule_name"], "count": r["n"]}
            for r in conn.execute(
                """SELECT rule_id, rule_name, COUNT(*) AS n FROM alerts
                   GROUP BY rule_id, rule_name ORDER BY n DESC LIMIT 5"""
            )
        ]

    return AlertStats(
        total=total,
        open=sum(by_status.get(s, 0) for s in OPEN_STATUSES),
        by_severity=by_severity,
        by_status=by_status,
        last_24h=last_24h,
        top_rules=top_rules,
    )


@router.get("/alerts/{alert_id}", response_model=AlertDetail)
def get_alert(alert_id: int):
    """One alert plus every event behind it.

    The trigger comes first, then any supporting events a correlation
    rule cited — for a burst rule the supporting set *is* the finding,
    so the drawer has to show it rather than a single representative
    row.
    """
    with connection() as conn:
        row = conn.execute("SELECT * FROM alerts WHERE id = ?", (alert_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "Alert not found")

        events = []
        if row["event_id"] is not None:
            trigger = conn.execute(
                "SELECT * FROM events WHERE id = ?", (row["event_id"],)
            ).fetchone()
            if trigger:
                events.append(AlertEvent(**dict(trigger), role="trigger"))

        supporting = conn.execute(
            """SELECT e.* FROM events e
                 JOIN alert_events ae ON ae.event_id = e.id
                WHERE ae.alert_id = ?
             ORDER BY e.timestamp ASC
                LIMIT 100""",
            (alert_id,),
        ).fetchall()
        events.extend(AlertEvent(**dict(e), role="supporting") for e in supporting)

    return AlertDetail(**dict(row), events=events)


@router.patch("/alerts/{alert_id}", response_model=AlertOut)
def update_alert_status(alert_id: int, payload: StatusUpdate):
    """Triage an alert.

    Marking an alert resolved or false-positive re-derives its
    incident's rollup: a case whose every alert has been dismissed
    should not keep advertising a Critical severity. The incident's own
    status is left alone — closing the case stays an explicit decision
    the analyst makes on the case itself.
    """
    if payload.status not in ALERT_STATUSES:
        raise HTTPException(400, f"status must be one of {sorted(ALERT_STATUSES)}")

    from app.detection.correlation import recompute_incident

    with connection() as conn:
        row = conn.execute("SELECT * FROM alerts WHERE id = ?", (alert_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "Alert not found")

        conn.execute("UPDATE alerts SET status = ? WHERE id = ?", (payload.status, alert_id))

        if row["incident_id"] is not None:
            recompute_incident(conn, row["incident_id"])

        updated = conn.execute("SELECT * FROM alerts WHERE id = ?", (alert_id,)).fetchone()

    return AlertOut(**dict(updated))


@router.get("/alerts/{alert_id}/evidence")
def alert_evidence(alert_id: int):
    """The evidence blob parsed into an object, for clients that would
    rather not JSON.parse a string field."""
    with connection() as conn:
        row = conn.execute("SELECT evidence FROM alerts WHERE id = ?", (alert_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Alert not found")
    try:
        return json.loads(row["evidence"]) if row["evidence"] else {}
    except ValueError:
        return {"raw": row["evidence"]}
