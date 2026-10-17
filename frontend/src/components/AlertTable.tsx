import { ChevronUp, ChevronDown, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import type { AlertRow } from "../lib/api";
import type { AlertSort, SortOrder } from "../lib/useAlerts";
import {
  ALERT_STATUS_META,
  relativeTime,
  severityBadge,
  severityBar,
} from "../lib/alertDisplay";
import { formatTimestamp } from "../lib/eventDisplay";
import MitreBadge from "./MitreBadge";

interface Column {
  key: AlertSort | null;
  label: string;
}

const COLUMNS: Column[] = [
  { key: "severity", label: "Severity" },
  { key: null, label: "Alert" },
  { key: "rule_id", label: "Rule" },
  { key: null, label: "ATT&CK" },
  { key: "process_name", label: "Process" },
  { key: "timestamp", label: "Time" },
  { key: null, label: "Status" },
  { key: null, label: "Case" },
];

interface Props {
  items: AlertRow[];
  loading: boolean;
  error: string | null;
  sortBy: AlertSort;
  order: SortOrder;
  onSort: (col: AlertSort) => void;
  onSelect: (alert: AlertRow) => void;
}

export default function AlertTable({
  items,
  loading,
  error,
  sortBy,
  order,
  onSort,
  onSelect,
}: Props) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-panel">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-text-muted">
              {COLUMNS.map((col) => (
                <th key={col.label} className="px-4 py-3 font-medium">
                  {col.key ? (
                    <button
                      onClick={() => onSort(col.key!)}
                      className="flex items-center gap-1 transition-colors hover:text-text-primary"
                    >
                      {col.label}
                      {sortBy === col.key &&
                        (order === "asc" ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        ))}
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-4 py-10 text-center text-text-muted">
                  Loading alerts…
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
                  {/* An empty alert list is good news, not an error —
                      say so, rather than reusing the neutral "no rows"
                      empty state the event table uses. */}
                  <div className="flex flex-col items-center gap-2 text-text-muted">
                    <ShieldCheck className="h-6 w-6 text-success" />
                    <span>No alerts match the current filters.</span>
                    <span className="text-xs">
                      Nothing in the telemetry has tripped a detection rule.
                    </span>
                  </div>
                </td>
              </tr>
            ) : (
              items.map((alert) => {
                const statusMeta = ALERT_STATUS_META[alert.status];
                const StatusIcon = statusMeta.icon;
                return (
                  <tr
                    key={alert.id}
                    onClick={() => onSelect(alert)}
                    className="relative cursor-pointer border-b border-border/60 transition-colors last:border-b-0 hover:bg-panel-hover"
                  >
                    <td className="relative px-4 py-3">
                      <span
                        className={`absolute left-0 top-0 h-full w-0.5 ${severityBar(alert.severity)}`}
                      />
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${severityBadge(alert.severity)}`}
                        >
                          {alert.severity}
                        </span>
                        <span className="font-mono text-[11px] text-text-muted">
                          {alert.score}
                        </span>
                      </div>
                    </td>
                    <td className="max-w-md px-4 py-3">
                      <div className="truncate text-text-primary" title={alert.title}>
                        {alert.title}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs text-text-secondary">{alert.rule_id}</div>
                      <div className="truncate text-[11px] text-text-muted" title={alert.rule_name}>
                        {alert.rule_name}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <MitreBadge
                        tactic={alert.mitre_tactic}
                        techniqueId={alert.mitre_id}
                        technique={alert.mitre_technique}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-text-primary">
                        {alert.process_name ?? <span className="text-text-muted">—</span>}
                      </div>
                      {alert.pid !== null && (
                        <div className="font-mono text-[11px] text-text-muted">
                          pid {alert.pid}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs text-text-secondary">
                        {formatTimestamp(alert.timestamp)}
                      </div>
                      <div className="text-[11px] text-text-muted">
                        {relativeTime(alert.timestamp)}
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
                    <td className="px-4 py-3">
                      {alert.incident_id ? (
                        <Link
                          to={`/investigations/${alert.incident_id}`}
                          // The row itself opens the drawer; this link
                          // navigates. Without stopPropagation both fire.
                          onClick={(e) => e.stopPropagation()}
                          className="font-mono text-xs text-primary hover:underline"
                        >
                          #{alert.incident_id}
                        </Link>
                      ) : (
                        <span className="text-xs text-text-muted">—</span>
                      )}
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
