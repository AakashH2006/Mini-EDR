import asyncio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db.database import init_db, purge_old_events, purge_old_detections
from app.routers import (
    events, stats, processes, connections, ws, agent, system,
    alerts, incidents, rules, tree,
)
from app.ws_poller import event_poll_loop
from app.detection.poller import detection_loop
from app import agent_manager

app = FastAPI(title="Mini EDR API", version="0.3.0")

# Local single-user tool — dashboard runs on a dev server (Vite, usually
# :5173) hitting this API on a different port, so CORS needs to be open
# for localhost. Tightened if this ever left one machine.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup():
    init_db()
    purge_old_events()      # enforce 30-day retention on every boot
    purge_old_detections()  # and drop alerts whose evidence just went

    # Two independent cursors over the events table, by design: the WS
    # poller starts at the newest row so clients see live activity, the
    # detection poller resumes from its saved position so nothing goes
    # unscored. See detection/poller.py.
    asyncio.create_task(event_poll_loop())
    asyncio.create_task(detection_loop())


@app.on_event("shutdown")
def on_shutdown():
    # Don't leave collector subprocesses orphaned if the API restarts
    # (e.g. uvicorn --reload picking up a code change).
    agent_manager.stop_all()


app.include_router(events.router, tags=["events"])
app.include_router(stats.router, tags=["stats"])
app.include_router(processes.router, tags=["processes"])
app.include_router(connections.router, tags=["connections"])
app.include_router(alerts.router, tags=["alerts"])
app.include_router(incidents.router, tags=["incidents"])
app.include_router(rules.router, tags=["rules"])
app.include_router(tree.router, tags=["process-tree"])
app.include_router(ws.router, tags=["websocket"])
app.include_router(agent.router)
app.include_router(system.router)


@app.get("/")
def root():
    return {"status": "ok", "service": "mini-edr-api", "version": app.version}
