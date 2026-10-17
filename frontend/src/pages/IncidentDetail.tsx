import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, GitBranch, Info, Route, User } from "lucide-react";
import AttackChain from "../components/AttackChain";
import CaseNotes from "../components/CaseNotes";
import ProcessTree from "../components/ProcessTree";
import AlertDetailsDrawer from "../components/AlertDetailsDrawer";
import { api, type AlertRow, type AlertStatus, type IncidentStatus } from "../lib/api";
import {
  INCIDENT_STATUS_META,
  relativeTime,
  scoreTone,
  severityBadge,
  severityBar,
  tacticMeta,
} from "../lib/alertDisplay";
import { formatTimestamp } from "../lib/eventDisplay";
import { useIncident } from "../lib/useIncidents";

const WORKFLOW: IncidentStatus[] = [
  "open",
  "investigating",
  "contained",
  "closed",
  "false_positive",
];

/**
 * One case, end to end: what it is, how it progressed, what ran, and
 * what the analyst did about it.
 *
 * Ordered the way a case is actually worked — verdict and score first,
 * then the attack chain (the summary of what happened), then the
 * process trees (the evidence underneath it), then the notes (the
 * record of what was decided). The workflow buttons sit in the header
 * because changing status is the action most often taken and should
 * never require scrolling.
 */
export default function IncidentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const incidentId = id ? Number(id) : null;

  const { incident, tree, loading, treeLoading, error, busy, setStatus, addNote } =
    useIncident(Number.isFinite(incidentId) ? incidentId : null);

  const [selectedAlert, setSelectedAlert] = useState<AlertRow | null>(null);

  // The chain gives us an alert id; the drawer wants the full row.
  const openAlert = async (alertId: number) => {
    try {
      setSelectedAlert(await api.getAlert(alertId));
    } catch {
      /* the drawer simply doesn't open if the alert can't be fetched */
    }
  };

  const changeAlertStatus = async (alertId: number, status: AlertStatus) => {
    await api.setAlertStatus(alertId, status);
    setSelectedAlert((prev) => (prev && prev.id === alertId ? { ...prev, status } : prev));
  };

  useEffect(() => {
    if (id && !Number.isFinite(Number(id))) navigate("/investigations", { replace: true });
  }, [id, navigate]);

  if (loading && !incident) {
    return <p className="text-sm text-text-muted">Loading case…</p>;
  }

  if (error || !incident) {
    return (
      <div className="space-y-4">
        <BackLink />
        <div className="rounded-xl border border-critical/40 bg-panel px-5 py-4 text-sm text-critical">
          {error ?? "Case not found."}
        </div>
      </div>
    );
  }

  const statusMeta = INCIDENT_STATUS_META[incident.status];
  const StatusIcon = statusMeta.icon;

  return (
    <div className="space-y-6">
      <BackLink />

      {/* Header */}
      <div className="relative overflow-hidden rounded-xl border border-border bg-panel px-5 py-4">
        <span className={`absolute left-0 top-0 h-full w-1 ${severityBar(incident.severity)}`} />

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-text-muted">#{incident.id}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${severityBadge(incident.severity)}`}
              >
                {incident.severity}
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${statusMeta.className}`}
              >
                <StatusIcon className="h-3 w-3" />
                {statusMeta.label}
              </span>
            </div>

            <h1 className="text-xl font-semibold text-text-primary">{incident.title}</h1>
            <p className="mt-1 text-sm text-text-secondary">{incident.summary}</p>

            <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-text-muted">
              <Fact label="First seen" value={formatTimestamp(incident.first_seen)} />
              <Fact
                label="Last activity"
                value={`${formatTimestamp(incident.last_seen)} (${relativeTime(incident.last_seen)})`}
              />
              <Fact label="Alerts" value={String(incident.alert_count)} />
              {incident.root_process && (
                <Fact
                  label="Origin"
                  value={`${incident.root_process}${incident.root_pid ? ` (pid ${incident.root_pid})` : ""}`}
                />
              )}
              {incident.user && <Fact label="User" value={incident.user} />}
            </dl>
          </div>

          {/* Score */}
          <div className="w-full shrink-0 lg:w-56">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="uppercase tracking-wide text-text-muted">Risk Score</span>
              <span className="font-mono text-lg font-semibold text-text-primary">
                {incident.score}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-bg">
              <div
                className={`h-full rounded-full ${scoreTone(incident.score)}`}
                style={{ width: `${incident.score}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-text-muted">
              Worst alert, raised by how many ATT&CK stages the case spans.
            </p>
          </div>
        </div>

        {/* Workflow */}
        <div className="mt-4 border-t border-border pt-3">
          <div className="mb-2 text-xs uppercase tracking-wide text-text-muted">Case status</div>
          <div className="flex flex-wrap gap-1.5">
            {WORKFLOW.map((status) => {
              const meta = INCIDENT_STATUS_META[status];
              const Icon = meta.icon;
              const active = incident.status === status;
              return (
                <button
                  key={status}
                  onClick={() => setStatus(status)}
                  disabled={active || busy}
                  className={[
                    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? `${meta.className} cursor-default`
                      : "border border-border bg-panel-hover text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-50",
                  ].join(" ")}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {meta.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Attack chain */}
      <Panel
        icon={Route}
        title="Attack Chain"
        subtitle="Alerts grouped by ATT&CK tactic, in kill-chain order. Dimmed stages were never reached."
      >
        <AttackChain chain={incident.chain} onSelectAlert={openAlert} />

        {incident.tactics.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
            {incident.tactics.map((tactic) => {
              const meta = tacticMeta(tactic);
              const Icon = meta.icon;
              return (
                <span
                  key={tactic}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-0.5 text-xs text-text-secondary"
                >
                  <Icon className="h-3 w-3 text-text-muted" />
                  {incident.tactic_labels[tactic] ?? meta.label}
                </span>
              );
            })}
          </div>
        )}
      </Panel>

      {/* Process trees */}
      <Panel
        icon={GitBranch}
        title="Process Lineage"
        subtitle="Every process involved, rooted at the earliest ancestor still on record. Flagged nodes raised alerts."
      >
        {treeLoading ? (
          <p className="text-sm text-text-muted">Building process trees…</p>
        ) : !tree || tree.roots.length === 0 ? (
          <div className="flex items-start gap-2 text-sm text-text-muted">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              No process lineage for this case — its alerts came from events with no process
              attached, such as authentication or removable-media activity.
            </span>
          </div>
        ) : (
          <div className="space-y-4">
            {tree.roots.map((root) => (
              <div key={root.event_id} className="rounded-lg border border-border bg-bg p-2">
                <ProcessTree root={root} highlightPids={tree.alert_pids} />
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Case notes */}
      <Panel
        icon={User}
        title="Investigation Notes"
        subtitle="Analyst notes and status changes, oldest first."
      >
        <CaseNotes notes={incident.notes} busy={busy} onAddNote={addNote} />
      </Panel>

      <AlertDetailsDrawer
        alert={selectedAlert}
        onClose={() => setSelectedAlert(null)}
        onStatusChange={changeAlertStatus}
        onShowTree={() => {
          /* the full lineage is already on this page — no drawer needed */
        }}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/investigations"
      className="inline-flex items-center gap-1.5 text-xs text-text-secondary transition-colors hover:text-text-primary"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      All investigations
    </Link>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <dt>{label}:</dt>
      <dd className="font-mono text-text-secondary">{value}</dd>
    </div>
  );
}

function Panel({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-panel px-5 py-4">
      <div className="mb-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-text-secondary" />
          <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
        </div>
        {subtitle && <p className="mt-1 text-xs text-text-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
