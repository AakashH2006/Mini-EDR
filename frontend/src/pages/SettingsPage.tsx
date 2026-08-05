import { useEffect, useState } from "react";
import { RefreshCw, Wifi, Database, Info, Cpu, Network, Usb, LogIn } from "lucide-react";
import { api, API_BASE, WS_URL } from "../lib/api";
import { useWs } from "../lib/ws";

const COLLECTORS = [
  { name: "Process Collector", icon: Cpu, desc: "WMI process creation/termination trace" },
  { name: "Network Collector", icon: Network, desc: "psutil connection polling (5s interval)" },
  { name: "USB Collector", icon: Usb, desc: "WMI volume change events" },
  { name: "Logon Collector", icon: LogIn, desc: "Windows Security Event Log (4624/4634)" },
];

export default function SettingsPage() {
  const { status: wsStatus } = useWs();
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
        <div className="space-y-3">
          {COLLECTORS.map((c) => (
            <div key={c.name} className="flex items-start gap-3">
              <c.icon className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
              <div>
                <div className="text-sm text-text-primary">{c.name}</div>
                <div className="text-xs text-text-muted">{c.desc}</div>
              </div>
            </div>
          ))}
        </div>
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
