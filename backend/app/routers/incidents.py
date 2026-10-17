"""
Phase 3 investigation API.

GET   /incidents                  the case queue
GET   /incidents/stats            counts for the summary cards
GET   /incidents/{id}             one case: alerts, attack chain, notes
GET   /incidents/{id}/chain       just the attack chain
GET   /incidents/{id}/tree        process trees rooted at the case's origins
PATCH /incidents/{id}             move the case through the workflow
POST  /incidents/{id}/notes       add an analyst note

Cases sort by score, not time. Score already folds in severity, how
many tactics the case spans and how many alerts it holds (see
correlation.recompute_incident), which is a better ordering for a queue
than any single one of those.
"""

import json
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from typing import Optional

from app.db.database import connection, utc_now_iso
from app.detection import lineage
from app.detection.correlation import build_attack_chain
from app.detection.mitre import SEVERITIES, TACTIC_LABELS

router = APIRouter()

INCIDENT_STATUSES = {"open", "investigating", "contained", "closed", "false_positive"}
ACTIVE_STATUSES = ("open", "investigating", "contained")

SORTABLE_COLUMNS = {"score", "last_seen", "first_seen", "alert_count", "id"}


class IncidentOut(BaseModel):
    id: int
    created_at: str
    first_seen: str
    last_seen: str
    title: str
    severity: str
    score: int
    status: str
    root_pid: Optional[int] = None
    root_process: Optional[str] = None
    user: Optional[str] = None
    alert_count: int
    tactics: list[str] = Field(default_factory=list)
    summary: Optional[str] = None


class IncidentList(BaseModel):
    total: int
    skip: int
    limit: int
    items: list[IncidentOut]


class ChainStep(BaseModel):
    step: int
    id: int
    timestamp: str
    rule_id: str
    rule_name: str
    severity: str
    score: int
    title: str
    status: str
    mitre_id: Optional[str] = None
    mitre_tactic: Optional[str] = None
    mitre_technique: Optional[str] = None
    tactic_label: Optional[str] = None
    process_name: Optional[str] = None
    pid: Optional[int] = None
    user: Optional[str] = None


class CaseNote(BaseModel):
    id: int
    created_at: str
    author: Optional[str] = None
    kind: str
    body: str


class IncidentDetail(IncidentOut):
    chain: list[ChainStep]
    notes: list[CaseNote]
    tactic_labels: dict[str, str]


class IncidentStats(BaseModel):
    total: int
    active: int
    by_status: dict[str, int]
    by_severity: dict[str, int]
    highest_score: int


class IncidentStatusUpdate(BaseModel):
    status: str
    note: Optional[str] = None


class NoteCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    author: Optional[str] = Field(default="analyst", max_length=120)


def _to_out(row) -> IncidentOut:
    data = dict(row)
    try:
        data["tactics"] = json.loads(data.get("tactics") or "[]")
    except ValueError:
        data["tactics"] = []
    return IncidentOut(**data)


@router.get("/incidents", response_model=IncidentList)
def list_incidents(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    status: Optional[str] = Query(None, description="'active' or comma-separated statuses"),
    severity: Optional[str] = None,
    search: Optional[str] = None,
    sort_by: str = "score",
    order: str = "desc",
):
    if sort_by not in SORTABLE_COLUMNS:
        raise HTTPException(400, f"sort_by must be one of {sorted(SORTABLE_COLUMNS)}")
    if order.lower() not in {"asc", "desc"}:
        raise HTTPException(400, "order must be 'asc' or 'desc'")

    where: list[str] = []
    params: list = []

    if status:
        if status == "active":
            where.append(f"status IN ({','.join('?' * len(ACTIVE_STATUSES))})")
            params.extend(ACTIVE_STATUSES)
        else:
            names = [s.strip() for s in status.split(",") if s.strip()]
            invalid = [n for n in names if n not in INCIDENT_STATUSES]
            if invalid:
                raise HTTPException(400, f"Unknown status: {invalid}")
            where.append(f"status IN ({','.join('?' * len(names))})")
            params.extend(names)

    if severity:
        names = [s.strip().title() for s in severity.split(",") if s.strip()]
        invalid = [n for n in names if n not in SEVERITIES]
        if invalid:
            raise HTTPException(400, f"Unknown severity: {invalid}")
        where.append(f"severity IN ({','.join('?' * len(names))})")
        params.extend(names)

    if search:
        where.append("(title LIKE ? OR root_process LIKE ? OR user LIKE ? OR summary LIKE ?)")
        like = f"%{search}%"
        params.extend([like] * 4)

    where_clause = f"WHERE {' AND '.join(where)}" if where else ""
    direction = order.upper()

    with connection() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) FROM incidents {where_clause}", params
        ).fetchone()[0]
        rows = conn.execute(
            f"""SELECT * FROM incidents {where_clause}
                ORDER BY {sort_by} {direction}, last_seen DESC
                LIMIT ? OFFSET ?""",
            [*params, limit, skip],
        ).fetchall()

    return IncidentList(total=total, skip=skip, limit=limit, items=[_to_out(r) for r in rows])


@router.get("/incidents/stats", response_model=IncidentStats)
def incident_stats():
    with connection() as conn:
        total = conn.execute("SELECT COUNT(*) FROM incidents").fetchone()[0]

        by_status = {s: 0 for s in sorted(INCIDENT_STATUSES)}
        for row in conn.execute("SELECT status, COUNT(*) AS n FROM incidents GROUP BY status"):
            by_status[row["status"]] = row["n"]

        by_severity = {s: 0 for s in SEVERITIES if s != "Information"}
        for row in conn.execute("SELECT severity, COUNT(*) AS n FROM incidents GROUP BY severity"):
            by_severity[row["severity"]] = row["n"]

        highest = conn.execute(
            f"""SELECT COALESCE(MAX(score), 0) FROM incidents
                 WHERE status IN ({','.join('?' * len(ACTIVE_STATUSES))})""",
            ACTIVE_STATUSES,
        ).fetchone()[0]

    return IncidentStats(
        total=total,
        active=sum(by_status.get(s, 0) for s in ACTIVE_STATUSES),
        by_status=by_status,
        by_severity=by_severity,
        highest_score=highest,
    )


@router.get("/incidents/{incident_id}", response_model=IncidentDetail)
def get_incident(incident_id: int):
    with connection() as conn:
        row = conn.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "Incident not found")

        chain = build_attack_chain(conn, incident_id)
        notes = conn.execute(
            """SELECT id, created_at, author, kind, body FROM case_notes
                WHERE incident_id = ? ORDER BY created_at ASC, id ASC""",
            (incident_id,),
        ).fetchall()

    base = _to_out(row)
    return IncidentDetail(
        **base.model_dump(),
        chain=[ChainStep(**s) for s in chain],
        notes=[CaseNote(**dict(n)) for n in notes],
        # Shipped with the case so the frontend doesn't keep a second
        # copy of the ATT&CK tactic vocabulary that can drift from the
        # backend's.
        tactic_labels=TACTIC_LABELS,
    )


@router.get("/incidents/{incident_id}/chain", response_model=list[ChainStep])
def get_incident_chain(incident_id: int):
    with connection() as conn:
        exists = conn.execute("SELECT 1 FROM incidents WHERE id = ?", (incident_id,)).fetchone()
        if exists is None:
            raise HTTPException(404, "Incident not found")
        return [ChainStep(**s) for s in build_attack_chain(conn, incident_id)]


@router.get("/incidents/{incident_id}/tree")
def get_incident_tree(incident_id: int):
    """Process trees for the case.

    Built from the *distinct lineage roots* of the case's alerts, not
    one tree per alert: five alerts on five pids that all descend from
    the same winword.exe are one story, and showing it five times would
    obscure that. Each root is walked up to its topmost known ancestor
    first, so the tree starts where the activity started rather than
    where it was noticed.
    """
    with connection() as conn:
        incident = conn.execute(
            "SELECT * FROM incidents WHERE id = ?", (incident_id,)
        ).fetchone()
        if incident is None:
            raise HTTPException(404, "Incident not found")

        alert_rows = conn.execute(
            """SELECT DISTINCT pid, timestamp FROM alerts
                WHERE incident_id = ? AND pid IS NOT NULL
             ORDER BY timestamp ASC""",
            (incident_id,),
        ).fetchall()

        roots: list[dict] = []
        covered_event_ids: set[int] = set()

        for alert_row in alert_rows:
            node = lineage.node_for_pid_at(conn, alert_row["pid"], alert_row["timestamp"])
            if node is None:
                continue

            chain = lineage.ancestors(conn, node)
            root_node = chain[-1] if chain else node
            if root_node.event_id in covered_event_ids:
                continue  # already rendered as part of an earlier tree

            tree = lineage.build_subtree(conn, root_node)
            covered_event_ids.add(root_node.event_id)
            roots.append(tree.to_dict())

    return {
        "incident_id": incident_id,
        "roots": roots,
        "alert_pids": [r["pid"] for r in alert_rows],
    }


@router.patch("/incidents/{incident_id}", response_model=IncidentOut)
def update_incident(incident_id: int, payload: IncidentStatusUpdate):
    """Advance the case through the workflow.

    Every transition writes a note. A case's history is the record of
    what was decided and when, so a status that changed without leaving
    a trace would be a gap in exactly the thing the notes exist for.
    """
    if payload.status not in INCIDENT_STATUSES:
        raise HTTPException(400, f"status must be one of {sorted(INCIDENT_STATUSES)}")

    with connection() as conn:
        row = conn.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "Incident not found")

        previous = row["status"]
        if previous != payload.status:
            conn.execute(
                "UPDATE incidents SET status = ? WHERE id = ?", (payload.status, incident_id)
            )
            body = f"Status changed from {previous} to {payload.status}."
            if payload.note:
                body += f" {payload.note}"
            conn.execute(
                """INSERT INTO case_notes (incident_id, created_at, author, kind, body)
                   VALUES (?, ?, 'analyst', 'status_change', ?)""",
                (incident_id, utc_now_iso(), body),
            )

        updated = conn.execute(
            "SELECT * FROM incidents WHERE id = ?", (incident_id,)
        ).fetchone()

    return _to_out(updated)


@router.post("/incidents/{incident_id}/notes", response_model=CaseNote, status_code=201)
def add_note(incident_id: int, payload: NoteCreate):
    with connection() as conn:
        exists = conn.execute("SELECT 1 FROM incidents WHERE id = ?", (incident_id,)).fetchone()
        if exists is None:
            raise HTTPException(404, "Incident not found")

        created_at = utc_now_iso()
        cur = conn.execute(
            """INSERT INTO case_notes (incident_id, created_at, author, kind, body)
               VALUES (?, ?, ?, 'note', ?)""",
            (incident_id, created_at, payload.author or "analyst", payload.body),
        )
        note_id = cur.lastrowid

    return CaseNote(
        id=note_id, created_at=created_at, author=payload.author or "analyst",
        kind="note", body=payload.body,
    )
