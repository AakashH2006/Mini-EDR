# Mini-EDR
Mini EDR monitors endpoint activity on a Windows machine and provides real-time visibility into system events—process creation, network connections, USB insertions, and user logons—streamed live to a React dashboard via WebSockets.
<img width="1860" height="1021" alt="Mini-EDR dashboard" src="https://github.com/user-attachments/assets/c876a0b3-65d2-4f43-b3de-7e5e5fefa641" />
# Mini EDR – Phase 1: Endpoint Telemetry

A lightweight Endpoint Detection & Response (EDR) system built for learning modern endpoint security concepts. Phase 1 focuses on collecting endpoint telemetry, storing it efficiently, and presenting it through a professional SOC-style dashboard.

> **Current Status:** Phase 1 – Telemetry Collection & Visualization

---

## Overview

Mini EDR monitors endpoint activity on a Windows machine and provides real-time visibility into system events. The project is designed to evolve into a full EDR platform with rule-based detection, behavioral analytics, explainable AI, and automated response capabilities.

Phase 1 focuses only on **telemetry**, not threat detection.

---

## Features

### Endpoint Telemetry

- Process creation monitoring
- Process termination monitoring
- Active network connection monitoring
- USB device insertion/removal
- User logon/logoff events

### Live Dashboard

- Real-time event stream
- Global search
- Event filtering
- Pagination
- Sortable event table
- Activity timeline
- Investigation drawer
- Live WebSocket updates

### Dashboard Statistics

- Agent Status
- Events Today
- Running Processes
- Active Connections
- USB Devices

### Diagnostics

- Collector health monitoring
- Collector status
- Collector debug logs
- WebSocket status
- SQLite connection status

---

## Architecture

```text
Windows Endpoint
        │
        ▼
Python Telemetry Agent
        │
        ▼
SQLite Database
        │
        ▼
FastAPI Backend
        │
        ▼
React + TypeScript Dashboard
```

---

## Tech Stack

### Backend

- Python
- FastAPI
- SQLite
- WebSockets

### Frontend

- React
- TypeScript
- Vite
- Tailwind CSS

---
## Setup Instructions

### Prerequisites

- Python 3.11+
- Node.js 20+
- Git

### 1. Clone the Repository

```bash
git clone https://github.com/AakashH2006/mini-edr.git
cd mini-edr
```

### 2. Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --reload
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

### 4. Agent

```bash
cd agent
python main.py
```

### 5. Access the Dashboard

Open:

```
http://localhost:5173
```

Once the agent, backend, and frontend are running, the dashboard will begin displaying endpoint telemetry in real time.

## UI

### Dashboard Overview

<img width="1867" height="1027" alt="Detailed dashboard" src="https://github.com/user-attachments/assets/8d8cf04d-a89a-4758-b8d4-589167db4bfa" />

*Main Activity Explorer showing real-time event stream, statistics cards, and expanded event details.*

### Timeline View

<img width="1862" height="1042" alt="Timeline Mini-edr" src="https://github.com/user-attachments/assets/929472aa-84b1-434a-af44-52c135779581" />

*Chronological event feed grouped by hour for investigation workflows.*

### Settings & Diagnostics

<img width="1856" height="1028" alt="Mini-edr Settings" src="https://github.com/user-attachments/assets/d6738ba3-922c-4a70-ba87-24bc1dbca0b6" />

*Connection status, WebSocket health, and collector configuration.*

---

## Project Structure

```
mini-edr/
│
├── agent/
│   ├── collectors/
│   ├── database/
│   ├── models/
│   └── main.py
│
├── backend/
│   ├── api/
│   ├── websocket/
│   └── app.py
│
├── frontend/
│   ├── components/
│   ├── pages/
│   ├── hooks/
│   ├── services/
│   └── App.tsx
│
├── database/
│   └── events.db
│
└── README.md
```

---

## Event Pipeline

```
Windows Event

↓

Collector

↓

Normalize Event

↓

SQLite

↓

FastAPI

↓

WebSocket

↓

Dashboard
```

Every event is normalized into a common schema before storage.

---

## Current Event Types

- Process Created
- Process Terminated
- Network Connection
- USB Inserted
- USB Removed
- User Logon
- User Logoff

---

## Current Limitations

Phase 1 intentionally does **not** include:

- Threat Detection
- Rule Engine
- MITRE ATT&CK Mapping
- Machine Learning
- SHAP/LIME Explanations
- Automated Response
- Threat Intelligence

These features are planned for future phases.

---

# Roadmap

## ✅ Phase 1 — Endpoint Telemetry

- Endpoint collectors
- SQLite storage
- FastAPI backend
- React dashboard
- Live event streaming
- Search & filters
- Timeline
- Investigation drawer

---

## 🔜 Phase 2 — Detection Engine

- Rule-based detections
- Severity scoring
- Alert generation
- Alert dashboard

---

## 🔜 Phase 3 — Behavioral Analysis

- Process correlation
- Parent-child process trees
- Attack chain visualization
- Investigation workflows

---

## 🔜 Phase 4 — Explainable AI

- Machine Learning detection
- SHAP explanations
- Risk scoring
- Explainable alerts

---

## 🔜 Phase 5 — Response

- Process termination
- Network isolation
- Quarantine
- Automated response actions

---

## Goals

- Learn endpoint security internals
- Understand EDR architecture
- Build a production-inspired SOC dashboard
- Gain hands-on experience with Windows telemetry
- Create a strong cybersecurity portfolio project

---

## Disclaimer

Mini EDR is an educational project intended for learning endpoint security concepts. It is not intended to replace commercial EDR solutions or provide production-grade protection.
