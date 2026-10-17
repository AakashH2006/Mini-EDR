import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, GitBranch, X } from "lucide-react";
import { api, type AlertDetail, type AlertRow, type AlertStatus } from "../lib/api";
import {
  ALERT_STATUS_META,
  humaniseKey,
  parseEvidence,
  relativeTime,
  scoreTone,
  severityBadge,
} from "../lib/alertDisplay";
import { eventTypeMeta, formatTimestamp } from "../lib/eventDisplay";
import MitreBadge from "./MitreBadge";

const TRANSITION_MS = 250;

const STATUS_ACTIONS: AlertStatus[] = ["new", "investigating", "resolved", "false_positive"];

interface Props {
  alert: AlertRow | null;
  onClose: () => void;
  onStatusChange: (id: number, status: AlertStatus) => void;
  onShowTree: (eventId: number, label: string) => void;
}

/**
 * Full context for one alert: why it fired, what it fired on, and what
 * to do about it.
 *
 * The list row already carries severity, rule and time, so the drawer
 * leads with the two things it cannot: the rule's explanation of what
 * this pattern means, and the extracted evidence showing which values
 * actually matched. Everything below that is the raw events, for an
 * analyst who wants to check the interpretation against the source.
 *
 * Mirrors EventDetailsDrawer's slide-out mechanics — including keeping
 * the outgoing alert rendered through the exit animation — so the two
 * drawers behave identically.
 */
export default function AlertDetailsDrawer({
  alert,
  onClose,
  onStatusChange,
  onShowTree,
}: Props) {
  const [rendered, setRendered] = useState<AlertRow | null>(null);
  const [visible, setVisible] = useState(false);
  const [detail, setDetail] = useState<AlertDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    if (alert) {
      setRendered(alert);
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    const timer = setTimeout(() => {
      setRendered(null);
      setDetail(null);
    }, TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [alert]);

  // The list response doesn't carry the triggering events — those are
  // a join, fetched only when a drawer actually opens.
  useEffect(() => {
    if (!alert) return;
    let cancelled = false;
    setLoadingDetail(true);
    api
      .getAlert(alert.id)
      .then((full) => {
        if (!cancelled) setDetail(full);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [alert]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && alert && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [alert, onClose]);

  if (!rendered) return null;

  const evidence = parseEvidence(rendered.evidence);
  const triggerEvent = detail?.events.find((e) => e.role === "trigger");
  const supporting = detail?.events.filter((e) => e.role === "supporting") ?? [];
  const currentStatus = detail?.status ?? rendered.status;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className={`absolute inset-0 bg-black/50 transition-opacity duration-250 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />
      <div
        className={`relative flex h-full w-full max-w-xl flex-col border-l border-border bg-panel shadow-2xl transition-transform duration-250 ease-out ${
          visible ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${severityBadge(rendered.severity)}`}
              >
                {rendered.severity}
              </span>
              <span className="font-mono text-xs text-text-muted">{rendered.rule_id}</span>
              <MitreBadge
                tactic={rendered.mitre_tactic}
                techniqueId={rendered.mitre_id}
                technique={rendered.mitre_technique}
              />
            </div>
            <h2 className="text-sm font-semibold text-text-primary">{rendered.title}</h2>
            <div className="mt-0.5 font-mono text-xs text-text-muted">
              {formatTimestamp(rendered.timestamp)} · {relativeTime(rendered.timestamp)}
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-text-muted transition-colors hover:bg-panel-hover hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* Risk score */}
          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="uppercase tracking-wide text-text-muted">Risk Score</span>
              <span className="font-mono text-text-primary">{rendered.score} / 100</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-bg">
              <div
                className={`h-full rounded-full ${scoreTone(rendered.score)}`}
                style={{ width: `${rendered.score}%` }}
              />
            </div>
          </div>

          {/* Why this fired */}
          <Section title="What this means">
            <p className="text-sm leading-relaxed text-text-secondary">
              {rendered.description ?? "No description recorded for this rule."}
            </p>
            <div className="mt-2 text-xs text-text-muted">
              Rule <span className="font-mono text-text-secondary">{rendered.rule_id}</span>{" "}
              — {rendered.rule_name}
              {rendered.mitre_technique && (
                <>
                  {" · "}
                  {rendered.mitre_id} {rendered.mitre_technique}
                </>
              )}
            </div>
          </Section>

          {/* Evidence */}
          <Section title="Evidence">
            {Object.keys(evidence).length === 0 ? (
              <p className="text-sm text-text-muted">No structured evidence recorded.</p>
            ) : (
              <dl className="space-y-2">
                {Object.entries(evidence).map(([key, value]) => (
                  <div key={key} className="grid grid-cols-3 gap-2 text-sm">
                    <dt className="text-text-muted">{humaniseKey(key)}</dt>
                    <dd className="col-span-2 break-all font-mono text-xs text-text-primary">
                      {formatEvidenceValue(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </Section>

          {/* Entity */}
          <Section title="Observed on">
            <dl className="space-y-2">
              <Field label="Process" value={rendered.process_name} mono />
              <Field label="PID" value={rendered.pid} mono />
              <Field label="User" value={rendered.user} />
              <Field label="Detected" value={relativeTime(rendered.created_at)} />
            </dl>
            {triggerEvent && (
              <button
                onClick={() =>
                  onShowTree(
                    triggerEvent.id,
                    rendered.process_name ?? `pid ${rendered.pid ?? "?"}`
                  )
                }
                className="mt-3 flex items-center gap-1.5 rounded-lg border border-border bg-panel-hover px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
              >
                <GitBranch className="h-3.5 w-3.5" />
                View process tree
              </button>
            )}
          </Section>

          {/* Linked case */}
          {rendered.incident_id && (
            <Section title="Investigation">
              <Link
                to={`/investigations/${rendered.incident_id}`}
                onClick={onClose}
                className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open case #{rendered.incident_id}
              </Link>
              <p className="mt-2 text-xs text-text-muted">
                This alert was correlated into a case with other activity sharing its
                process lineage.
              </p>
            </Section>
          )}

          {/* Triggering + supporting events */}
          <Section
            title={
              supporting.length > 0
                ? `Events (1 trigger, ${supporting.length} supporting)`
                : "Triggering event"
            }
          >
            {loadingDetail ? (
              <p className="text-sm text-text-muted">Loading events…</p>
            ) : !detail || detail.events.length === 0 ? (
              <p className="text-sm text-text-muted">
                The triggering event is no longer available — it may have aged out of the
                retention window.
              </p>
            ) : (
              <div className="space-y-1.5">
                {detail.events.slice(0, 25).map((event) => {
                  const meta = eventTypeMeta(event.event_type);
                  const Icon = meta.icon;
                  return (
                    <div
                      key={`${event.role}-${event.id}`}
                      className="flex items-start gap-2 rounded-lg border border-border bg-bg px-3 py-2 text-xs"
                    >
                      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-text-primary">{meta.label}</span>
                          {event.role === "trigger" && (
                            <span className="rounded bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">
                              trigger
                            </span>
                          )}
                        </div>
                        <div className="font-mono text-[11px] text-text-muted">
                          {formatTimestamp(event.timestamp)}
                          {event.process_name && ` · ${event.process_name}`}
                          {event.pid !== null && ` (${event.pid})`}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {detail.events.length > 25 && (
                  <p className="pt-1 text-[11px] text-text-muted">
                    Showing the first 25 of {detail.events.length} events.
                  </p>
                )}
              </div>
            )}
          </Section>
        </div>

        {/* Triage footer — pinned, because it's the action the drawer
            exists to enable and shouldn't require scrolling to reach. */}
        <div className="border-t border-border px-5 py-3">
          <div className="mb-2 text-xs uppercase tracking-wide text-text-muted">Triage</div>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_ACTIONS.map((status) => {
              const meta = ALERT_STATUS_META[status];
              const Icon = meta.icon;
              const active = currentStatus === status;
              return (
                <button
                  key={status}
                  onClick={() => onStatusChange(rendered.id, status)}
                  disabled={active}
                  className={[
                    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? `${meta.className} cursor-default`
                      : "border border-border bg-panel-hover text-text-secondary hover:border-border-strong hover:text-text-primary",
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
    </div>
  );
}

function formatEvidenceValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs uppercase tracking-wide text-text-muted">{title}</div>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | number | null;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 text-sm">
      <dt className="text-text-muted">{label}</dt>
      <dd className={`col-span-2 break-all text-text-primary ${mono ? "font-mono text-xs" : ""}`}>
        {value ?? <span className="text-text-muted">—</span>}
      </dd>
    </div>
  );
}
