import { useEffect, useState } from "react";
import { RefreshCw, Wifi, Database, Info, Cpu, Network, Usb, LogIn } from "lucide-react";
import { api, API_BASE, WS_URL } from "../lib/api";
import { useWs } from "../lib/ws";
import { useAgents } from "../lib/useAgents";
import CollectorRow from "../components/CollectorRow";

const COLLECTOR_META = [
  { key: "process", icon: Cpu, desc: "WMI process creation/termination trace" },
  { key: "network", icon: Network, desc: "psutil connection polling (5s interval)" },
  { key: "usb", icon: Usb, desc: "WMI volume change events" },
  { key: "logon", icon: LogIn, desc: "Windows Security Event Log (4624/4634)" },
];

export default function SettingsPage() {
  const { status: wsStatus } = useWs();
  const { statuses, pending, error: agentError, start, stop } = useAgents();
  const [apiStatus, setApiStatus] = useState<"checking" | "ok" | "error">("checking");
  const [apiVersion, setApiVersion] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  const checkApi = async () => {
    setApiStatus("checking");
    try {
      const res = await api.getRoot();
      setApiVersion(res.version);
      setApiStatus("ok");
    } catch {
      setApiStatus("error");
    } finally {
      setCheckedAt(new Date());
    }
  };

  useEffect(() => {
    checkApi();
  }, []);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Settings</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Connection info and system status. Phase 1 has no configurable detection rules yet.
        </p>
      </div>

      <Section icon={Database} title="Backend Connection">
        <Row label="API Base URL" value={API_BASE} mono />
        <Row
          label="Status"
          value={
            apiStatus === "checking" ? "Checking…" : apiStatus === "ok" ? "Connected" : "Unreachable"
          }
          tone={apiStatus === "ok" ? "success" : apiStatus === "error" ? "critical" : "warning"}
        />
        {apiVersion && <Row label="API Version" value={apiVersion} mono />}
        {checkedAt && <Row label="Last Checked" value={checkedAt.toLocaleTimeString()} mono />}
        <button
          onClick={checkApi}
          className="mt-1 flex items-center gap-1.5 rounded-lg border border-border bg-panel-hover px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Test Connection
        </button>
      </Section>

      <Section icon={Wifi} title="Live Feed (WebSocket)">
        <Row label="WS URL" value={WS_URL} mono />
        <Row
          label="Status"
          value={wsStatus === "open" ? "Live" : wsStatus === "connecting" ? "Connecting" : "Disconnected"}
          tone={wsStatus === "open" ? "success" : wsStatus === "connecting" ? "warning" : "critical"}
        />
      </Section>

      <Section icon={Database} title="Data Retention">
        <Row label="Retention Period" value="30 days" mono />
        <Row label="Indexed Columns" value="timestamp, process_name, event_type" mono />
        <p className="pt-1 text-xs text-text-muted">
          Events older than the retention period are purged automatically on API startup.
        </p>
      </Section>

      <Section icon={Cpu} title="Collectors">
        {agentError && (
          <div className="mb-2 rounded-lg border border-critical/30 bg-critical/5 px-3 py-2 text-xs text-critical">
            {agentError}
          </div>
        )}
        <div className="space-y-2">
          {COLLECTOR_META.map((meta) => (
            <CollectorRow
              key={meta.key}
              icon={meta.icon}
              desc={meta.desc}
              status={statuses.find((s) => s.key === meta.key)}
              pending={pending.has(meta.key)}
              onStart={() => start(meta.key)}
              onStop={() => stop(meta.key)}
            />
          ))}
        </div>
        <p className="pt-1 text-xs text-text-muted">
          Process, USB, and Logon collectors need the backend running as Administrator on Windows.
          Expand a collector to see its last 20 log lines — helpful if it shows "Crashed."
        </p>
      </Section>

      <Section icon={Info} title="About">
        <p className="text-sm text-text-secondary">
          Mini EDR — Phase 1: endpoint telemetry only. Threat detection, MITRE ATT&CK mapping, and
          automated response actions are not part of this build.
        </p>
      </Section>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-panel px-5 py-4">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-text-secondary" />
        <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "success" | "warning" | "critical";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "critical"
        ? "text-critical"
        : tone === "warning"
          ? "text-warning"
          : "text-text-primary";
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-text-muted">{label}</span>
      <span className={`${mono ? "font-mono text-xs" : ""} ${toneClass}`}>{value}</span>
    </div>
  );
}
