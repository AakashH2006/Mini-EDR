"""
GET  /rules                 the rule pack, with live state and hit counts
POST /rules/{id}/toggle     enable or disable one rule

The rule pack itself is code, not configuration: a rule is a predicate,
and the pack ships fixed. What *is* configurable is whether each rule
runs, so a rule that is noisy on a particular machine can be silenced
without editing source or restarting the API — the engine re-reads the
disabled set at the start of every batch.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.db.database import connection
from app.detection import engine
from app.detection.mitre import TACTIC_LABELS
from app.detection.rules import RULES_BY_ID

router = APIRouter()


class RuleOut(BaseModel):
    id: str
    name: str
    severity: str
    score: int
    description: str
    mitre_id: str
    mitre_tactic: str
    mitre_technique: str
    event_types: list[str]
    cooldown_seconds: int
    enabled: bool
    alert_count: int
    tactic_label: Optional[str] = None


class ToggleRequest(BaseModel):
    enabled: bool


@router.get("/rules", response_model=list[RuleOut])
def list_rules():
    with connection() as conn:
        catalog = engine.rule_catalog(conn)
    for rule in catalog:
        rule["tactic_label"] = TACTIC_LABELS.get(rule["mitre_tactic"], rule["mitre_tactic"])
    return [RuleOut(**r) for r in catalog]


@router.post("/rules/{rule_id}/toggle", response_model=RuleOut)
def toggle_rule(rule_id: str, payload: ToggleRequest):
    """Disabling a rule stops it from firing again; it does not retract
    alerts it has already raised. Those were real observations, and
    deleting them would quietly rewrite history an analyst may have
    already acted on."""
    if rule_id not in RULES_BY_ID:
        raise HTTPException(404, f"Unknown rule '{rule_id}'")

    with connection() as conn:
        engine.set_rule_enabled(conn, rule_id, payload.enabled)
        catalog = {r["id"]: r for r in engine.rule_catalog(conn)}

    entry = catalog[rule_id]
    entry["tactic_label"] = TACTIC_LABELS.get(entry["mitre_tactic"], entry["mitre_tactic"])
    return RuleOut(**entry)
