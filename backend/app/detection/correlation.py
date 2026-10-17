"""
Phase 3: grouping alerts into incidents.

An alert is one observation. An intrusion produces many, and an analyst
working a list of individual alerts has to reconstruct the relationship
between them by hand — which is the work this module does instead.

**What makes two alerts part of the same thing?** Shared process
lineage inside a time window. If a macro in Word spawned PowerShell,
which disabled Defender and then dumped credentials, those three alerts
fire on three different pids, but all three pids trace back through the
same ancestry to winword.exe. Walking up from each alert and looking
for an overlap is what connects them.

The alternative groupings were considered and rejected: by process name
alone (every powershell.exe on the machine becomes one case), by time
alone (unrelated background noise joins whatever is happening), by user
alone (one logged-in user means one permanent incident). Lineage plus a
window is what expresses "these events have a common origin".

**Only Medium and above open a case.** A Low alert joins an incident
that already exists around its lineage, but never creates one on its
own — otherwise every USB insertion becomes a case to triage and the
incident list stops meaning "things worth looking at".

Incidents are mutable: each new member alert re-derives the severity,
score, tactic set and time bounds from the alerts the incident now
holds, rather than patching the aggregate incrementally. Re-deriving is
a single grouped query, and it means a corrected or reclassified alert
can never leave the rollup out of step with its members.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta

from app.db.database import utc_now_iso

from .lineage import lineage_pids
from .mitre import TACTIC_LABELS, max_severity, severity_rank, severity_for_score, tactic_rank

# How far back an existing case can reach to claim a new alert. Long
# enough to cover a hands-on-keyboard sequence with pauses in it, short
# enough that this morning's case doesn't absorb this afternoon's
# unrelated activity.
INCIDENT_WINDOW_SECONDS = 1800

# Alerts below this never open a new incident (they still join one).
MIN_SEVERITY_TO_OPEN = "Medium"

# A case that has been worked and closed stays closed: late-arriving
# alerts open a fresh one rather than reopening an analyst's verdict.
JOINABLE_STATUSES = ("open", "investigating")


def _window_start(timestamp: str) -> str:
    return (
        datetime.fromisoformat(timestamp) - timedelta(seconds=INCIDENT_WINDOW_SECONDS)
    ).isoformat(timespec="milliseconds")


def _find_incident_by_lineage(conn, pids: set[int], timestamp: str) -> int | None:
    """An open incident that already claims one of these pids and was
    last active inside the window. Most recently active wins when
    several match."""
    if not pids:
        return None

    row = conn.execute(
        """SELECT i.id
             FROM incidents i
             JOIN incident_pids p ON p.incident_id = i.id
            WHERE p.pid IN ({})
              AND i.status IN ({})
              AND i.last_seen >= ?
         ORDER BY i.last_seen DESC
            LIMIT 1""".format(
            ",".join("?" * len(pids)), ",".join("?" * len(JOINABLE_STATUSES))
        ),
        (*sorted(pids), *JOINABLE_STATUSES, _window_start(timestamp)),
    ).fetchone()
    return row["id"] if row else None


def _find_incident_by_user(conn, user: str | None, timestamp: str) -> int | None:
    """Fallback for alerts with no pid to trace.

    Logon and USB events carry no process, so lineage can't place them.
    Matching on the account inside the same window is weaker evidence,
    which is why it only ever *joins* an existing case — it is never
    strong enough to open one.
    """
    if not user:
        return None

    row = conn.execute(
        """SELECT id FROM incidents
            WHERE user = ? AND status IN ({}) AND last_seen >= ?
         ORDER BY last_seen DESC LIMIT 1""".format(",".join("?" * len(JOINABLE_STATUSES))),
        (user, *JOINABLE_STATUSES, _window_start(timestamp)),
    ).fetchone()
    return row["id"] if row else None


def _create_incident(conn, alert: dict, pids: set[int]) -> int:
    now = utc_now_iso()
    cur = conn.execute(
        """INSERT INTO incidents
             (created_at, first_seen, last_seen, title, severity, score, status,
              root_pid, root_process, user, alert_count, tactics, summary)
           VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, 0, '[]', '')""",
        (
            now,
            alert["timestamp"],
            alert["timestamp"],
            alert["title"],
            alert["severity"],
            alert["score"],
            alert.get("pid"),
            alert.get("process_name"),
            alert.get("user"),
        ),
    )
    incident_id = cur.lastrowid

    conn.execute(
        """INSERT INTO case_notes (incident_id, created_at, author, kind, body)
           VALUES (?, ?, 'system', 'system', ?)""",
        (incident_id, now, f"Case opened automatically by rule {alert['rule_id']}."),
    )

    _claim_pids(conn, incident_id, pids)
    return incident_id


def _claim_pids(conn, incident_id: int, pids: set[int]) -> None:
    if not pids:
        return
    conn.executemany(
        "INSERT OR IGNORE INTO incident_pids (incident_id, pid) VALUES (?, ?)",
        [(incident_id, pid) for pid in pids],
    )


def _root_of(conn, incident_id: int) -> tuple[int | None, str | None, str | None]:
    """The incident's earliest alert decides how the case is labelled —
    the first thing observed is the closest we get to where it began."""
    row = conn.execute(
        """SELECT pid, process_name, user FROM alerts
            WHERE incident_id = ? ORDER BY timestamp ASC, id ASC LIMIT 1""",
        (incident_id,),
    ).fetchone()
    if row is None:
        return None, None, None
    return row["pid"], row["process_name"], row["user"]


def recompute_incident(conn, incident_id: int) -> dict | None:
    """Re-derive every aggregate field from the incident's member alerts.

    Scoring: the worst single alert sets the floor, then breadth adds to
    it. A case spanning execution, defense evasion and credential access
    is worse than three alerts that all say the same thing, because
    progression across tactics is what distinguishes an intrusion from a
    noisy process. Both bonuses are deliberately small — they sharpen
    the ordering of cases without letting a pile of Lows outrank a
    Critical.
    """
    rows = conn.execute(
        """SELECT severity, score, mitre_tactic, timestamp, title, rule_name, process_name
             FROM alerts WHERE incident_id = ? ORDER BY timestamp ASC, id ASC""",
        (incident_id,),
    ).fetchall()

    if not rows:
        # Every member alert was purged or reassigned; drop the shell.
        conn.execute("DELETE FROM incidents WHERE id = ?", (incident_id,))
        return None

    severity = "Information"
    best_score = 0
    tactics: list[str] = []
    for r in rows:
        severity = max_severity(severity, r["severity"])
        best_score = max(best_score, r["score"] or 0)
        tactic = r["mitre_tactic"]
        if tactic and tactic not in tactics:
            tactics.append(tactic)

    tactics.sort(key=tactic_rank)

    breadth_bonus = 6 * (len(tactics) - 1)
    volume_bonus = min(10, 2 * (len(rows) - 1))
    score = min(100, best_score + breadth_bonus + volume_bonus)

    # The score can only ever raise the case above its worst alert, never
    # soften it: a Critical alert keeps a Critical case even if the score
    # band would disagree.
    severity = max_severity(severity, severity_for_score(score))

    worst = max(rows, key=lambda r: (severity_rank(r["severity"]), r["score"] or 0))
    root_pid, root_process, user = _root_of(conn, incident_id)

    chain = " → ".join(TACTIC_LABELS.get(t, t) for t in tactics)
    summary = (
        f"{len(rows)} alert{'s' if len(rows) != 1 else ''} "
        f"across {len(tactics)} ATT&CK tactic{'s' if len(tactics) != 1 else ''}"
        + (f": {chain}" if chain else "")
    )

    # Named after the worst alert and *that alert's own* process, not
    # the case's first process. "Shadow Copy Deletion involving
    # vssadmin.exe" is what happened; "...involving cmd.exe" would name
    # whatever the case opened with, which is rarely the thing the
    # headline is about.
    title = worst["rule_name"]
    headline_process = worst["process_name"] or root_process
    if headline_process:
        title = f"{worst['rule_name']} involving {headline_process}"

    conn.execute(
        """UPDATE incidents
              SET first_seen = ?, last_seen = ?, title = ?, severity = ?, score = ?,
                  root_pid = ?, root_process = ?, user = ?, alert_count = ?,
                  tactics = ?, summary = ?
            WHERE id = ?""",
        (
            rows[0]["timestamp"],
            rows[-1]["timestamp"],
            title,
            severity,
            score,
            root_pid,
            root_process,
            user,
            len(rows),
            json.dumps(tactics),
            summary,
            incident_id,
        ),
    )

    return {
        "id": incident_id,
        "title": title,
        "severity": severity,
        "score": score,
        "alert_count": len(rows),
        "tactics": tactics,
        "summary": summary,
        "first_seen": rows[0]["timestamp"],
        "last_seen": rows[-1]["timestamp"],
    }


def correlate(conn, alert: dict) -> dict | None:
    """Place a freshly created alert into an incident.

    Returns the updated incident rollup, or None when the alert stays
    uncorrelated (a Low with nothing to join). Caller commits.
    """
    pids = lineage_pids(conn, alert.get("pid"), alert["timestamp"])

    incident_id = _find_incident_by_lineage(conn, pids, alert["timestamp"])
    if incident_id is None:
        incident_id = _find_incident_by_user(conn, alert.get("user"), alert["timestamp"])

    if incident_id is None:
        if severity_rank(alert["severity"]) < severity_rank(MIN_SEVERITY_TO_OPEN):
            return None
        incident_id = _create_incident(conn, alert, pids)
    else:
        # Joining a case extends its reach: the new alert's ancestry
        # becomes part of what the case will claim next time.
        _claim_pids(conn, incident_id, pids)

    conn.execute("UPDATE alerts SET incident_id = ? WHERE id = ?", (incident_id, alert["id"]))
    return recompute_incident(conn, incident_id)


def build_attack_chain(conn, incident_id: int) -> list[dict]:
    """The incident's alerts as an ordered kill-chain.

    Ordered by ATT&CK tactic first and timestamp second. Pure
    chronological order is already available in the event timeline; what
    the chain view adds is the *stage* reading — showing that a case
    reached credential access, and what led there. Where the two
    orderings disagree (a persistence alert arriving after a discovery
    one), each step carries its real timestamp so the actual sequence
    stays legible.
    """
    rows = conn.execute(
        """SELECT id, timestamp, rule_id, rule_name, severity, score, title,
                  mitre_id, mitre_tactic, mitre_technique, process_name, pid, user, status
             FROM alerts WHERE incident_id = ? ORDER BY timestamp ASC, id ASC""",
        (incident_id,),
    ).fetchall()

    steps = [dict(r) for r in rows]
    steps.sort(key=lambda s: (tactic_rank(s["mitre_tactic"]), s["timestamp"], s["id"]))

    for index, step in enumerate(steps, start=1):
        step["step"] = index
        step["tactic_label"] = TACTIC_LABELS.get(step["mitre_tactic"], step["mitre_tactic"])
    return steps
