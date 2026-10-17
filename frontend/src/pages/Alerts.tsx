import { useState } from "react";
import AlertSummaryCards from "../components/AlertSummaryCards";
import AlertTable from "../components/AlertTable";
import AlertDetailsDrawer from "../components/AlertDetailsDrawer";
import ProcessTreeDrawer from "../components/ProcessTreeDrawer";
import FilterPills from "../components/FilterPills";
import Pagination from "../components/Pagination";
import QuickActionsMenu from "../components/QuickActionsMenu";
import SearchInput from "../components/SearchInput";
import StickyToolbar from "../components/StickyToolbar";
import { useAlerts, type SeverityFilter, type StatusFilter } from "../lib/useAlerts";
import { exportToCsv } from "../lib/csv";
import type { AlertRow } from "../lib/api";
import type { TreeTarget } from "../lib/useProcessTree";

const SEVERITY_OPTIONS: { key: SeverityFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "Critical", label: "Critical" },
  { key: "High", label: "High" },
  { key: "Medium", label: "Medium" },
  { key: "Low", label: "Low" },
];

const STATUS_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "new", label: "New" },
  { key: "investigating", label: "Investigating" },
  { key: "resolved", label: "Resolved" },
  { key: "false_positive", label: "False Positive" },
  { key: "all", label: "All" },
];

export default function Alerts() {
  const {
    items,
    total,
    stats,
    loading,
    error,
    severity,
    setSeverity,
    status,
    setStatusFilter,
    search,
    setSearch,
    sortBy,
    order,
    toggleSort,
    page,
    setPage,
    pageSize,
    setStatus,
  } = useAlerts();

  const [selected, setSelected] = useState<AlertRow | null>(null);
  const [treeTarget, setTreeTarget] = useState<TreeTarget | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Alerts</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Detections raised by the rule engine, newest and most severe first.
        </p>
      </div>

      <AlertSummaryCards
        stats={stats}
        loading={loading}
        onFilterSeverity={(s) => setSeverity(s)}
        onFilterStatus={(s) => setStatusFilter(s)}
      />

      <div className="space-y-3">
        <StickyToolbar>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="sm:basis-[60%]">
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder="Search alerts, rules, processes, ATT&CK IDs…"
                />
              </div>
              <div className="flex flex-1 items-center justify-end gap-2">
                <QuickActionsMenu
                  onExportCsv={() => exportToCsv("alerts", items)}
                  onClearFilters={() => {
                    setSearch("");
                    setSeverity("all");
                    setStatusFilter("open");
                  }}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-wide text-text-muted">
                  Severity
                </span>
                <FilterPills options={SEVERITY_OPTIONS} active={severity} onChange={setSeverity} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-wide text-text-muted">
                  Status
                </span>
                <FilterPills
                  options={STATUS_OPTIONS}
                  active={status}
                  onChange={setStatusFilter}
                />
              </div>
            </div>
          </div>
        </StickyToolbar>

        <AlertTable
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

      <AlertDetailsDrawer
        alert={selected}
        onClose={() => setSelected(null)}
        onStatusChange={setStatus}
        onShowTree={(eventId, label) => setTreeTarget({ kind: "event", eventId, label })}
      />
      <ProcessTreeDrawer target={treeTarget} onClose={() => setTreeTarget(null)} />
    </div>
  );
}
