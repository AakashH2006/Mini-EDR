import {
  Cpu,
  KeyRound,
  LogIn,
  LogOut,
  Network,
  ShieldX,
  Usb,
  XCircle,
  type LucideIcon,
} from "lucide-react";

export const EVENT_TYPE_META: Record<string, { label: string; icon: LucideIcon }> = {
  process_creation: { label: "Process Created", icon: Cpu },
  process_termination: { label: "Process Terminated", icon: XCircle },
  network_connection: { label: "Network Connection", icon: Network },
  usb_insert: { label: "USB Inserted", icon: Usb },
  usb_remove: { label: "USB Removed", icon: Usb },
  logon: { label: "User Logon", icon: LogIn },
  logoff: { label: "User Logoff", icon: LogOut },
  // Added in Phase 2: the brute-force and privilege-escalation rules
  // need failures and privileged sessions, which 4624/4634 alone don't
  // record.
  logon_failed: { label: "Failed Logon", icon: ShieldX },
  special_logon: { label: "Privileged Logon", icon: KeyRound },
};

export function eventTypeMeta(eventType: string) {
  return EVENT_TYPE_META[eventType] ?? { label: eventType, icon: Cpu };
}

// Collectors still write every event as "Information". The other four
// tiers are now set by the detection engine, which raises an event's
// severity in place when a rule matches it (see detection/engine.py) —
// so a row's colour here is a detection verdict, not something the
// collector decided.
export type SeverityTone = "info" | "low" | "medium" | "high" | "critical";

export function severityTone(severity: string): SeverityTone {
  switch (severity.toLowerCase()) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "medium":
      return "medium";
    case "low":
      return "low";
    default:
      return "info";
  }
}

export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
