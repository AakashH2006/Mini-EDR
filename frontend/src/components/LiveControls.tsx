import { Pause, Play, RefreshCw } from "lucide-react";
import { useWs } from "../lib/ws";

export default function LiveControls() {
  const { status, paused, setPaused, reconnect } = useWs();

  return (
    <div className="flex items-center gap-2">
      <LiveBadge status={status} />
      <button
        onClick={() => setPaused(!paused)}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-panel px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
      >
        {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
        {paused ? "Resume Live Feed" : "Pause Live Feed"}
      </button>
      {status === "closed" && (
        <button
          onClick={reconnect}
          className="flex items-center gap-1.5 rounded-lg border border-critical/40 bg-panel px-3 py-1.5 text-xs font-medium text-critical transition-colors hover:border-critical"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Reconnect
        </button>
      )}
    </div>
  );
}

function LiveBadge({ status }: { status: "connecting" | "open" | "closed" }) {
  const config = {
    open: { dot: "bg-success", label: "Live", text: "text-success" },
    connecting: { dot: "bg-warning", label: "Connecting", text: "text-warning" },
    closed: { dot: "bg-critical", label: "Disconnected", text: "text-critical" },
  }[status];

  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-border bg-panel px-3 py-1.5 text-xs font-medium">
      <span className={`h-2 w-2 rounded-full ${config.dot} ${status === "open" ? "animate-pulse" : ""}`} />
      <span className={config.text}>{config.label}</span>
    </div>
  );
}
