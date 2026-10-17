import { AlertTriangle, Clock, Flame, Inbox, ShieldAlert } from "lucide-react";
import type { AlertStats } from "../lib/api";
import StatusCard from "./StatusCard";

interface Props {
  stats: AlertStats | null;
  loading: boolean;
  onFilterSeverity: (severity: "all" | "Critical" | "High") => void;
  onFilterStatus: (status: "all" | "open") => void;
}

/**
 * Summary cards for the Alerts page, reusing the Phase 1 StatusCard so
 * the two pages share one visual language.
 *
 * Each card is a filter, not just a number — clicking "Critical"
 * applies that filter to the table below. A count an analyst can see
 * but not act on is a dead end, and the cards are the most natural
 * entry point into a triage queue.
 */
export default function AlertSummaryCards({
  stats,
  loading,
  onFilterSeverity,
  onFilterStatus,
}: Props) {
  const value = (n: number | undefined) => (loading || stats === null ? "—" : (n ?? 0));

  const critical = stats?.by_severity.Critical ?? 0;
  const high = stats?.by_severity.High ?? 0;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <StatusCard
        label="Open Alerts"
        value={value(stats?.open)}
        icon={Inbox}
        tone={(stats?.open ?? 0) > 0 ? "warning" : "success"}
        sublabel="New or investigating"
        onClick={() => onFilterStatus("open")}
      />
      <StatusCard
        label="Critical"
        value={value(critical)}
        icon={Flame}
        tone={critical > 0 ? "critical" : "success"}
        sublabel={critical > 0 ? "Needs attention now" : "None outstanding"}
        onClick={() => onFilterSeverity("Critical")}
      />
      <StatusCard
        label="High"
        value={value(high)}
        icon={ShieldAlert}
        tone={high > 0 ? "warning" : "success"}
        onClick={() => onFilterSeverity("High")}
      />
      <StatusCard
        label="Last 24 Hours"
        value={value(stats?.last_24h)}
        icon={Clock}
        tone="primary"
        onClick={() => onFilterStatus("all")}
      />
      <StatusCard
        label="Total Alerts"
        value={value(stats?.total)}
        icon={AlertTriangle}
        tone="secondary"
        sublabel="All time, within retention"
        onClick={() => onFilterStatus("all")}
      />
    </div>
  );
}
