import { useEffect } from "react";
import { X } from "lucide-react";
import type { EventRow } from "../lib/api";
import { eventTypeMeta, severityTone, formatTimestamp } from "../lib/eventDisplay";

const TONE_TEXT: Record<string, string> = {
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  critical: "text-critical",
};

interface Props {
  event: EventRow | null;
  onClose: () => void;
}

export default function EventDetailsDrawer({ event, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!event) return null;

  const meta = eventTypeMeta(event.event_type);
  const tone = severityTone(event.severity);
  let prettyDetails = "—";
  try {
    prettyDetails = event.details ? JSON.stringify(JSON.parse(event.details), null, 2) : "—";
  } catch {
    prettyDetails = event.details ?? "—";
  }

  const fields: { label: string; value: string | number | null }[] = [
    { label: "Event ID", value: event.id },
    { label: "Timestamp", value: event.timestamp },
    { label: "PID", value: event.pid },
    { label: "Process", value: event.process_name },
    { label: "Parent Process", value: event.parent_process },
    { label: "User", value: event.user },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col border-l border-border bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2.5">
            <meta.icon className="h-5 w-5 text-text-secondary" />
            <div>
              <div className="text-sm font-semibold text-text-primary">{meta.label}</div>
              <div className="font-mono text-xs text-text-muted">{formatTimestamp(event.timestamp)}</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-panel-hover hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-4 flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-text-muted">Severity</span>
            <span className={`text-xs font-semibold ${TONE_TEXT[tone]}`}>{event.severity}</span>
          </div>

          <dl className="space-y-3">
            {fields.map((f) => (
              <div key={f.label} className="grid grid-cols-3 gap-2 text-sm">
                <dt className="text-text-muted">{f.label}</dt>
                <dd className="col-span-2 break-all font-mono text-text-primary">
                  {f.value ?? <span className="text-text-muted">—</span>}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-5">
            <div className="mb-2 text-xs uppercase tracking-wide text-text-muted">Details</div>
            <pre className="overflow-x-auto rounded-lg border border-border bg-bg px-3 py-3 font-mono text-xs text-text-secondary">
              {prettyDetails}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
