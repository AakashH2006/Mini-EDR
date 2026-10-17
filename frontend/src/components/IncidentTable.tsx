import { Link } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import type { IncidentRow } from "../lib/api";
import {
  INCIDENT_STATUS_META,
  relativeTime,
  scoreTone,
  severityBadge,
  severityBar,
} from "../lib/alertDisplay";
import { formatTimestamp } from "../lib/eventDisplay";
import { TacticStrip } from "./AttackChain";

const COLUMNS = ["Score", "Case", "Tactics", "Alerts", "Last Activity", "Status"];

interface Props {
  items: IncidentRow[];
  loading: boolean;
  error: string | null;
}

/**
 * The case queue.
 *
 * Score leads rather than severity: it already folds severity
 * together with tactic breadth and alert volume, so it orders the
 * queue better than severity alone — a Critical that fired once sits
 * below a High that spans six stages, which is the right call.
 *
 * Rows are links, not click handlers: a case is a destination with its
 * own URL, so middle-click and "open in new tab" have to work.
 */
export default function IncidentTable({ items, loading, error }: Props) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-panel">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-text-muted">
              {COLUMNS.map((label) => (
                <th key={label} className="px-4 py-3 font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-4 py-10 text-center text-text-muted">
                  Loading investigations…
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-4 py-10 text-center text-critical">
                  {error}
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-4 py-14">
                  <div className="flex flex-col items-center gap-2 text-text-muted">
                    <ShieldCheck className="h-6 w-6 text-success" />
                    <span>No investigations match the current filters.</span>
                    <span className="text-xs">
                      Cases open automatically when related alerts share a process lineage.
                    </span>
                  </div>
                </td>
              </tr>
            ) : (
              items.map((incident) => {
                const statusMeta = INCIDENT_STATUS_META[incident.status];
                const StatusIcon = statusMeta.icon;
                return (
                  <tr
                    key={incident.id}
                    className="relative border-b border-border/60 transition-colors last:border-b-0 hover:bg-panel-hover"
                  >
                    <td className="relative w-32 px-4 py-3">
                      <span
                        className={`absolute left-0 top-0 h-full w-0.5 ${severityBar(incident.severity)}`}
                      />
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-lg font-semibold text-text-primary">
                          {incident.score}
                        </span>
                        <span
                          className={`rounded-full px-1.5 py-px text-[10px] font-medium ${severityBadge(incident.severity)}`}
                        >
                          {incident.severity}
                        </span>
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-bg">
                        <div
                          className={`h-full rounded-full ${scoreTone(incident.score)}`}
                          style={{ width: `${incident.score}%` }}
                        />
                      </div>
                    </td>

                    <td className="max-w-md px-4 py-3">
                      <Link
                        to={`/investigations/${incident.id}`}
                        className="block truncate font-medium text-text-primary hover:text-primary hover:underline"
                        title={incident.title}
                      >
                        <span className="font-mono text-xs text-text-muted">
                          #{incident.id}
                        </span>{" "}
                        {incident.title}
                      </Link>
                      <div className="truncate text-xs text-text-muted" title={incident.summary ?? ""}>
                        {incident.summary}
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <TacticStrip tactics={incident.tactics} />
                      <div className="mt-1 font-mono text-[11px] text-text-muted">
                        {incident.tactics.length} / 10 stages
                      </div>
                    </td>

                    <td className="px-4 py-3 font-mono text-text-secondary">
                      {incident.alert_count}
                    </td>

                    <td className="px-4 py-3">
                      <div className="font-mono text-xs text-text-secondary">
                        {formatTimestamp(incident.last_seen)}
                      </div>
                      <div className="text-[11px] text-text-muted">
                        {relativeTime(incident.last_seen)}
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${statusMeta.className}`}
                      >
                        <StatusIcon className="h-3 w-3" />
                        {statusMeta.label}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
