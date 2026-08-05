import ConnectionTable from "../components/ConnectionTable";
import Pagination from "../components/Pagination";
import SearchInput from "../components/SearchInput";
import LiveControls from "../components/LiveControls";
import { useConnections } from "../lib/useConnections";

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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SearchInput value={search} onChange={setSearch} placeholder="Search process, PID, or remote address…" />
          <div className="self-start sm:self-auto">
            <LiveControls />
          </div>
        </div>

        <ConnectionTable items={items} loading={loading} error={error} />
        <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
      </div>
    </div>
  );
}
