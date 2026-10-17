import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { WS_URL, type AlertRow, type EventRow, type IncidentRow } from "./api";

export type WsStatus = "connecting" | "open" | "closed";

/** An event's severity was raised after a rule scored it. Detection
 *  runs a beat behind the event feed (see detection/poller.py), so a
 *  row can appear as Information and be re-coloured a moment later —
 *  this is the message that re-colours it. */
export interface EventSeverityUpdate {
  id: number;
  severity: string;
}

interface WsContextValue {
  status: WsStatus;
  paused: boolean;
  setPaused: (p: boolean) => void;
  subscribe: (cb: (event: EventRow) => void) => () => void;
  subscribeAlerts: (cb: (alert: AlertRow) => void) => () => void;
  subscribeEventUpdates: (cb: (update: EventSeverityUpdate) => void) => () => void;
  subscribeIncidents: (cb: (incident: IncidentRow) => void) => () => void;
  reconnect: () => void;
}

const WsContext = createContext<WsContextValue | null>(null);

// One physical socket for the whole app — the event table, status cards,
// and the sidebar's live indicator all ride the same connection instead
// of each opening their own. Reconnect uses capped exponential backoff
// so a backend restart doesn't get hammered with connect attempts.
const MAX_BACKOFF_MS = 15_000;

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<WsStatus>("connecting");
  const [paused, setPaused] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Set<(event: EventRow) => void>>(new Set());
  const alertListenersRef = useRef<Set<(alert: AlertRow) => void>>(new Set());
  const updateListenersRef = useRef<Set<(u: EventSeverityUpdate) => void>>(new Set());
  const incidentListenersRef = useRef<Set<(incident: IncidentRow) => void>>(new Set());
  const backoffRef = useRef(1000);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const connect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    setStatus("connecting");
    const socket = new WebSocket(WS_URL);
    socketRef.current = socket;

    socket.onopen = () => {
      backoffRef.current = 1000; // reset backoff on a healthy connection
      setStatus("open");
    };

    socket.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data);

        // Pause is about the *event feed* scrolling away under the
        // analyst's cursor. Alerts and incidents are not a feed — a
        // Critical detection that arrived while the table was paused
        // still needs to reach the alert list and the sidebar badge,
        // so only "event" is gated on it.
        if (parsed.type === "event") {
          if (pausedRef.current) return;
          for (const cb of listenersRef.current) cb(parsed.data as EventRow);
        } else if (parsed.type === "alert") {
          for (const cb of alertListenersRef.current) cb(parsed.data as AlertRow);
        } else if (parsed.type === "event_update") {
          for (const cb of updateListenersRef.current) cb(parsed.data as EventSeverityUpdate);
        } else if (parsed.type === "incident") {
          for (const cb of incidentListenersRef.current) cb(parsed.data as IncidentRow);
        }
      } catch {
        // ignore malformed frames
      }
    };

    socket.onclose = () => {
      setStatus("closed");
      reconnectTimerRef.current = setTimeout(connect, backoffRef.current);
      backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
    };

    socket.onerror = () => {
      socket.close();
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      socketRef.current?.close();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [connect]);

  // Space toggles pause/resume, but only when focus isn't in a text
  // field — otherwise typing a space in the search box would pause
  // the feed instead of typing a space character.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const el = document.activeElement;
      const tag = el?.tagName;
      const isTyping = tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement)?.isContentEditable;
      if (isTyping) return;
      e.preventDefault(); // stop page scroll
      setPaused((p) => !p);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const subscribe = useCallback((cb: (event: EventRow) => void) => {
    listenersRef.current.add(cb);
    return () => listenersRef.current.delete(cb);
  }, []);

  const subscribeAlerts = useCallback((cb: (alert: AlertRow) => void) => {
    alertListenersRef.current.add(cb);
    return () => alertListenersRef.current.delete(cb);
  }, []);

  const subscribeEventUpdates = useCallback((cb: (u: EventSeverityUpdate) => void) => {
    updateListenersRef.current.add(cb);
    return () => updateListenersRef.current.delete(cb);
  }, []);

  const subscribeIncidents = useCallback((cb: (incident: IncidentRow) => void) => {
    incidentListenersRef.current.add(cb);
    return () => incidentListenersRef.current.delete(cb);
  }, []);

  const reconnect = useCallback(() => {
    socketRef.current?.close();
    backoffRef.current = 1000;
    connect();
  }, [connect]);

  return (
    <WsContext.Provider
      value={{
        status,
        paused,
        setPaused,
        subscribe,
        subscribeAlerts,
        subscribeEventUpdates,
        subscribeIncidents,
        reconnect,
      }}
    >
      {children}
    </WsContext.Provider>
  );
}

export function useWs() {
  const ctx = useContext(WsContext);
  if (!ctx) throw new Error("useWs must be used within WebSocketProvider");
  return ctx;
}
