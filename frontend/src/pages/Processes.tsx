import { useState } from "react";
import ProcessTable from "../components/ProcessTable";
import ProcessTreeDrawer from "../components/ProcessTreeDrawer";
import Pagination from "../components/Pagination";
import SearchInput from "../components/SearchInput";
import FilterPills from "../components/FilterPills";
import LiveControls from "../components/LiveControls";
import QuickActionsMenu from "../components/QuickActionsMenu";
import StickyToolbar from "../components/StickyToolbar";
import { useProcesses } from "../lib/useProcesses";
import { exportToCsv } from "../lib/csv";
import type { TreeTarget } from "../lib/useProcessTree";

const STATUS_OPTIONS = [
  { key: "all" as const, label: "All" },
  { key: "running" as const, label: "Running" },
  { key: "terminated" as const, label: "Terminated" },
];

export default function Processes() {
  const {
    items,
    total,
    loading,
    error,
    status,
    setStatus,
    search,
    setSearch,
    sortBy,
    order,
    toggleSort,
    page,
    setPage,
    pageSize,
  } = useProcesses();

  const [treeTarget, setTreeTarget] = useState<TreeTarget | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Processes</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Every process instance seen, correlated from creation and termination events.
        </p>
      </div>

      <div className="space-y-3">
        <StickyToolbar>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
              <div className="sm:w-72">
                <SearchInput value={search} onChange={setSearch} placeholder="Search process or PID…" />
              </div>
              <FilterPills options={STATUS_OPTIONS} active={status} onChange={setStatus} />
            </div>
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <LiveControls />
              <QuickActionsMenu
                onExportCsv={() => exportToCsv("processes", items)}
                onClearFilters={() => {
                  setSearch("");
                  setStatus("all");
                }}
              />
            </div>
          </div>
        </StickyToolbar>

        <ProcessTable
          items={items}
          loading={loading}
          error={error}
          sortBy={sortBy}
          order={order}
          onSort={toggleSort}
          onShowTree={(row) =>
            setTreeTarget({
              kind: "event",
              eventId: row.id,
              label: `${row.process_name ?? "unknown"} (pid ${row.pid ?? "?"})`,
            })
          }
        />
        <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
      </div>

      <ProcessTreeDrawer target={treeTarget} onClose={() => setTreeTarget(null)} />
    </div>
  );
}
