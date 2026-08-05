import { useCallback, useEffect, useRef, useState } from "react";
import { api, type EventRow, type ProcessRow } from "./api";
import { useWs } from "./ws";

export type ProcessStatus = "all" | "running" | "terminated";
export type ProcessSort = "first_seen" | "process_name" | "pid" | "last_seen";
export type SortOrder = "asc" | "desc";

const PAGE_SIZE = 50;

export function useProcesses() {
  const { subscribe, paused } = useWs();

  const [status, setStatusFilter] = useState<ProcessStatus>("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<ProcessSort>("first_seen");
  const [order, setOrder] = useState<SortOrder>("desc");
  const [page, setPage] = useState(0);

  const [items, setItems] = useState<ProcessRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const stateRef = useRef({ status, search, page, pausedFlag: paused });
  stateRef.current = { status, search, page, pausedFlag: paused };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getProcesses({
        skip: page * PAGE_SIZE,
        limit: PAGE_SIZE,
        status: status === "all" ? undefined : status,
        search: search || undefined,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load processes");
    } finally {
      setLoading(false);
    }
  }, [page, status, search]);

  useEffect(() => {
    load();
  }, [load]);

  // Client-side sort of the current page — the backend already sorts
  // for the initial fetch, but a WS-driven prepend below can put a
  // new row at the front regardless of the active sort column, so we
  // re-sort the visible page after any mutation for consistency.
  const sortItems = useCallback(
    (list: ProcessRow[]) => {
      const sorted = [...list].sort((a, b) => {
        const av = a[sortBy] ?? "";
        const bv = b[sortBy] ?? "";
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return order === "asc" ? cmp : -cmp;
      });
      return sorted;
    },
    [sortBy, order]
  );

  useEffect(() => {
    const unsubscribe = subscribe((event: EventRow) => {
      const { status: s, search: q, page: p, pausedFlag } = stateRef.current;
      if (pausedFlag || p !== 0) return;

      if (event.event_type === "process_creation") {
        if (s === "terminated") return;
        if (q.trim()) {
          const query = q.trim().toLowerCase();
          const hay = `${event.process_name ?? ""} ${event.pid ?? ""}`.toLowerCase();
          if (!hay.includes(query)) return;
        }
        const newRow: ProcessRow = {
          id: event.id,
          pid: event.pid,
          process_name: event.process_name,
          parent_process: event.parent_process,
          user: event.user,
          first_seen: event.timestamp,
          last_seen: event.timestamp,
          status: "running",
        };
        setItems((prev) => sortItems([newRow, ...prev]).slice(0, PAGE_SIZE));
        setTotal((t) => t + 1);
      } else if (event.event_type === "process_termination") {
        setItems((prev) => {
          const idx = prev.findIndex((p) => p.pid === event.pid && p.status === "running");
          if (idx === -1) return prev; // process from before this session / another page
          if (s === "running") {
            // no longer matches the "running" filter — drop it
            return prev.filter((_, i) => i !== idx);
          }
          const updated = [...prev];
          updated[idx] = { ...updated[idx], status: "terminated", last_seen: event.timestamp };
          return sortItems(updated);
        });
      }
    });
    return unsubscribe;
  }, [subscribe, sortItems]);

  const toggleSort = (column: ProcessSort) => {
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
    loading,
    error,
    status,
    setStatus: (s: ProcessStatus) => {
      setStatusFilter(s);
      setPage(0);
    },
    search,
    setSearch: (s: string) => {
      setSearch(s);
      setPage(0);
    },
    sortBy,
    order,
    toggleSort,
    page,
    setPage,
    pageSize: PAGE_SIZE,
  };
}
