import { useEffect, useRef, useState } from "react";
import { api, type EventRow, type Stats } from "./api";
import { useWs } from "./ws";

const AGENT_OFFLINE_THRESHOLD_MS = 30_000;
const ACTIVE_CONN_WINDOW_MS = 15 * 60_000;
const ACTIVE_CONN_SWEEP_MS = 5_000;

export interface LiveStats extends Stats {
  loading: boolean;
  error: string | null;
}

function todayUtcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function connectionFingerprint(e: EventRow, details: Record<string, unknown>): string {
  return `${e.pid}:${details.remote_addr}:${details.remote_port}`;
}

/**
 * Fetches /stats once as a baseline, then keeps each metric live by
 * reacting to the shared WS event stream rather than re-polling the
 * REST endpoint. Two different update strategies are used depending
 * on what the metric actually is:
 *
 * - running_processes / usb_devices: paired state (created vs
 *   terminated, inserted vs removed). Tracked as baseline count + a
 *   session-local delta, using a Set of "currently open" keys so a
 *   termination/removal only decrements if we plausibly opened it
 *   (or, if not tracked, is assumed to be part of the original
 *   baseline — a reasonable assumption for a single endpoint).
 * - active_connections: a *recency window*, not paired state (the
 *   network collector never logs a "closed" event) — so this one is
 *   seeded from GET /connections (which already knows what's active)
 *   into a fingerprint→timestamp map, then swept on a timer to expire
 *   entries older than the window, independent of new WS traffic.
 * - events_today / last_event_at / agent_status: simple counters/
 *   timestamps updated directly off the event stream and a 1s clock
 *   tick (agent_status depends on elapsed time, not just new events).
 */
export function useLiveStats(): LiveStats {
  const { subscribe } = useWs();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [eventsToday, setEventsToday] = useState(0);
  const [runningProcesses, setRunningProcesses] = useState(0);
  const [usbDevices, setUsbDevices] = useState(0);
  const [activeConnections, setActiveConnections] = useState(0);
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<"online" | "offline">("offline");

  const sessionPids = useRef<Set<number>>(new Set());
  const sessionDrives = useRef<Set<string>>(new Set());
  const connMap = useRef<Map<string, number>>(new Map());
  const lastEventMs = useRef<number>(0);
  const todayStr = useRef(todayUtcDateString());

  // --- Baseline load ---
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [stats, connections] = await Promise.all([
          api.getStats(),
          api.getConnections({ limit: 200 }),
        ]);
        if (cancelled) return;

        setEventsToday(stats.events_today);
        setRunningProcesses(stats.running_processes);
        setUsbDevices(stats.usb_devices);
        setLastEventAt(stats.last_event_at);
        lastEventMs.current = stats.last_event_at ? new Date(stats.last_event_at).getTime() : 0;

        for (const c of connections.items) {
          if (c.active) {
            connMap.current.set(`${c.pid}:${c.remote_addr}:${c.remote_port}`, Date.now());
          }
        }
        setActiveConnections(connMap.current.size);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load stats");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Live updates from the WS stream ---
  useEffect(() => {
    const unsubscribe = subscribe((event: EventRow) => {
      lastEventMs.current = Date.now();
      setLastEventAt(event.timestamp);

      if (event.timestamp.slice(0, 10) === todayStr.current) {
        setEventsToday((n) => n + 1);
      }

      let details: Record<string, unknown> = {};
      try {
        details = event.details ? JSON.parse(event.details) : {};
      } catch {
        /* malformed details JSON — treat as empty */
      }

      switch (event.event_type) {
        case "process_creation":
          if (event.pid != null) sessionPids.current.add(event.pid);
          setRunningProcesses((n) => n + 1);
          break;
        case "process_termination":
          if (event.pid != null) sessionPids.current.delete(event.pid);
          setRunningProcesses((n) => Math.max(0, n - 1));
          break;
        case "usb_insert": {
          const drive = String(details.drive ?? "");
          sessionDrives.current.add(drive);
          setUsbDevices((n) => n + 1);
          break;
        }
        case "usb_remove": {
          const drive = String(details.drive ?? "");
          sessionDrives.current.delete(drive);
          setUsbDevices((n) => Math.max(0, n - 1));
          break;
        }
        case "network_connection": {
          const fp = connectionFingerprint(event, details);
          connMap.current.set(fp, Date.now());
          setActiveConnections(connMap.current.size);
          break;
        }
      }
    });
    return unsubscribe;
  }, [subscribe]);

  // --- Clock ticks: agent online/offline + active-connection window sweep ---
  useEffect(() => {
    const tick = setInterval(() => {
      setAgentStatus(
        lastEventMs.current && Date.now() - lastEventMs.current <= AGENT_OFFLINE_THRESHOLD_MS
          ? "online"
          : "offline"
      );
    }, 1000);

    const sweep = setInterval(() => {
      const cutoff = Date.now() - ACTIVE_CONN_WINDOW_MS;
      let changed = false;
      for (const [key, ts] of connMap.current) {
        if (ts < cutoff) {
          connMap.current.delete(key);
          changed = true;
        }
      }
      if (changed) setActiveConnections(connMap.current.size);
    }, ACTIVE_CONN_SWEEP_MS);

    return () => {
      clearInterval(tick);
      clearInterval(sweep);
    };
  }, []);

  return {
    agent_status: agentStatus,
    last_event_at: lastEventAt,
    events_today: eventsToday,
    running_processes: runningProcesses,
    active_connections: activeConnections,
    usb_devices: usbDevices,
    loading,
    error,
  };
}
