import { useCallback, useEffect, useState } from "react";
import {
  api,
  type CaseNote,
  type IncidentDetail,
  type IncidentRow,
  type IncidentStats,
  type IncidentStatus,
  type IncidentTree,
} from "./api";
import { useWs } from "./ws";
import { onRefresh } from "./refreshBus";

export type IncidentStatusFilter = "all" | "active" | IncidentStatus;

const PAGE_SIZE = 25;

/**
 * The case queue.
 *
 * Sorted by score descending, which already folds in severity, tactic
 * breadth and alert volume — a better single ordering for "what to
 * work next" than any one of those alone.
 *
 * Incidents arrive over the WS stream as *rollups*, not as new rows:
 * a case is created once and then updated every time it adopts another
 * alert. The handler therefore replaces a matching row in place and
 * only prepends when the id is genuinely new.
 */
export function useIncidents(initialStatus: IncidentStatusFilter = "active") {
  const { subscribeIncidents } = useWs();

  const [status, setStatusFilter] = useState<IncidentStatusFilter>(initialStatus);
  const [search, setSearchValue] = useState("");
  const [page, setPage] = useState(0);

  const [items, setItems] = useState<IncidentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<IncidentStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, summary] = await Promise.all([
        api.getIncidents({
          skip: page * PAGE_SIZE,
          limit: PAGE_SIZE,
          status: status === "all" ? undefined : status,
          search: search || undefined,
        }),
        api.getIncidentStats(),
      ]);
      setItems(list.items);
      setTotal(list.total);
      setStats(summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load incidents");
    } finally {
      setLoading(false);
    }
  }, [page, status, search]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => onRefresh(load), [load]);

  useEffect(() => {
    // The broadcast rollup carries the aggregate fields but not the
    // case's workflow state, so a refetch is the honest way to stay in
    // step. Only page 1 refetches: an analyst who has paged back
    // shouldn't have the list move under them.
    const unsubscribe = subscribeIncidents(() => {
      if (page === 0) load();
    });
    return unsubscribe;
  }, [subscribeIncidents, load, page]);

  return {
    items,
    total,
    stats,
    loading,
    error,
    status,
    setStatus: (s: IncidentStatusFilter) => {
      setStatusFilter(s);
      setPage(0);
    },
    search,
    setSearch: (s: string) => {
      setSearchValue(s);
      setPage(0);
    },
    page,
    setPage,
    pageSize: PAGE_SIZE,
    refetch: load,
  };
}

/**
 * One case, with its attack chain, notes and process trees.
 *
 * The tree is fetched alongside but tracked separately: it is the
 * most expensive part of the response (a lineage walk per distinct
 * root) and the rest of the page should render without waiting on it.
 */
export function useIncident(incidentId: number | null) {
  const { subscribeIncidents } = useWs();

  const [incident, setIncident] = useState<IncidentDetail | null>(null);
  const [tree, setTree] = useState<IncidentTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [treeLoading, setTreeLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (incidentId === null) return;
    setLoading(true);
    setError(null);
    try {
      setIncident(await api.getIncident(incidentId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load incident");
    } finally {
      setLoading(false);
    }
  }, [incidentId]);

  const loadTree = useCallback(async () => {
    if (incidentId === null) return;
    setTreeLoading(true);
    try {
      setTree(await api.getIncidentTree(incidentId));
    } catch {
      setTree(null); // the rest of the case is still worth showing
    } finally {
      setTreeLoading(false);
    }
  }, [incidentId]);

  useEffect(() => {
    load();
    loadTree();
  }, [load, loadTree]);

  useEffect(() => onRefresh(load), [load]);

  useEffect(() => {
    // Only reload when the broadcast concerns *this* case — every
    // other incident's updates are noise on this page.
    const unsubscribe = subscribeIncidents((rollup) => {
      if (rollup.id === incidentId) {
        load();
        loadTree();
      }
    });
    return unsubscribe;
  }, [subscribeIncidents, incidentId, load, loadTree]);

  const setStatus = useCallback(
    async (next: IncidentStatus, note?: string) => {
      if (incidentId === null) return;
      setBusy(true);
      try {
        await api.setIncidentStatus(incidentId, next, note);
        await load(); // the transition also appended a note
      } finally {
        setBusy(false);
      }
    },
    [incidentId, load]
  );

  const addNote = useCallback(
    async (body: string): Promise<CaseNote | null> => {
      if (incidentId === null || !body.trim()) return null;
      setBusy(true);
      try {
        const note = await api.addIncidentNote(incidentId, body.trim());
        setIncident((prev) => (prev ? { ...prev, notes: [...prev.notes, note] } : prev));
        return note;
      } finally {
        setBusy(false);
      }
    },
    [incidentId]
  );

  return {
    incident,
    tree,
    loading,
    treeLoading,
    error,
    busy,
    setStatus,
    addNote,
    refetch: load,
  };
}
