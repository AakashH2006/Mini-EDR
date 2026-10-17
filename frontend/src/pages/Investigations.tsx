import { Flame, FolderOpen, Gauge, ListChecks } from "lucide-react";
import FilterPills from "../components/FilterPills";
import IncidentTable from "../components/IncidentTable";
import Pagination from "../components/Pagination";
import QuickActionsMenu from "../components/QuickActionsMenu";
import SearchInput from "../components/SearchInput";
import StatusCard from "../components/StatusCard";
import StickyToolbar from "../components/StickyToolbar";
import { useIncidents, type IncidentStatusFilter } from "../lib/useIncidents";
import { exportToCsv } from "../lib/csv";

const STATUS_OPTIONS: { key: IncidentStatusFilter; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "open", label: "Open" },
  { key: "investigating", label: "Investigating" },
  { key: "contained", label: "Contained" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
];

export default function Investigations() {
  const {
    items,
    total,
    stats,
    loading,
    error,
    status,
    setStatus,
    search,
    setSearch,
    page,
    setPage,
    pageSize,
  } = useIncidents();

  const value = (n: number | undefined) => (loading || stats === null ? "—" : (n ?? 0));
  const open = stats?.by_status.open ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Investigations</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Alerts sharing a process lineage are grouped into cases, scored by severity and how
          far through the kill chain they reached.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatusCard
          label="Active Cases"
          value={value(stats?.active)}
          icon={FolderOpen}
          tone={(stats?.active ?? 0) > 0 ? "warning" : "success"}
          sublabel="Open, investigating or contained"
        />
        <StatusCard
          label="Open"
          value={value(open)}
          icon={Flame}
          tone={open > 0 ? "critical" : "success"}
          sublabel={open > 0 ? "Not yet triaged" : "Nothing untriaged"}
        />
        <StatusCard
          label="Highest Score"
          value={value(stats?.highest_score)}
          icon={Gauge}
          tone={(stats?.highest_score ?? 0) >= 85 ? "critical" : "primary"}
          sublabel="Across active cases"
        />
        <StatusCard
          label="Total Cases"
          value={value(stats?.total)}
          icon={ListChecks}
          tone="secondary"
        />
      </div>

      <div className="space-y-3">
        <StickyToolbar>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
              <div className="sm:w-72">
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder="Search cases, processes, users…"
                />
              </div>
              <FilterPills options={STATUS_OPTIONS} active={status} onChange={setStatus} />
            </div>
            <QuickActionsMenu
              onExportCsv={() => exportToCsv("investigations", items)}
              onClearFilters={() => {
                setSearch("");
                setStatus("active");
              }}
            />
          </div>
        </StickyToolbar>

        <IncidentTable items={items} loading={loading} error={error} />
        <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
      </div>
    </div>
  );
}
