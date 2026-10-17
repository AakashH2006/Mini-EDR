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

// --- Phase 2: detection -------------------------------------------------

export type Severity = "Information" | "Low" | "Medium" | "High" | "Critical";
export type AlertStatus = "new" | "investigating" | "resolved" | "false_positive";

export interface AlertRow {
  id: number;
  timestamp: string;
  created_at: string;
  rule_id: string;
  rule_name: string;
  severity: Severity;
  score: number;
  title: string;
  description: string | null;
  mitre_id: string | null;
  mitre_tactic: string | null;
  mitre_technique: string | null;
  event_id: number | null;
  process_name: string | null;
  pid: number | null;
  user: string | null;
  status: AlertStatus;
  incident_id: number | null;
  evidence: string | null; // raw JSON string; parsed in the drawer
}

export interface AlertEventRow extends EventRow {
  role: "trigger" | "supporting";
}

export interface AlertDetail extends AlertRow {
  events: AlertEventRow[];
}

export interface AlertStats {
  total: number;
  open: number;
  by_severity: Record<string, number>;
  by_status: Record<string, number>;
  last_24h: number;
  top_rules: { rule_id: string; rule_name: string; count: number }[];
}

export interface DetectionRule {
  id: string;
  name: string;
  severity: Severity;
  score: number;
  description: string;
  mitre_id: string;
  mitre_tactic: string;
  mitre_technique: string;
  event_types: string[];
  cooldown_seconds: number;
  enabled: boolean;
  alert_count: number;
  tactic_label: string | null;
}

// --- Phase 3: investigations --------------------------------------------

export type IncidentStatus =
  | "open"
  | "investigating"
  | "contained"
  | "closed"
  | "false_positive";

export interface IncidentRow {
  id: number;
  created_at: string;
  first_seen: string;
  last_seen: string;
  title: string;
  severity: Severity;
  score: number;
  status: IncidentStatus;
  root_pid: number | null;
  root_process: string | null;
  user: string | null;
  alert_count: number;
  tactics: string[];
  summary: string | null;
}

export interface ChainStep {
  step: number;
  id: number;
  timestamp: string;
  rule_id: string;
  rule_name: string;
  severity: Severity;
  score: number;
  title: string;
  status: AlertStatus;
  mitre_id: string | null;
  mitre_tactic: string | null;
  mitre_technique: string | null;
  tactic_label: string | null;
  process_name: string | null;
  pid: number | null;
  user: string | null;
}

export interface CaseNote {
  id: number;
  created_at: string;
  author: string | null;
  kind: "note" | "status_change" | "system";
  body: string;
}

export interface IncidentDetail extends IncidentRow {
  chain: ChainStep[];
  notes: CaseNote[];
  tactic_labels: Record<string, string>;
}

export interface IncidentStats {
  total: number;
  active: number;
  by_status: Record<string, number>;
  by_severity: Record<string, number>;
  highest_score: number;
}

export interface ProcessTreeNode {
  event_id: number;
  pid: number | null;
  parent_pid: number | null;
  process_name: string | null;
  parent_process: string | null;
  user: string | null;
  started_at: string;
  terminated_at: string | null;
  status: "running" | "terminated";
  command_line: string | null;
  executable_path: string | null;
  severity: Severity;
  alert_count: number;
  max_alert_severity: Severity | null;
  truncated: boolean;
  children: ProcessTreeNode[];
}

export interface ProcessTree {
  focus_event_id: number;
  focus_pid: number | null;
  ancestor_count: number;
  root_is_complete: boolean;
  root: ProcessTreeNode;
}

export interface IncidentTree {
  incident_id: number;
  roots: ProcessTreeNode[];
  alert_pids: number[];
}

async function sendJson<T>(path: string, method: "POST" | "PATCH", body?: unknown): Promise<T> {
  const res = await fetch(API_BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    // FastAPI puts the useful part in `detail`; surface it rather than
    // a bare status code, since these calls are triage actions the
    // analyst needs to know succeeded or failed and why.
    let detail = `${res.status} ${res.statusText}`;
    try {
      const parsed = await res.json();
      if (parsed?.detail) detail = String(parsed.detail);
    } catch {
      /* non-JSON error body; the status line is all we have */
    }
    throw new Error(`${path} failed: ${detail}`);
  }
  return res.json();
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

export interface SystemStatus {
  sqlite_status: string;
  total_events: number;
  agent_version: string;
  running_collectors: number;
  agent_cpu_percent: number;
  agent_memory_mb: number;
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

  getSystemStatus: () => fetchJson<SystemStatus>("/system-status"),

  // --- Phase 2: detection ---
  getAlerts: (params: {
    skip?: number;
    limit?: number;
    severity?: string;
    status?: string;
    rule_id?: string;
    tactic?: string;
    incident_id?: number;
    search?: string;
    sort_by?: string;
    order?: string;
  } = {}) => fetchJson<PaginatedList<AlertRow>>("/alerts", params),

  getAlert: (id: number) => fetchJson<AlertDetail>(`/alerts/${id}`),

  getAlertStats: () => fetchJson<AlertStats>("/alerts/stats"),

  setAlertStatus: (id: number, status: AlertStatus) =>
    sendJson<AlertRow>(`/alerts/${id}`, "PATCH", { status }),

  getRules: () => fetchJson<DetectionRule[]>("/rules"),

  toggleRule: (id: string, enabled: boolean) =>
    sendJson<DetectionRule>(`/rules/${id}/toggle`, "POST", { enabled }),

  // --- Phase 3: investigations ---
  getIncidents: (params: {
    skip?: number;
    limit?: number;
    status?: string;
    severity?: string;
    search?: string;
    sort_by?: string;
    order?: string;
  } = {}) => fetchJson<PaginatedList<IncidentRow>>("/incidents", params),

  getIncident: (id: number) => fetchJson<IncidentDetail>(`/incidents/${id}`),

  getIncidentStats: () => fetchJson<IncidentStats>("/incidents/stats"),

  getIncidentTree: (id: number) => fetchJson<IncidentTree>(`/incidents/${id}/tree`),

  setIncidentStatus: (id: number, status: IncidentStatus, note?: string) =>
    sendJson<IncidentRow>(`/incidents/${id}`, "PATCH", { status, note }),

  addIncidentNote: (id: number, body: string) =>
    sendJson<CaseNote>(`/incidents/${id}/notes`, "POST", { body, author: "analyst" }),

  getProcessTree: (eventId: number) => fetchJson<ProcessTree>(`/process-tree/${eventId}`),

  getProcessTreeByPid: (pid: number, at?: string) =>
    fetchJson<ProcessTree>("/process-tree", { pid, at }),
};
