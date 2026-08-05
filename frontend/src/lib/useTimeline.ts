import { useCallback, useEffect, useRef, useState } from "react";
import { api, type EventRow } from "./api";
import { useWs } from "./ws";
import type { Category } from "./useEvents";

const CATEGORY_TYPES: Record<Exclude<Category, "all">, string[]> = {
  processes: ["process_creation", "process_termination"],
  network: ["network_connection"],
  usb: ["usb_insert", "usb_remove"],
  authentication: ["logon", "logoff"],
};

function matchesFilters(event: EventRow, category: Category, search: string): boolean {
  if (category !== "all" && !CATEGORY_TYPES[category].includes(event.event_type)) return false;
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    const hay = [event.process_name, event.user, event.event_type, event.pid?.toString()]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

const BATCH_SIZE = 200;

/**
 * Unlike the paginated event table, Timeline is a continuously
 * accumulating feed — "Load more" appends older events rather than
 * replacing a page, and live WS events always prepend to the top
 * (there's no "page 1 only" restriction since there's only one page).
 */
export function useTimeline() {
  const { subscribe, paused } = useWs();

  const [category, setCategoryFilter] = useState<Category>("all");
  const [search, setSearchFilter] = useState("");
  const [events, setEvents] = useState<EventRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stateRef = useRef({ category, search, pausedFlag: paused });
  stateRef.current = { category, search, pausedFlag: paused };

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getEvents({
        skip: 0,
        limit: BATCH_SIZE,
        category: category === "all" ? undefined : category,
        search: search || undefined,
        sort_by: "timestamp",
        order: "desc",
      });
      setEvents(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load timeline");
    } finally {
      setLoading(false);
    }
  }, [category, search]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const res = await api.getEvents({
        skip: events.length,
        limit: BATCH_SIZE,
        category: category === "all" ? undefined : category,
        search: search || undefined,
        sort_by: "timestamp",
        order: "desc",
      });
      setEvents((prev) => [...prev, ...res.items]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more events");
    } finally {
      setLoadingMore(false);
    }
  }, [events.length, category, search]);

  useEffect(() => {
    const unsubscribe = subscribe((event: EventRow) => {
      const { category: c, search: s, pausedFlag } = stateRef.current;
      if (pausedFlag) return;
      if (!matchesFilters(event, c, s)) return;
      setEvents((prev) => (prev.some((e) => e.id === event.id) ? prev : [event, ...prev]));
      setTotal((t) => t + 1);
    });
    return unsubscribe;
  }, [subscribe]);

  return {
    events,
    total,
    loading,
    loadingMore,
    error,
    hasMore: events.length < total,
    loadMore,
    category,
    setCategory: setCategoryFilter,
    search,
    setSearch: setSearchFilter,
  };
}
