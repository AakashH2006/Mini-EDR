import { Inbox } from "lucide-react";
import type { EventRow } from "../lib/api";
import { groupByHour } from "../lib/timelineGrouping";
import { eventTypeMeta, severityTone, formatTimestamp } from "../lib/eventDisplay";

const TONE_DOT: Record<string, string> = {
  primary: "bg-primary ring-primary/25",
  success: "bg-success ring-success/25",
  warning: "bg-warning ring-warning/25",
  critical: "bg-critical ring-critical/25",
};

interface Props {
  events: EventRow[];
  loading: boolean;
  error: string | null;
  onSelect: (event: EventRow) => void;
}

export default function TimelineFeed({ events, loading, error, onSelect }: Props) {
  if (loading && events.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-panel px-5 py-10 text-center text-sm text-text-muted">
        Loading timeline…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-xl border border-border bg-panel px-5 py-10 text-center text-sm text-critical">
        {error}
      </div>
    );
  }
  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-panel px-5 py-14 text-text-muted">
        <Inbox className="h-6 w-6" />
        <span className="text-sm">No events match the current filters.</span>
      </div>
    );
  }

  const groups = groupByHour(events);

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group.key}>
          <div className="mb-3 flex items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
              {group.label}
            </span>
            <span className="h-px flex-1 bg-border" />
            <span className="font-mono text-xs text-text-muted">{group.events.length} events</span>
          </div>

          <div className="relative space-y-1 pl-5">
            <span className="absolute left-[7px] top-1 bottom-1 w-px bg-border" />
            {group.events.map((event) => {
              const meta = eventTypeMeta(event.event_type);
              const tone = severityTone(event.severity);
              const Icon = meta.icon;
              return (
                <button
                  key={event.id}
                  onClick={() => onSelect(event)}
                  className="group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-panel-hover"
                >
                  <span
                    className={`absolute -left-[19px] h-2.5 w-2.5 rounded-full ring-4 ring-bg ${TONE_DOT[tone]}`}
                  />
                  <span className="w-16 shrink-0 font-mono text-xs text-text-muted">
                    {formatTimestamp(event.timestamp).split(", ").slice(-1)[0]}
                  </span>
                  <Icon className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                  <span className="shrink-0 text-sm text-text-primary">{meta.label}</span>
                  {event.process_name && (
                    <span className="truncate font-mono text-xs text-text-secondary">
                      {event.process_name}
                      {event.pid != null && ` · PID ${event.pid}`}
                    </span>
                  )}
                  {event.user && (
                    <span className="ml-auto shrink-0 text-xs text-text-muted">{event.user}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
