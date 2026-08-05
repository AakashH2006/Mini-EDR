import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ConnectionRow, type EventRow } from "./api";
import { useWs } from "./ws";

const PAGE_SIZE = 50;

export function useConnections() {
  const { subscribe, paused } = useWs();

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const [items, setItems] = useState<ConnectionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const stateRef = useRef({ search, page, pausedFlag: paused });
  stateRef.current = { search, page, pausedFlag: paused };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getConnections({
        skip: page * PAGE_SIZE,
        limit: PAGE_SIZE,
        search: search || undefined,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load connections");
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const unsubscribe = subscribe((event: EventRow) => {
      const { search: q, page: p, pausedFlag } = stateRef.current;
      if (pausedFlag || p !== 0 || event.event_type !== "network_connection") return;

      let details: Record<string, unknown> = {};
      try {
        details = event.details ? JSON.parse(event.details) : {};
      } catch {
        /* ignore malformed details */
      }

      if (q.trim()) {
        const query = q.trim().toLowerCase();
        const hay = `${event.process_name ?? ""} ${event.pid ?? ""} ${details.remote_addr ?? ""}`.toLowerCase();
        if (!hay.includes(query)) return;
      }

      const newRow: ConnectionRow = {
        id: event.id,
        timestamp: event.timestamp,
        pid: event.pid,
        process_name: event.process_name,
        local_addr: (details.local_addr as string) ?? null,
        local_port: (details.local_port as number) ?? null,
        remote_addr: (details.remote_addr as string) ?? null,
        remote_port: (details.remote_port as number) ?? null,
        status: (details.status as string) ?? null,
        active: true,
      };

      setItems((prev) => [newRow, ...prev].slice(0, PAGE_SIZE));
      setTotal((t) => t + 1);
    });
    return unsubscribe;
  }, [subscribe]);

  return {
    items,
    total,
    loading,
    error,
    search,
    setSearch: (s: string) => {
      setSearch(s);
      setPage(0);
    },
    page,
    setPage,
    pageSize: PAGE_SIZE,
  };
}
