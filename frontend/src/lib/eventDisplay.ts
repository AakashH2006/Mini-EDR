import { Cpu, XCircle, Network, Usb, LogIn, LogOut, type LucideIcon } from "lucide-react";

export const EVENT_TYPE_META: Record<string, { label: string; icon: LucideIcon }> = {
  process_creation: { label: "Process Created", icon: Cpu },
  process_termination: { label: "Process Terminated", icon: XCircle },
  network_connection: { label: "Network Connection", icon: Network },
  usb_insert: { label: "USB Inserted", icon: Usb },
  usb_remove: { label: "USB Removed", icon: Usb },
  logon: { label: "User Logon", icon: LogIn },
  logoff: { label: "User Logoff", icon: LogOut },
};

export function eventTypeMeta(eventType: string) {
  return EVENT_TYPE_META[eventType] ?? { label: eventType, icon: Cpu };
}

// Only "Information" is emitted in Phase 1 (no detection engine yet),
// but the mapping is written generically so severities added later
// (Warning/Critical) plug in without touching the table/badge code.
export function severityTone(severity: string): "primary" | "success" | "warning" | "critical" {
  switch (severity.toLowerCase()) {
    case "critical":
      return "critical";
    case "warning":
      return "warning";
    case "success":
      return "success";
    default:
      return "primary";
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
