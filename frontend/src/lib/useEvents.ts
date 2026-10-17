import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type EventRow } from "./api";
import { useWs } from "./ws";
import { onRefresh } from "./refreshBus";

export type Category = "all" | "processes" | "network" | "usb" | "authentication";

// Must match CATEGORY_MAP in routers/events.py — this copy exists so a
// live WS event can be filtered client-side without a round trip, and
// the two drifting apart would make the live feed disagree with the
// paged results beneath it.
const CATEGORY_TYPES: Record<Exclude<Category, "all">, string[]> = {
  processes: ["process_creation", "process_termination"],
  network: ["network_connection"],
  usb: ["usb_insert", "usb_remove"],
  authentication: ["logon", "logoff", "logon_failed", "special_logon"],
};

const PAGE_SIZE = 50;

export type SortColumn = "timestamp" | "process_name" | "event_type" | "severity" | "pid";
export type SortOrder = "asc" | "desc";

function matchesFilters(event: EventRow, category: Category, search: string): boolean {
  if (category !== "all" && !CATEGORY_TYPES[category].includes(event.event_type)) {
    return false;
  }
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    const haystack = [event.process_name, event.user, event.event_type, event.pid?.toString()]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

export function useEvents() {
  const { subscribe, subscribeEventUpdates, paused } = useWs();
  const [searchParams] = useSearchParams();
  const initialCategory = (searchParams.get("category") as Category) || "all";

  const [category, setCategory] = useState<Category>(initialCategory);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortColumn>("timestamp");
  const [order, setOrder] = useState<SortOrder>("desc");
  const [page, setPage] = useState(0); // 0-indexed

  const [items, setItems] = useState<EventRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Latest filter/sort/page values in refs so the WS subscriber (set
  // up once) always checks against current state without needing to
  // resubscribe on every filter change.
  const stateRef = useRef({ category, search, page, pausedFlag: paused });
  stateRef.current = { category, search, page, pausedFlag: paused };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getEvents({
        skip: page * PAGE_SIZE,
        limit: PAGE_SIZE,
        category: category === "all" ? undefined : category,
        search: search || undefined,
        sort_by: sortBy,
        order,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load events");
    } finally {
      setLoading(false);
    }
  }, [page, category, search, sortBy, order]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => onRefresh(load), [load]);

  // Live prepend: only onto page 1, only if not paused, only if the
  // incoming event matches the active filters — otherwise a live push
  // would silently violate whatever the user just filtered/searched for.
  useEffect(() => {
    const unsubscribe = subscribe((event: EventRow) => {
      const { category: c, search: s, page: p, pausedFlag } = stateRef.current;
      if (pausedFlag || p !== 0) return;
      if (!matchesFilters(event, c, s)) return;

      setItems((prev) => [event, ...prev].slice(0, PAGE_SIZE));
      setTotal((t) => t + 1);
    });
    return unsubscribe;
  }, [subscribe]);

  // Detection runs a beat behind the event feed, so a row can arrive as
  // Information and be re-scored moments later. Patching it in place
  // means the severity rail turns red under the analyst's eyes instead
  // of waiting for the next refresh to reveal it.
  useEffect(() => {
    const unsubscribe = subscribeEventUpdates(({ id, severity }) => {
      setItems((prev) => {
        const index = prev.findIndex((e) => e.id === id);
        if (index === -1) return prev; // not on the current page
        const next = [...prev];
        next[index] = { ...next[index], severity };
        return next;
      });
    });
    return unsubscribe;
  }, [subscribeEventUpdates]);

  const toggleSort = (column: SortColumn) => {
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
    category,
    setCategory: (c: Category) => {
      setCategory(c);
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
    refetch: load,
  };
}
