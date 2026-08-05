import { useState } from "react";
import StatusCards from "../components/StatusCards";
import EventToolbar from "../components/EventToolbar";
import EventTable from "../components/EventTable";
import Pagination from "../components/Pagination";
import EventDetailsDrawer from "../components/EventDetailsDrawer";
import { useEvents } from "../lib/useEvents";
import type { EventRow } from "../lib/api";

export default function ActivityExplorer() {
  const {
    items,
    total,
    loading,
    error,
    category,
    setCategory,
    search,
    setSearch,
    sortBy,
    order,
    toggleSort,
    page,
    setPage,
    pageSize,
  } = useEvents();

  const [selected, setSelected] = useState<EventRow | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Activity Explorer</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Live endpoint telemetry from your local agent.
        </p>
      </div>

      <StatusCards />

      <div className="space-y-3">
        <EventToolbar search={search} onSearch={setSearch} category={category} onCategory={setCategory} />
        <EventTable
          items={items}
          loading={loading}
          error={error}
          sortBy={sortBy}
          order={order}
          onSort={toggleSort}
          onSelect={setSelected}
        />
        <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
      </div>

      <EventDetailsDrawer event={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
