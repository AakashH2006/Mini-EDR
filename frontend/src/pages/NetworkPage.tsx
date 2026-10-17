import ConnectionTable from "../components/ConnectionTable";
import Pagination from "../components/Pagination";
import SearchInput from "../components/SearchInput";
import LiveControls from "../components/LiveControls";
import QuickActionsMenu from "../components/QuickActionsMenu";
import StickyToolbar from "../components/StickyToolbar";
import { useConnections } from "../lib/useConnections";
import { exportToCsv } from "../lib/csv";

export default function NetworkPage() {
  const { items, total, loading, error, search, setSearch, page, setPage, pageSize } = useConnections();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Network</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Outbound connections observed on this endpoint.
        </p>
      </div>

      <div className="space-y-3">
        <StickyToolbar>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="sm:w-72">
              <SearchInput value={search} onChange={setSearch} placeholder="Search process, PID, or remote address…" />
            </div>
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <LiveControls />
              <QuickActionsMenu
                onExportCsv={() => exportToCsv("network-connections", items)}
                onClearFilters={() => setSearch("")}
              />
            </div>
          </div>
        </StickyToolbar>

        <ConnectionTable items={items} loading={loading} error={error} />
        <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
      </div>
    </div>
  );
}
