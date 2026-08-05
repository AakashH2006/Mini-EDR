import ProcessTable from "../components/ProcessTable";
import Pagination from "../components/Pagination";
import SearchInput from "../components/SearchInput";
import FilterPills from "../components/FilterPills";
import LiveControls from "../components/LiveControls";
import { useProcesses } from "../lib/useProcesses";

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Processes</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Every process instance seen, correlated from creation and termination events.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
            <SearchInput value={search} onChange={setSearch} placeholder="Search process or PID…" />
            <FilterPills options={STATUS_OPTIONS} active={status} onChange={setStatus} />
          </div>
          <div className="self-start sm:self-auto">
            <LiveControls />
          </div>
        </div>

        <ProcessTable items={items} loading={loading} error={error} sortBy={sortBy} order={order} onSort={toggleSort} />
        <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
      </div>
    </div>
  );
}
