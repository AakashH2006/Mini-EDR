import {
  AlertTriangle,
  Bug,
  CircleCheck,
  CircleSlash,
  Crosshair,
  DoorOpen,
  Eye,
  FileSearch,
  Flame,
  KeyRound,
  Network,
  Pin,
  Search,
  ShieldOff,
  Terminal,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import type { AlertStatus, IncidentStatus, Severity } from "./api";

/**
 * Display vocabulary for everything detection emits.
 *
 * The colour mapping is the one already established in Phase 1 — the
 * severity rail on event rows, status cards and the sidebar — extended
 * rather than replaced, so an alert's red means the same thing as an
 * event row's red. Severity never gets its own palette here.
 */

export const SEVERITY_ORDER: Severity[] = [
  "Critical",
  "High",
  "Medium",
  "Low",
  "Information",
];

export function severityRank(severity: string | null | undefined): number {
  const index = SEVERITY_ORDER.indexOf((severity ?? "Information") as Severity);
  return index === -1 ? SEVERITY_ORDER.length : index;
}

/** Text + background for a badge. */
export const SEVERITY_BADGE: Record<string, string> = {
  Critical: "bg-critical/10 text-critical",
  High: "bg-high/10 text-high",
  Medium: "bg-warning/10 text-warning",
  Low: "bg-success/10 text-success",
  Information: "bg-text-muted/10 text-text-secondary",
};

/** Solid fill, for the severity rail and chain connectors. */
export const SEVERITY_BAR: Record<string, string> = {
  Critical: "bg-critical",
  High: "bg-high",
  Medium: "bg-warning",
  Low: "bg-success",
  Information: "bg-text-muted",
};

export const SEVERITY_TEXT: Record<string, string> = {
  Critical: "text-critical",
  High: "text-high",
  Medium: "text-warning",
  Low: "text-success",
  Information: "text-text-muted",
};

export const SEVERITY_BORDER: Record<string, string> = {
  Critical: "border-critical/40",
  High: "border-high/40",
  Medium: "border-warning/40",
  Low: "border-success/40",
  Information: "border-border",
};

export function severityBadge(severity: string | null | undefined): string {
  return SEVERITY_BADGE[severity ?? "Information"] ?? SEVERITY_BADGE.Information;
}

export function severityBar(severity: string | null | undefined): string {
  return SEVERITY_BAR[severity ?? "Information"] ?? SEVERITY_BAR.Information;
}

export function severityText(severity: string | null | undefined): string {
  return SEVERITY_TEXT[severity ?? "Information"] ?? SEVERITY_TEXT.Information;
}

// --- Triage status ------------------------------------------------------

export const ALERT_STATUS_META: Record<
  AlertStatus,
  { label: string; className: string; icon: LucideIcon }
> = {
  new: { label: "New", className: "bg-primary/10 text-primary", icon: AlertTriangle },
  investigating: {
    label: "Investigating",
    className: "bg-warning/10 text-warning",
    icon: Eye,
  },
  resolved: { label: "Resolved", className: "bg-success/10 text-success", icon: CircleCheck },
  false_positive: {
    label: "False Positive",
    className: "bg-text-muted/10 text-text-muted",
    icon: CircleSlash,
  },
};

export const INCIDENT_STATUS_META: Record<
  IncidentStatus,
  { label: string; className: string; icon: LucideIcon }
> = {
  open: { label: "Open", className: "bg-critical/10 text-critical", icon: Flame },
  investigating: { label: "Investigating", className: "bg-warning/10 text-warning", icon: Eye },
  contained: { label: "Contained", className: "bg-secondary/10 text-secondary", icon: ShieldOff },
  closed: { label: "Closed", className: "bg-success/10 text-success", icon: CircleCheck },
  false_positive: {
    label: "False Positive",
    className: "bg-text-muted/10 text-text-muted",
    icon: CircleSlash,
  },
};

// --- MITRE ATT&CK -------------------------------------------------------

/**
 * Kill-chain order. Must match detection/mitre.py's TACTIC_ORDER — the
 * attack chain is laid out left to right by this, and a mismatch would
 * reorder the story. The backend also ships its own labels with each
 * incident (`tactic_labels`); these are the fallback for views that
 * don't fetch a full incident.
 */
export const TACTIC_ORDER: string[] = [
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
];

export const TACTIC_META: Record<string, { label: string; icon: LucideIcon }> = {
  "initial-access": { label: "Initial Access", icon: DoorOpen },
  execution: { label: "Execution", icon: Terminal },
  persistence: { label: "Persistence", icon: Pin },
  "privilege-escalation": { label: "Privilege Escalation", icon: TrendingUp },
  "defense-evasion": { label: "Defense Evasion", icon: ShieldOff },
  "credential-access": { label: "Credential Access", icon: KeyRound },
  discovery: { label: "Discovery", icon: Search },
  "lateral-movement": { label: "Lateral Movement", icon: Network },
  "command-and-control": { label: "Command and Control", icon: Crosshair },
  impact: { label: "Impact", icon: Bug },
};

export function tacticMeta(tactic: string | null | undefined) {
  if (!tactic) return { label: "Uncategorised", icon: FileSearch };
  return TACTIC_META[tactic] ?? { label: tactic, icon: FileSearch };
}

export function tacticRank(tactic: string | null | undefined): number {
  const index = TACTIC_ORDER.indexOf(tactic ?? "");
  return index === -1 ? TACTIC_ORDER.length : index;
}

// --- Formatting ---------------------------------------------------------

export function relativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Score bar colour. Bands match detection/mitre.py's severity_for_score. */
export function scoreTone(score: number): string {
  if (score >= 85) return "bg-critical";
  if (score >= 65) return "bg-high";
  if (score >= 40) return "bg-warning";
  return "bg-success";
}

/** Parses an alert's `evidence` JSON string defensively — a malformed
 *  blob should degrade to showing the raw text, not blank the drawer. */
export function parseEvidence(evidence: string | null): Record<string, unknown> {
  if (!evidence) return {};
  try {
    const parsed = JSON.parse(evidence);
    return parsed && typeof parsed === "object" ? parsed : { value: parsed };
  } catch {
    return { raw: evidence };
  }
}

/** Turns an evidence key into a readable label: "remote_addr" → "Remote Addr". */
export function humaniseKey(key: string): string {
  return key
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
