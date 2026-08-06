// Local single-machine tool — backend always runs on localhost:8000.
// If this ever moves off one box, swap these for env vars.
export const API_BASE = "http://localhost:8000";
export const WS_URL = "ws://localhost:8000/ws";

export interface EventRow {
  id: number;
  timestamp: string;
  event_type: string;
  process_name: string | null;
  parent_process: string | null;
  pid: number | null;
  user: string | null;
  severity: string;
  details: string | null;
}

export interface Stats {
  agent_status: "online" | "offline";
  last_event_at: string | null;
  events_today: number;
  running_processes: number;
  active_connections: number;
  usb_devices: number;
}

export interface ConnectionRow {
  id: number;
  timestamp: string;
  pid: number | null;
  process_name: string | null;
  local_addr: string | null;
  local_port: number | null;
  remote_addr: string | null;
  remote_port: number | null;
  status: string | null;
  active: boolean;
}

export interface ProcessRow {
  id: number;
  pid: number | null;
  process_name: string | null;
  parent_process: string | null;
  user: string | null;
  first_seen: string;
  last_seen: string;
  status: "running" | "terminated";
}

export interface PaginatedList<T> {
  total: number;
  skip: number;
  limit: number;
  items: T[];
}

async function fetchJson<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(API_BASE + path);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`${path} failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export interface AgentStatus {
  key: string;
  name: string;
  running: boolean;
  pid: number | null;
  returncode: number | null;
  started_at: number | null;
}

export interface AgentLogs {
  key: string;
  lines: string[];
}

export const api = {
  getRoot: () => fetchJson<{ status: string; service: string; version: string }>("/"),
  getStats: () => fetchJson<Stats>("/stats"),

  getEvents: (params: {
    skip?: number;
    limit?: number;
    category?: string;
    search?: string;
    sort_by?: string;
    order?: string;
  }) => fetchJson<PaginatedList<EventRow>>("/events", params),

  getEvent: (id: number) => fetchJson<EventRow>(`/events/${id}`),

  getConnections: (params: { skip?: number; limit?: number; search?: string } = {}) =>
    fetchJson<PaginatedList<ConnectionRow>>("/connections", params),

  getProcesses: (params: { skip?: number; limit?: number; status?: string; search?: string } = {}) =>
    fetchJson<PaginatedList<ProcessRow>>("/processes", params),

  getAgentStatusAll: () => fetchJson<AgentStatus[]>("/agent"),

  startAgent: async (key: string): Promise<AgentStatus> => {
    const res = await fetch(`${API_BASE}/agent/${key}/start`, { method: "POST" });
    if (!res.ok) throw new Error(`Failed to start ${key}: ${res.status}`);
    return res.json();
  },

  stopAgent: async (key: string): Promise<AgentStatus> => {
    const res = await fetch(`${API_BASE}/agent/${key}/stop`, { method: "POST" });
    if (!res.ok) throw new Error(`Failed to stop ${key}: ${res.status}`);
    return res.json();
  },

  getAgentLogs: (key: string, lines = 20) => fetchJson<AgentLogs>(`/agent/${key}/logs`, { lines }),
};
