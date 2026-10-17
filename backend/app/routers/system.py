from fastapi import APIRouter
from pydantic import BaseModel

from app.db.database import connection
from app import agent_manager

router = APIRouter(tags=["system"])


class SystemStatus(BaseModel):
    sqlite_status: str
    total_events: int
    agent_version: str
    running_collectors: int
    agent_cpu_percent: float
    agent_memory_mb: float


@router.get("/system-status", response_model=SystemStatus)
def get_system_status():
    try:
        with connection() as conn:
            total_events = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        sqlite_status = "Connected"
    except Exception as exc:
        total_events = 0
        sqlite_status = f"Error: {exc}"

    usage = agent_manager.resource_usage()

    return SystemStatus(
        sqlite_status=sqlite_status,
        total_events=total_events,
        agent_version=agent_manager.AGENT_VERSION,
        running_collectors=usage["running_collectors"],
        agent_cpu_percent=usage["cpu_percent"],
        agent_memory_mb=usage["memory_mb"],
    )
