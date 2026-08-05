import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { WS_URL, type EventRow } from "./api";

export type WsStatus = "connecting" | "open" | "closed";

interface WsContextValue {
  status: WsStatus;
  paused: boolean;
  setPaused: (p: boolean) => void;
  subscribe: (cb: (event: EventRow) => void) => () => void;
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
      if (pausedRef.current) return; // drop while paused; socket stays open
      try {
        const parsed = JSON.parse(msg.data);
        if (parsed.type === "event") {
          for (const cb of listenersRef.current) cb(parsed.data as EventRow);
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

  const subscribe = useCallback((cb: (event: EventRow) => void) => {
    listenersRef.current.add(cb);
    return () => listenersRef.current.delete(cb);
  }, []);

  const reconnect = useCallback(() => {
    socketRef.current?.close();
    backoffRef.current = 1000;
    connect();
  }, [connect]);

  return (
    <WsContext.Provider value={{ status, paused, setPaused, subscribe, reconnect }}>
      {children}
    </WsContext.Provider>
  );
}

export function useWs() {
  const ctx = useContext(WsContext);
  if (!ctx) throw new Error("useWs must be used within WebSocketProvider");
  return ctx;
}
