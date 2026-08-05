import { Inbox } from "lucide-react";
import type { ConnectionRow } from "../lib/api";
import { formatTimestamp } from "../lib/eventDisplay";

interface Props {
  items: ConnectionRow[];
  loading: boolean;
  error: string | null;
}

export default function ConnectionTable({ items, loading, error }: Props) {
  const columns = ["Time", "Process", "PID", "Local Address", "Remote Address", "TCP Status", "Active"];

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-panel">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-text-muted">
              {columns.map((c) => (
                <th key={c} className="px-4 py-3 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-text-muted">
                  Loading connections…
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-critical">
                  {error}
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-14">
                  <div className="flex flex-col items-center gap-2 text-text-muted">
                    <Inbox className="h-6 w-6" />
                    <span>No connections match the current filters.</span>
                  </div>
                </td>
              </tr>
            ) : (
              items.map((c) => (
                <tr
                  key={c.id}
                  className="relative border-b border-border/60 transition-colors last:border-b-0 hover:bg-panel-hover"
                >
                  <td className="relative px-4 py-3">
                    <span
                      className={`absolute left-0 top-0 h-full w-0.5 ${c.active ? "bg-secondary" : "bg-text-muted"}`}
                    />
                    <span className="font-mono text-xs text-text-secondary">{formatTimestamp(c.timestamp)}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-text-primary">
                    {c.process_name ?? <span className="text-text-muted">—</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-text-secondary">
                    {c.pid ?? <span className="text-text-muted">—</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-text-secondary">
                    {c.local_addr ? `${c.local_addr}:${c.local_port}` : <span className="text-text-muted">—</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-text-secondary">
                    {c.remote_addr ? `${c.remote_addr}:${c.remote_port}` : <span className="text-text-muted">—</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-text-secondary">
                    {c.status ?? <span className="text-text-muted">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={[
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        c.active ? "bg-secondary/10 text-secondary" : "bg-text-muted/10 text-text-muted",
                      ].join(" ")}
                    >
                      {c.active ? "Active" : "Idle"}
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
