# Mini EDR

A lightweight endpoint detection and response tool — Windows agent → SQLite → FastAPI → React, with live updates over WebSockets.

**Current scope (Phase 3):** collects endpoint telemetry, scores it against a rule-based detection engine mapped to MITRE ATT&CK, and correlates the resulting alerts into investigable cases with process lineage and attack-chain reconstruction.

What it is *not*: there is no machine learning, no anomaly scoring, and no automated response — nothing here kills a process or isolates a host. Detection is rule-based, so it recognises patterns it has been told about and will miss a technique no rule describes. The rule pack and its false-positive trade-offs are visible in the dashboard and documented in `backend/app/detection/rules.py`.

## Architecture

```
Windows
  │
  ▼
Python Agent (4 collectors) ──► SQLite (WAL mode, 30-day retention)
  │                                       │
  │                        ┌──────────────┴──────────────┐
  │                        ▼                             ▼
  │                 Detection engine              FastAPI (REST + WS)
  │                 (rules → alerts →                    │
  │                  incidents)                          │
  │                        └──────────────┬──────────────┘
  │                                       ▼
  └────────────── controlled by ──► React Dashboard
```

- **Agent → SQLite**: each collector writes events directly to the database. No in-memory queue — SQLite is the durable buffer, so an agent crash doesn't lose data.
- **Detection → SQLite**: a background task in the API reads new events, scores them against the rule pack, writes alerts, raises the triggering event's severity, and groups related alerts into incidents.
- **FastAPI → SQLite**: the API only reads. Two independent background cursors poll for new rows — one broadcasting events to the dashboard, one feeding detection.
- **Dashboard → API**: REST for page loads/pagination, WebSocket for live events, alerts and incident updates. The dashboard can also start/stop the collector subprocesses directly (Settings page).

### Two cursors, on purpose

The event poller starts at the current `MAX(id)` so clients see live activity rather than a replay of history. The detection poller resumes from a cursor persisted in the database, so an API restart re-scores nothing already scored and skips nothing written while it was down.

A consequence worth naming: an event reaches the dashboard a moment before its verdict does, so a row can appear as `Information` and then turn red. Rather than hide that by delaying every event until it has been scored, the engine emits an `event_update` message and the table re-colours the row in place. Detection latency is real and the UI shows it.

## Features

### Telemetry (Phase 1)
- **Activity Explorer** — live event table: search, category filters, sortable columns, pagination, details drawer, pause/resume live feed
- **Processes** — every process instance, correlated from creation/termination events, with a lineage view per row
- **Network** — outbound connections, active/idle status
- **Timeline** — chronological feed grouped by hour
- **Settings** — connection status, retention policy, per-collector Start/Stop with live log tail

### Detection (Phase 2)
- **21 detection rules** across 10 ATT&CK tactics — encoded PowerShell, LOLBin downloads, credential dumping, shadow-copy deletion, defence tampering, masquerading binaries, discovery bursts, C2 connections, brute force, removable-media execution and more
- **Severity scoring** — each alert carries a severity tier and a 0–100 risk score; the triggering event's own severity is raised to match, so the existing event table colours itself from detection output
- **Alert dashboard** — triage queue sorted worst-first, with filters, summary cards, an evidence drawer showing exactly which values matched, and a four-state triage workflow
- **Rule management** — enable/disable any rule from Settings, with live hit counts

### Behavioral analysis (Phase 3)
- **Process correlation** — `parent_pid` is a real indexed column, and every lookup is anchored to a point in time so recycled pids never graft unrelated processes onto a tree
- **Process trees** — full ancestor-and-descendant lineage for any process, with alert counts and severity per node, reachable from the Processes table, any alert, or a case
- **Attack chains** — a case's alerts laid out by ATT&CK tactic in kill-chain order, with the stages never reached shown as gaps
- **Investigation workflow** — cases open automatically when alerts share a process lineage, carry a status (open → investigating → contained → closed), and keep analyst notes and status history in one chronological record

### How alerts become cases

Shared process lineage inside a 30-minute window. If a macro in Word spawned PowerShell, which disabled Defender and then dumped credentials, those alerts fire on three different pids — but all three trace back through the same ancestry to `winword.exe`. Walking up from each alert and looking for an overlap is what connects them.

Only Medium and above open a case; a Low alert joins one that already exists but never creates one, so the case list keeps meaning "things worth looking at". An incident's score is its worst alert raised by how many tactics it spans, which orders the queue better than severity alone — a High spanning six stages outranks a Critical that fired once.

## Tech stack

| Layer | Stack |
|---|---|
| Agent | Python, WMI (`pywin32`), `psutil`, Windows Security Event Log |
| Detection | Python (rules as predicates, no DSL), SQLite correlation |
| Backend | Python, FastAPI, SQLite, WebSockets |
| Frontend | React, TypeScript, Tailwind CSS, Vite |

## Project structure

```
mini-edr/
├── agent/                    # Windows telemetry collectors (run as Administrator)
│   ├── process_collector.py     WMI process creation/termination trace
│   ├── network_collector.py     psutil connection polling
│   ├── usb_collector.py         WMI volume change events
│   └── logon_collector.py       Security Event Log (4624/4634/4625/4672)
├── backend/
│   ├── requirements.txt
│   ├── scripts/
│   │   └── seed_demo_attack.py  synthetic intrusion for demos/testing
│   └── app/
│       ├── main.py               FastAPI app, CORS, startup/shutdown
│       ├── agent_manager.py      spawns/stops collector subprocesses
│       ├── ws_manager.py         WebSocket client registry
│       ├── ws_poller.py          DB → WebSocket broadcast loop
│       ├── db/database.py        schema, migrations, indices, retention
│       ├── detection/
│       │   ├── rules.py           the 21-rule pack
│       │   ├── engine.py          rule evaluation, alert persistence, dedup
│       │   ├── correlation.py     alerts → incidents, attack chains
│       │   ├── lineage.py         process tree walking (pid-reuse safe)
│       │   ├── mitre.py           ATT&CK tactics + the severity model
│       │   └── poller.py          detection background loop + backfill
│       └── routers/
│           ├── events.py         GET /events, /events/{id}
│           ├── stats.py          GET /stats
│           ├── processes.py      GET /processes
│           ├── connections.py    GET /connections
│           ├── alerts.py         GET/PATCH /alerts/*
│           ├── incidents.py      GET/PATCH/POST /incidents/*
│           ├── rules.py          GET /rules, POST /rules/{id}/toggle
│           ├── tree.py           GET /process-tree/*
│           ├── agent.py          GET/POST /agent/* (start/stop/logs)
│           └── ws.py             WS /ws
└── frontend/
    └── src/
        ├── lib/                 API client, WS provider, data hooks
        ├── components/          tables, drawers, attack chain, process tree
        └── pages/               Activity Explorer, Alerts, Investigations,
                                 Processes, Network, Timeline, Settings
```

## Setup

### 1. Backend

```powershell
cd backend
python -m venv venv
venv\Scripts\activate
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

Runs on `http://localhost:8000`. For full telemetry visibility (WMI process trace, Security log, elevated network connections) and to control collectors from the Settings page, **run this terminal as Administrator**.

The database upgrades itself on startup: new tables are created, the `parent_pid` column is added to an existing `events` table and backfilled from the JSON details blob. No manual migration step.

### 2. Frontend

```powershell
cd frontend
npm install
npm run dev
```

Opens on `http://localhost:5173`.

### 3. Agent

**Option A — from the dashboard (recommended):** with the backend running as Administrator, go to **Settings → Collectors** and hit Start on each one. Logs are visible inline if something fails (most commonly: not elevated, or logoff auditing not enabled — see below).

**Option B — manually, per collector:**
```powershell
cd mini-edr
python -m venv agent-venv
agent-venv\Scripts\activate
python -m pip install pywin32 psutil
python agent\process_collector.py
```
Run each collector in its own terminal, as Administrator.

**One-time setup for logon events:** Windows doesn't audit logoff or special-logon events by default. Enable them with:
```powershell
auditpol /set /subcategory:"Logon" /success:enable /failure:enable
auditpol /set /subcategory:"Logoff" /success:enable
auditpol /set /subcategory:"Special Logon" /success:enable
```

### 4. Seeing detection work

A normal machine doing normal things is exactly what the rules are built *not* to fire on, so a fresh install shows an empty alert list. To see the detection engine, attack chains and process trees with something to work on:

```powershell
cd backend
python scripts\seed_demo_attack.py
```

This writes the events a phishing-to-ransomware intrusion would leave behind — no payload, nothing executed, just rows in SQLite. It produces 24 alerts and two cases: a Critical one spanning all ten tactics, and a separate High for the credential-spraying activity, which has no process lineage in common with the rest. Every row is tagged, so it removes cleanly:

```powershell
python scripts\seed_demo_attack.py --reset
```

## Known simplifications

- **Detection is signature-shaped.** Rules match on command-line content, process relationships and paths. An attacker who renames their binary and avoids the indicator strings will not trip them. Phase 4's ML layer is the answer to that, not more string matching.
- **`EDR-011` (execution from a user-writable directory) is noisy by design.** Installers legitimately run from Temp. It's Medium with a one-hour cooldown keyed on the path, and is meant as context that sharpens other findings rather than a finding on its own.
- Process trees are only as deep as the collector's uptime — a process that was already running when collection started has no creation event, so the chain ends there. The UI says so rather than presenting a partial chain as complete.
- `active_connections` and `running_processes` in `/stats` are derived heuristics (recency window / creation-without-termination), not live OS state queries.
- Network collector polls every 5s; very short-lived connections between polls can be missed.
- No authentication on the API — this is a single-user, local-network tool. Don't expose it to the internet as-is.
- Agent and backend are expected to share a filesystem (agent writes directly to the SQLite file).

## Roadmap

- ~~**Phase 1** — telemetry collection and visualization~~ ✅
- ~~**Phase 2** — rule-based detection, severity scoring, alert dashboard~~ ✅
- ~~**Phase 3** — process correlation, process trees, attack chains, investigation workflow~~ ✅
- **Phase 4** — explainable AI: ML-based detection, SHAP explanations, risk scoring on learned behaviour rather than fixed rules

## License

Personal portfolio project — no license specified.
