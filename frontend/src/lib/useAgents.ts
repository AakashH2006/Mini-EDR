import { useCallback, useEffect, useRef, useState } from "react";
import { api, type AgentStatus } from "./api";

const POLL_INTERVAL_MS = 3000;

/**
 * Polls GET /agent rather than riding the WS event stream — this is
 * operational/process state, not telemetry, and changes rarely enough
 * (only on user action) that a plain poll is simpler and keeps the two
 * concerns separate.
 */
export function useAgents() {
  const [statuses, setStatuses] = useState<AgentStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const res = await api.getAgentStatusAll();
      setStatuses(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agent status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const markPending = (key: string, on: boolean) => {
    setPending((prev) => {
      const next = new Set(prev);
      on ? next.add(key) : next.delete(key);
      return next;
    });
  };

  const start = async (key: string) => {
    markPending(key, true);
    try {
      const updated = await api.startAgent(key);
      setStatuses((prev) => prev.map((s) => (s.key === key ? updated : s)));
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to start ${key}`);
    } finally {
      markPending(key, false);
    }
  };

  const stop = async (key: string) => {
    markPending(key, true);
    try {
      const updated = await api.stopAgent(key);
      setStatuses((prev) => prev.map((s) => (s.key === key ? updated : s)));
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to stop ${key}`);
    } finally {
      markPending(key, false);
    }
  };

  return { statuses, loading, error, pending, start, stop, refresh };
}

/** Separate hook for a single collector's logs, fetched on demand (not
 * polled) — only loaded when a user expands a collector's log panel. */
export function useAgentLogs(key: string, enabled: boolean) {
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    const fetchLogs = async () => {
      setLoading(true);
      try {
        const res = await api.getAgentLogs(key, 20);
        setLines(res.lines);
      } catch {
        /* leave previous lines on transient failure */
      } finally {
        setLoading(false);
      }
    };
    fetchLogs();
    intervalRef.current = setInterval(fetchLogs, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [key, enabled]);

  return { lines, loading };
}
