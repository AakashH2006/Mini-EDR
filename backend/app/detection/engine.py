"""
The detection engine: run the rule pack over events, write alerts.

Scope, deliberately: this module decides *what* to write, not *when* to
run or *who* to tell. It is synchronous, takes a connection, and returns
plain dicts describing what it changed. poller.py owns the scheduling
and the WebSocket broadcast. That split is what lets the same code path
serve live detection and historical backfill, and it keeps every
sqlite3 call off the asyncio event loop by construction.

Three things happen when a rule matches:

1. An **alert** row is written, with the evidence that made it match.
2. The **triggering event's severity is raised** to the alert's, so the
   Activity Explorer — which already colours rows by severity — lights
   up without needing to know detection exists. An event matched by two
   rules keeps the worse verdict.
3. The alert is handed to **correlation** to join or open an incident.

A rule that raises an exception is logged and skipped. One bad rule
(an unparseable command line, a detail field that isn't the shape it
expected) must not stop the other twenty from scoring the event, and
must not stall the cursor and halt detection entirely.
"""

from __future__ import annotations

import json
import traceback
from datetime import datetime, timedelta

from app.db.database import utc_now_iso

from . import correlation
from .mitre import max_severity, severity_rank
from .rules import RULES, RULES_BY_EVENT_TYPE, Match, Rule, RuleContext


def disabled_rule_ids(conn) -> set[str]:
    """Rules switched off from the dashboard.

    Stored as exceptions rather than as a full enabled-list: the rule
    pack in code is the source of truth for which rules exist, so a
    rule added in a later release is live by default instead of
    silently inert because no row was inserted for it.
    """
    rows = conn.execute("SELECT rule_id FROM rule_state WHERE enabled = 0").fetchall()
    return {r["rule_id"] for r in rows}


def _dedup_key(rule: Rule, event: dict, match: Match) -> str:
    """Identifies "the same finding again".

    Default entity is the pid, so one rule firing repeatedly on one
    process collapses to a single alert. Rules whose finding isn't
    about a single process override it — the discovery-burst rule keys
    on the user, the user-writable-directory rule on the path — so a
    burst stays one alert even as the pid changes with each invocation.
    """
    entity = match.dedup_entity
    if entity is None:
        entity = f"pid:{event.get('pid')}" if event.get("pid") is not None else "host"
    return f"{rule.id}|{entity}"


def _recently_alerted(conn, rule: Rule, dedup_key: str, timestamp: str) -> bool:
    """Has this same finding already fired inside the cooldown?

    Compared against the alert's `timestamp` (when the activity
    happened) rather than `created_at` (when the rule ran). During
    backfill thousands of historical events are scored within the same
    second, and a wall-clock comparison would collapse a week of
    genuinely separate findings into one alert.
    """
    if rule.cooldown_seconds <= 0:
        return False

    cutoff = (
        datetime.fromisoformat(timestamp) - timedelta(seconds=rule.cooldown_seconds)
    ).isoformat(timespec="milliseconds")

    row = conn.execute(
        "SELECT 1 FROM alerts WHERE dedup_key = ? AND timestamp > ? LIMIT 1",
        (dedup_key, cutoff),
    ).fetchone()
    return row is not None


def _write_alert(conn, rule: Rule, event: dict, match: Match, dedup_key: str) -> dict:
    severity = (match.severity or rule.severity).title()
    score = match.score if match.score is not None else rule.score
    created_at = utc_now_iso()

    cur = conn.execute(
        """INSERT INTO alerts
             (timestamp, created_at, rule_id, rule_name, severity, score, title,
              description, mitre_id, mitre_tactic, mitre_technique, event_id,
              process_name, pid, user, status, dedup_key, evidence)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)""",
        (
            event["timestamp"], created_at, rule.id, rule.name, severity, score,
            match.title, rule.description, rule.mitre_id, rule.mitre_tactic,
            rule.mitre_technique, event["id"], event.get("process_name"),
            event.get("pid"), event.get("user"), dedup_key,
            json.dumps(match.evidence, default=str),
        ),
    )
    alert_id = cur.lastrowid

    # Correlation rules cite every event in the pattern, so the drawer
    # can show the whole burst and not just the one that tipped it over
    # the threshold.
    supporting = {eid for eid in match.extra_event_ids if eid != event["id"]}
    if supporting:
        conn.executemany(
            "INSERT OR IGNORE INTO alert_events (alert_id, event_id) VALUES (?, ?)",
            [(alert_id, eid) for eid in sorted(supporting)],
        )

    return {
        "id": alert_id,
        "timestamp": event["timestamp"],
        "created_at": created_at,
        "rule_id": rule.id,
        "rule_name": rule.name,
        "severity": severity,
        "score": score,
        "title": match.title,
        "description": rule.description,
        "mitre_id": rule.mitre_id,
        "mitre_tactic": rule.mitre_tactic,
        "mitre_technique": rule.mitre_technique,
        "event_id": event["id"],
        "process_name": event.get("process_name"),
        "pid": event.get("pid"),
        "user": event.get("user"),
        "status": "new",
        "incident_id": None,
        "evidence": json.dumps(match.evidence, default=str),
        "supporting_event_count": len(supporting),
    }


def evaluate_event(conn, event: dict, disabled: set[str] | None = None) -> dict:
    """Score one event against every rule that handles its type.

    Returns what changed, for the caller to broadcast:
      {"alerts": [...], "event_update": {...} | None, "incidents": [...]}
    """
    disabled = disabled if disabled is not None else disabled_rule_ids(conn)

    candidates = RULES_BY_EVENT_TYPE.get(event["event_type"], ())
    if not candidates:
        return {"alerts": [], "event_update": None, "incidents": []}

    try:
        details = json.loads(event["details"]) if event.get("details") else {}
        if not isinstance(details, dict):
            details = {}
    except (ValueError, TypeError):
        details = {}

    ctx = RuleContext.build(event, details, conn)

    created: list[dict] = []
    incidents: list[dict] = []
    raised_severity = event.get("severity") or "Information"

    for rule in candidates:
        if rule.id in disabled:
            continue
        try:
            match = rule.check(ctx)
        except Exception:
            # One malformed event must not take detection down with it.
            print(f"[detection] rule {rule.id} failed on event {event['id']}:\n"
                  f"{traceback.format_exc()}")
            continue

        if match is None:
            continue

        dedup_key = _dedup_key(rule, event, match)
        if _recently_alerted(conn, rule, dedup_key, event["timestamp"]):
            continue

        alert = _write_alert(conn, rule, event, match, dedup_key)
        rollup = correlation.correlate(conn, alert)
        if rollup:
            alert["incident_id"] = rollup["id"]
            incidents.append(rollup)

        created.append(alert)
        raised_severity = max_severity(raised_severity, alert["severity"])

    event_update = None
    if severity_rank(raised_severity) > severity_rank(event.get("severity")):
        conn.execute(
            "UPDATE events SET severity = ? WHERE id = ?", (raised_severity, event["id"])
        )
        event_update = {"id": event["id"], "severity": raised_severity}

    return {"alerts": created, "event_update": event_update, "incidents": incidents}


def evaluate_batch(conn, events: list[dict]) -> dict:
    """Score a run of events, accumulating everything that changed.

    The disabled-rule set is read once for the batch rather than per
    event: during backfill that would be one extra query per row, and a
    rule toggled mid-backfill taking effect at the next batch instead
    of the next row is not a distinction anyone can observe.
    """
    disabled = disabled_rule_ids(conn)

    alerts: list[dict] = []
    event_updates: list[dict] = []
    incidents: dict[int, dict] = {}

    for event in events:
        result = evaluate_event(conn, event, disabled)
        alerts.extend(result["alerts"])
        if result["event_update"]:
            event_updates.append(result["event_update"])
        # An incident touched twice in one batch should be broadcast
        # once, in its final state.
        for rollup in result["incidents"]:
            incidents[rollup["id"]] = rollup

    return {
        "alerts": alerts,
        "event_updates": event_updates,
        "incidents": list(incidents.values()),
    }


def rule_catalog(conn) -> list[dict]:
    """The rule pack as data, with each rule's live enabled state and
    how many alerts it has produced. Powers the Detection Rules panel."""
    disabled = disabled_rule_ids(conn)
    counts = {
        r["rule_id"]: r["n"]
        for r in conn.execute("SELECT rule_id, COUNT(*) AS n FROM alerts GROUP BY rule_id")
    }

    return [
        {
            "id": rule.id,
            "name": rule.name,
            "severity": rule.severity,
            "score": rule.score,
            "description": rule.description,
            "mitre_id": rule.mitre_id,
            "mitre_tactic": rule.mitre_tactic,
            "mitre_technique": rule.mitre_technique,
            "event_types": list(rule.event_types),
            "cooldown_seconds": rule.cooldown_seconds,
            "enabled": rule.id not in disabled,
            "alert_count": counts.get(rule.id, 0),
        }
        for rule in RULES
    ]


def set_rule_enabled(conn, rule_id: str, enabled: bool) -> None:
    conn.execute(
        """INSERT INTO rule_state (rule_id, enabled, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(rule_id) DO UPDATE SET
             enabled = excluded.enabled, updated_at = excluded.updated_at""",
        (rule_id, 1 if enabled else 0, utc_now_iso()),
    )
