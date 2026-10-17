import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { EventRow } from "../lib/api";
import { eventTypeMeta, formatTimestamp } from "../lib/eventDisplay";
import SeverityBadge from "./SeverityBadge";

const TRANSITION_MS = 250;

interface Props {
  event: EventRow | null;
  onClose: () => void;
}

export default function EventDetailsDrawer({ event, onClose }: Props) {
  // The drawer needs to keep rendering the outgoing event while it
  // slides out, even though `event` has already gone back to null —
  // otherwise the exit animation would show an empty panel.
  const [renderedEvent, setRenderedEvent] = useState<EventRow | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (event) {
      setRenderedEvent(event);
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    } else {
      setVisible(false);
      const t = setTimeout(() => setRenderedEvent(null), TRANSITION_MS);
      return () => clearTimeout(t);
    }
  }, [event]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && event && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [event, onClose]);

  if (!renderedEvent) return null;

  const meta = eventTypeMeta(renderedEvent.event_type);
  let details: Record<string, unknown> = {};
  let prettyDetails = "—";
  try {
    details = renderedEvent.details ? JSON.parse(renderedEvent.details) : {};
    prettyDetails = renderedEvent.details ? JSON.stringify(details, null, 2) : "—";
  } catch {
    prettyDetails = renderedEvent.details ?? "—";
  }

  const fields: { label: string; value: string | number | null; mono?: boolean }[] = [
    { label: "Event ID", value: renderedEvent.id },
    { label: "Timestamp", value: renderedEvent.timestamp, mono: true },
    { label: "PID", value: renderedEvent.pid, mono: true },
    { label: "Process Name", value: renderedEvent.process_name, mono: true },
    { label: "Parent Process", value: renderedEvent.parent_process, mono: true },
    { label: "User", value: renderedEvent.user },
    { label: "Executable Path", value: (details.executable_path as string) ?? null, mono: true },
    { label: "Command Line", value: (details.command_line as string) ?? null, mono: true },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className={`absolute inset-0 bg-black/50 transition-opacity duration-250 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />
      <div
        className={`relative flex h-full w-full max-w-md flex-col border-l border-border bg-panel shadow-2xl transition-transform duration-250 ease-out ${
          visible ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2.5">
            <meta.icon className="h-5 w-5 text-text-secondary" />
            <div>
              <div className="text-sm font-semibold text-text-primary">{meta.label}</div>
              <div className="font-mono text-xs text-text-muted">
                {formatTimestamp(renderedEvent.timestamp)}
              </div>
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
            <SeverityBadge severity={renderedEvent.severity} />
          </div>

          <dl className="space-y-3">
            {fields.map((f) => (
              <div key={f.label} className="grid grid-cols-3 gap-2 text-sm">
                <dt className="text-text-muted">{f.label}</dt>
                <dd className={`col-span-2 break-all text-text-primary ${f.mono ? "font-mono text-xs" : ""}`}>
                  {f.value ?? <span className="text-text-muted">—</span>}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-5">
            <div className="mb-2 text-xs uppercase tracking-wide text-text-muted">Additional Details</div>
            <pre className="overflow-x-auto rounded-lg border border-border bg-bg px-3 py-3 font-mono text-xs text-text-secondary">
              {prettyDetails}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
