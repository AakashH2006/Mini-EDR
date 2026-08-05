import { useState } from "react";
import EventToolbar from "../components/EventToolbar";
import TimelineFeed from "../components/TimelineFeed";
import EventDetailsDrawer from "../components/EventDetailsDrawer";
import { useTimeline } from "../lib/useTimeline";
import type { EventRow } from "../lib/api";

export default function Timeline() {
  const {
    events,
    total,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
    category,
    setCategory,
    search,
    setSearch,
  } = useTimeline();

  const [selected, setSelected] = useState<EventRow | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Timeline</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Chronological feed of endpoint activity, grouped by hour.
        </p>
      </div>

      <div className="space-y-4">
        <EventToolbar search={search} onSearch={setSearch} category={category} onCategory={setCategory} />

        <TimelineFeed events={events} loading={loading} error={error} onSelect={setSelected} />

        {hasMore && (
          <div className="flex justify-center">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="rounded-lg border border-border bg-panel px-4 py-2 text-xs font-medium text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : `Load older events (${total - events.length} more)`}
            </button>
          </div>
        )}
      </div>

      <EventDetailsDrawer event={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
