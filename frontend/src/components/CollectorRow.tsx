import { useState } from "react";
import { ChevronDown, ChevronRight, Play, Square, Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AgentStatus } from "../lib/api";
import { useAgentLogs } from "../lib/useAgents";

interface Props {
  icon: LucideIcon;
  desc: string;
  status: AgentStatus | undefined;
  pending: boolean;
  onStart: () => void;
  onStop: () => void;
}

export default function CollectorRow({ icon: Icon, desc, status, pending, onStart, onStop }: Props) {
  const [showLogs, setShowLogs] = useState(false);
  const { lines, loading: logsLoading } = useAgentLogs(status?.key ?? "", showLogs);

  const running = status?.running ?? false;
  const crashed = !running && status?.returncode != null && status.returncode !== 0 && status.returncode !== -15;

  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <Icon className="h-4 w-4 shrink-0 text-text-muted" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-primary">{status?.name ?? "—"}</span>
            <StatusBadge running={running} crashed={crashed} />
          </div>
          <div className="truncate text-xs text-text-muted">
            {desc}
            {running && status?.pid != null && <span className="font-mono"> · pid {status.pid}</span>}
          </div>
        </div>

        <button
          onClick={running ? onStop : onStart}
          disabled={pending}
          className={[
            "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
            running
              ? "border-critical/40 text-critical hover:border-critical"
              : "border-success/40 text-success hover:border-success",
          ].join(" ")}
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : running ? (
            <Square className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {running ? "Stop" : "Start"}
        </button>

        <button
          onClick={() => setShowLogs((v) => !v)}
          className="flex items-center gap-1 rounded-lg px-1.5 py-1.5 text-xs text-text-muted transition-colors hover:text-text-primary"
        >
          {showLogs ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      </div>

      {showLogs && (
        <div className="border-t border-border bg-bg px-3 py-2">
          {logsLoading && lines.length === 0 ? (
            <div className="py-2 text-xs text-text-muted">Loading logs…</div>
          ) : lines.length === 0 ? (
            <div className="py-2 text-xs text-text-muted">No output yet.</div>
          ) : (
            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-text-secondary">
              {lines.join("\n")}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ running, crashed }: { running: boolean; crashed: boolean }) {
  if (running) {
    return (
      <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">Running</span>
    );
  }
  if (crashed) {
    return (
      <span className="rounded-full bg-critical/10 px-2 py-0.5 text-[11px] font-medium text-critical">
        Crashed
      </span>
    );
  }
  return (
    <span className="rounded-full bg-text-muted/10 px-2 py-0.5 text-[11px] font-medium text-text-muted">
      Stopped
    </span>
  );
}
