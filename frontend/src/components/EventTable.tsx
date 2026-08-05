import { ChevronUp, ChevronDown, Inbox } from "lucide-react";
import type { EventRow } from "../lib/api";
import type { SortColumn, SortOrder } from "../lib/useEvents";
import { eventTypeMeta, severityTone, formatTimestamp } from "../lib/eventDisplay";

const TONE_BAR: Record<string, string> = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  critical: "bg-critical",
};
const TONE_TEXT: Record<string, string> = {
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  critical: "text-critical",
};

interface Column {
  key: SortColumn | null;
  label: string;
  className?: string;
}

const COLUMNS: Column[] = [
  { key: "timestamp", label: "Time" },
  { key: "event_type", label: "Event Type" },
  { key: "process_name", label: "Process" },
  { key: "pid", label: "PID" },
  { key: null, label: "Parent Process" },
  { key: null, label: "User" },
  { key: "severity", label: "Severity" },
];

interface Props {
  items: EventRow[];
  loading: boolean;
  error: string | null;
  sortBy: SortColumn;
  order: SortOrder;
  onSort: (col: SortColumn) => void;
  onSelect: (event: EventRow) => void;
}

export default function EventTable({ items, loading, error, sortBy, order, onSort, onSelect }: Props) {
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
                  Loading events…
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
                    <Inbox className="h-6 w-6" />
                    <span>No events match the current filters.</span>
                  </div>
                </td>
              </tr>
            ) : (
              items.map((event) => {
                const meta = eventTypeMeta(event.event_type);
                const tone = severityTone(event.severity);
                const Icon = meta.icon;
                return (
                  <tr
                    key={event.id}
                    onClick={() => onSelect(event)}
                    className="relative cursor-pointer border-b border-border/60 transition-colors last:border-b-0 hover:bg-panel-hover"
                  >
                    <td className="relative px-4 py-3">
                      <span className={`absolute left-0 top-0 h-full w-0.5 ${TONE_BAR[tone]}`} />
                      <span className="font-mono text-xs text-text-secondary">
                        {formatTimestamp(event.timestamp)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2 text-text-primary">
                        <Icon className="h-3.5 w-3.5 text-text-muted" />
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-text-primary">
                      {event.process_name ?? <span className="text-text-muted">—</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-text-secondary">
                      {event.pid ?? <span className="text-text-muted">—</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-text-secondary">
                      {event.parent_process ?? <span className="text-text-muted">—</span>}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {event.user ?? <span className="text-text-muted">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${TONE_TEXT[tone]}`}>{event.severity}</span>
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
