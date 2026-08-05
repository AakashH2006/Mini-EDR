import { ChevronUp, ChevronDown, Inbox } from "lucide-react";
import type { ProcessRow } from "../lib/api";
import type { ProcessSort, SortOrder } from "../lib/useProcesses";
import { formatTimestamp } from "../lib/eventDisplay";

interface Column {
  key: ProcessSort | null;
  label: string;
}

const COLUMNS: Column[] = [
  { key: "process_name", label: "Process" },
  { key: "pid", label: "PID" },
  { key: null, label: "Parent Process" },
  { key: null, label: "User" },
  { key: "first_seen", label: "First Seen" },
  { key: "last_seen", label: "Last Seen" },
  { key: null, label: "Status" },
];

interface Props {
  items: ProcessRow[];
  loading: boolean;
  error: string | null;
  sortBy: ProcessSort;
  order: SortOrder;
  onSort: (col: ProcessSort) => void;
}

export default function ProcessTable({ items, loading, error, sortBy, order, onSort }: Props) {
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
                  Loading processes…
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
                    <span>No processes match the current filters.</span>
                  </div>
                </td>
              </tr>
            ) : (
              items.map((p) => (
                <tr
                  key={p.id}
                  className="relative border-b border-border/60 transition-colors last:border-b-0 hover:bg-panel-hover"
                >
                  <td className="relative px-4 py-3">
                    <span
                      className={`absolute left-0 top-0 h-full w-0.5 ${
                        p.status === "running" ? "bg-success" : "bg-text-muted"
                      }`}
                    />
                    <span className="font-mono text-text-primary">
                      {p.process_name ?? <span className="text-text-muted">—</span>}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-text-secondary">
                    {p.pid ?? <span className="text-text-muted">—</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-text-secondary">
                    {p.parent_process ?? <span className="text-text-muted">—</span>}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {p.user ?? <span className="text-text-muted">—</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-text-secondary">
                    {formatTimestamp(p.first_seen)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-text-secondary">
                    {formatTimestamp(p.last_seen)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={[
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        p.status === "running"
                          ? "bg-success/10 text-success"
                          : "bg-text-muted/10 text-text-muted",
                      ].join(" ")}
                    >
                      {p.status === "running" ? "Running" : "Terminated"}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
