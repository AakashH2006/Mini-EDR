import asyncio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db.database import init_db, purge_old_events
from app.routers import events, stats, processes, connections, ws
from app.ws_poller import event_poll_loop

app = FastAPI(title="Mini EDR API", version="0.1.0")

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
    purge_old_events()  # enforce 30-day retention on every boot
    asyncio.create_task(event_poll_loop())


app.include_router(events.router, tags=["events"])
app.include_router(stats.router, tags=["stats"])
app.include_router(processes.router, tags=["processes"])
app.include_router(connections.router, tags=["connections"])
app.include_router(ws.router, tags=["websocket"])


@app.get("/")
def root():
    return {"status": "ok", "service": "mini-edr-api", "version": app.version}
