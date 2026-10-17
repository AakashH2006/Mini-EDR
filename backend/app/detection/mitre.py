"""
The slice of MITRE ATT&CK this build uses, plus the severity model
shared by rules, alerts and incidents.

Only the Enterprise tactics our telemetry can actually witness are
listed. We collect process, network, USB and logon events — no file,
registry or API-call telemetry — so tactics like Collection or
Exfiltration would never be populated and are left out rather than
shown as permanently-empty columns in the attack chain.

TACTIC_ORDER is the kill-chain ordering used to lay out an attack
chain left to right. It is the conventional ATT&CK column order, not
a claim that an intrusion must proceed in exactly this sequence —
alerts inside a tactic stay in timestamp order, and the chain view
shows the real times alongside the ordering.
"""

# Ordered earliest-stage to latest-stage.
TACTIC_ORDER: list[str] = [
    "initial-access",
    "execution",
    "persistence",
    "privilege-escalation",
    "defense-evasion",
    "credential-access",
    "discovery",
    "lateral-movement",
    "command-and-control",
    "impact",
]

TACTIC_LABELS: dict[str, str] = {
    "initial-access": "Initial Access",
    "execution": "Execution",
    "persistence": "Persistence",
    "privilege-escalation": "Privilege Escalation",
    "defense-evasion": "Defense Evasion",
    "credential-access": "Credential Access",
    "discovery": "Discovery",
    "lateral-movement": "Lateral Movement",
    "command-and-control": "Command and Control",
    "impact": "Impact",
}


def tactic_rank(tactic: str | None) -> int:
    """Sort key for chain ordering. Unknown tactics sort last rather
    than raising — a rule with a typo'd tactic should still render."""
    if tactic in TACTIC_ORDER:
        return TACTIC_ORDER.index(tactic)
    return len(TACTIC_ORDER)


# --- Severity -----------------------------------------------------------

SEVERITIES = ["Information", "Low", "Medium", "High", "Critical"]

SEVERITY_RANK: dict[str, int] = {s: i for i, s in enumerate(SEVERITIES)}


def severity_rank(severity: str | None) -> int:
    return SEVERITY_RANK.get((severity or "Information").title(), 0)


def max_severity(*severities: str | None) -> str:
    """Highest of the given severities. Used when an event matches more
    than one rule (its row keeps the worst verdict) and when rolling
    member alerts up into an incident."""
    best = "Information"
    for s in severities:
        if severity_rank(s) > severity_rank(best):
            best = (s or "Information").title()
    return best


def severity_for_score(score: int) -> str:
    """Maps a 0-100 risk score back onto a severity band.

    Used for incidents, whose score is computed from their member
    alerts rather than set by a rule. The bands match where the rule
    pack puts its own base scores, so a single-alert incident lands on
    the same severity as the alert that created it.
    """
    if score >= 85:
        return "Critical"
    if score >= 65:
        return "High"
    if score >= 40:
        return "Medium"
    if score > 0:
        return "Low"
    return "Information"
