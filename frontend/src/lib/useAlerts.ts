import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type AlertRow, type AlertStats, type AlertStatus, type Severity } from "./api";
import { useWs } from "./ws";
import { onRefresh } from "./refreshBus";
import { severityRank } from "./alertDisplay";

export type SeverityFilter = "all" | Severity;
export type StatusFilter = "all" | "open" | AlertStatus;
export type AlertSort = "severity" | "timestamp" | "score" | "rule_id" | "process_name";
export type SortOrder = "asc" | "desc";

const PAGE_SIZE = 50;

/**
 * The alert list, kept live off the WS stream.
 *
 * Default filter is `open` and default sort is severity: this list is
 * a work queue, and the first screen should be what still needs
 * triage, worst first. That differs from the event table, which
 * defaults to newest-first because it is a feed.
 *
 * Live inserts respect the active filters for the same reason the
 * event table's do — a push that ignored them would silently
 * contradict what the analyst just filtered for. The difference here
 * is the re-sort: a new Critical belongs at the top of a
 * severity-sorted list, not merely at the front.
 */
export function useAlerts() {
  const { subscribeAlerts } = useWs();
  const [searchParams] = useSearchParams();

  const [severity, setSeverityFilter] = useState<SeverityFilter>(
    (searchParams.get("severity") as SeverityFilter) || "all"
  );
  const [status, setStatusFilter] = useState<StatusFilter>(
    (searchParams.get("status") as StatusFilter) || "open"
  );
  const [search, setSearchValue] = useState("");
  const [sortBy, setSortBy] = useState<AlertSort>("severity");
  const [order, setOrder] = useState<SortOrder>("desc");
  const [page, setPage] = useState(0);

  const [items, setItems] = useState<AlertRow[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<AlertStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const stateRef = useRef({ severity, status, search, page, sortBy, order });
  stateRef.current = { severity, status, search, page, sortBy, order };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, summary] = await Promise.all([
        api.getAlerts({
          skip: page * PAGE_SIZE,
          limit: PAGE_SIZE,
          severity: severity === "all" ? undefined : severity,
          status: status === "all" ? undefined : status,
          search: search || undefined,
          sort_by: sortBy,
          order,
        }),
        api.getAlertStats(),
      ]);
      setItems(list.items);
      setTotal(list.total);
      setStats(summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load alerts");
    } finally {
      setLoading(false);
    }
  }, [page, severity, status, search, sortBy, order]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => onRefresh(load), [load]);

  const matchesFilters = (alert: AlertRow): boolean => {
    const s = stateRef.current;
    if (s.severity !== "all" && alert.severity !== s.severity) return false;
    if (s.status === "open" && !["new", "investigating"].includes(alert.status)) return false;
    if (s.status !== "all" && s.status !== "open" && alert.status !== s.status) return false;
    if (s.search.trim()) {
      const q = s.search.trim().toLowerCase();
      const haystack = [alert.title, alert.rule_name, alert.rule_id, alert.process_name,
                        alert.user, alert.mitre_id, alert.pid?.toString()]
        .filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  };

  useEffect(() => {
    const unsubscribe = subscribeAlerts((alert: AlertRow) => {
      if (stateRef.current.page !== 0) return; // don't disturb a paged-back view
      if (!matchesFilters(alert)) return;

      setItems((prev) => {
        if (prev.some((a) => a.id === alert.id)) return prev;
        const next = [alert, ...prev];
        const { sortBy: column, order: direction } = stateRef.current;
        next.sort((a, b) => {
          const cmp =
            column === "severity"
              ? // Rank order, then recency — same tiebreak the API uses,
                // so a live-inserted row sits exactly where a refetch
                // would have put it.
                severityRank(a.severity) - severityRank(b.severity) ||
                b.timestamp.localeCompare(a.timestamp)
              : column === "score"
                ? b.score - a.score
                : String(b[column] ?? "").localeCompare(String(a[column] ?? ""));
          return direction === "desc" ? cmp : -cmp;
        });
        return next.slice(0, PAGE_SIZE);
      });
      setTotal((t) => t + 1);

      // Keep the summary cards honest without a second round trip.
      setStats((prev) =>
        prev
          ? {
              ...prev,
              total: prev.total + 1,
              open: prev.open + 1,
              last_24h: prev.last_24h + 1,
              by_severity: {
                ...prev.by_severity,
                [alert.severity]: (prev.by_severity[alert.severity] ?? 0) + 1,
              },
              by_status: { ...prev.by_status, new: (prev.by_status.new ?? 0) + 1 },
            }
          : prev
      );
    });
    return unsubscribe;
  }, [subscribeAlerts]);

  const setStatus = useCallback(
    async (id: number, next: AlertStatus) => {
      // Optimistic: triage should feel instant, and the only failure
      // mode is a backend that's down — which the refetch surfaces.
      setItems((prev) => prev.map((a) => (a.id === id ? { ...a, status: next } : a)));
      try {
        await api.setAlertStatus(id, next);
      } finally {
        load();
      }
    },
    [load]
  );

  const toggleSort = (column: AlertSort) => {
    if (sortBy === column) {
      setOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column);
      setOrder("desc");
    }
    setPage(0);
  };

  return {
    items,
    total,
    stats,
    loading,
    error,
    severity,
    setSeverity: (s: SeverityFilter) => {
      setSeverityFilter(s);
      setPage(0);
    },
    status,
    setStatusFilter: (s: StatusFilter) => {
      setStatusFilter(s);
      setPage(0);
    },
    search,
    setSearch: (s: string) => {
      setSearchValue(s);
      setPage(0);
    },
    sortBy,
    order,
    toggleSort,
    page,
    setPage,
    pageSize: PAGE_SIZE,
    setStatus,
    refetch: load,
  };
}

/**
 * Just the open-alert count, for the sidebar badge.
 *
 * Deliberately separate from useAlerts: the badge is mounted on every
 * page, and having it pull the full paginated list plus stats would
 * mean two requests on every navigation to render one number.
 */
export function useOpenAlertCount(): number {
  const { subscribeAlerts } = useWs();
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const stats = await api.getAlertStats();
      setCount(stats.open);
    } catch {
      /* badge simply doesn't render a count if the API is unreachable */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => onRefresh(load), [load]);

  useEffect(() => subscribeAlerts(() => setCount((c) => c + 1)), [subscribeAlerts]);

  return count;
}
