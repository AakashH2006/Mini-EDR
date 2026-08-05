import { ShieldCheck, ShieldAlert, ListChecks, Cpu, Network, Usb } from "lucide-react";
import StatusCard from "./StatusCard";
import { useLiveStats } from "../lib/useLiveStats";

export default function StatusCards() {
  const stats = useLiveStats();

  if (stats.error) {
    return (
      <div className="rounded-xl border border-critical/40 bg-panel px-5 py-4 text-sm text-critical">
        Couldn't reach the API ({stats.error}). Is the backend running on :8000?
      </div>
    );
  }

  const value = (v: number) => (stats.loading ? "—" : v);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <StatusCard
        label="Agent Status"
        value={stats.loading ? "—" : stats.agent_status === "online" ? "Online" : "Offline"}
        icon={stats.agent_status === "online" ? ShieldCheck : ShieldAlert}
        tone={stats.agent_status === "online" ? "success" : "critical"}
        pulse={stats.agent_status === "online"}
        sublabel={stats.last_event_at ? `Last event ${relativeTime(stats.last_event_at)}` : "No events yet"}
      />
      <StatusCard
        label="Events Today"
        value={value(stats.events_today)}
        icon={ListChecks}
        tone="primary"
      />
      <StatusCard
        label="Running Processes"
        value={value(stats.running_processes)}
        icon={Cpu}
        tone="secondary"
      />
      <StatusCard
        label="Active Connections"
        value={value(stats.active_connections)}
        icon={Network}
        tone="secondary"
      />
      <StatusCard
        label="USB Devices"
        value={value(stats.usb_devices)}
        icon={Usb}
        tone="warning"
      />
    </div>
  );
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diffMs / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}
