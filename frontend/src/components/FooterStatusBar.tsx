import { useEffect, useState } from "react";
import { api, type SystemStatus } from "../lib/api";
import { useWs } from "../lib/ws";

const POLL_MS = 5000;

export default function FooterStatusBar() {
  const { status: wsStatus } = useWs();
  const [sys, setSys] = useState<SystemStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await api.getSystemStatus();
        if (!cancelled) setSys(res);
      } catch {
        /* footer degrades to dashes on failure, not worth surfacing an error banner for */
      }
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const wsLabel = wsStatus === "open" ? "Live" : wsStatus === "connecting" ? "Connecting" : "Disconnected";
  const wsColor = wsStatus === "open" ? "text-success" : wsStatus === "connecting" ? "text-warning" : "text-critical";
  const sqliteColor = sys?.sqlite_status === "Connected" ? "text-success" : "text-critical";

  return (
    <div className="flex shrink-0 items-center gap-5 overflow-x-auto border-t border-border bg-panel px-5 py-1.5 font-mono text-[11px] text-text-secondary">
      <Item label="Agent" value={`v${sys?.agent_version ?? "—"}`} />
      <Sep />
      <Item label="SQLite" value={sys?.sqlite_status ?? "—"} valueClass={sqliteColor} />
      <Sep />
      <Item label="WebSocket" value={wsLabel} valueClass={wsColor} />
      <Sep />
      <Item label="Total Events" value={sys ? sys.total_events.toLocaleString() : "—"} />
      <Sep />
      <Item label="Agent CPU" value={sys ? `${sys.agent_cpu_percent}%` : "—"} />
      <Sep />
      <Item label="Agent Mem" value={sys ? `${sys.agent_memory_mb} MB` : "—"} />
    </div>
  );
}

function Item({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-text-muted">{label}:</span>{" "}
      <span className={valueClass ?? "text-text-primary"}>{value}</span>
    </span>
  );
}

function Sep() {
  return <span className="h-3 w-px shrink-0 bg-border" />;
}
