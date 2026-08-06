from fastapi import APIRouter, HTTPException, Query

from app import agent_manager

router = APIRouter(prefix="/agent", tags=["agent"])


def _validate_key(key: str):
    if key not in agent_manager.COLLECTORS:
        raise HTTPException(404, f"Unknown collector '{key}'. Valid: {list(agent_manager.COLLECTORS)}")


@router.get("")
def get_all_status():
    return agent_manager.status_all()


@router.get("/{key}")
def get_status(key: str):
    _validate_key(key)
    return agent_manager.status(key)


@router.post("/{key}/start")
def start_collector(key: str):
    _validate_key(key)
    return agent_manager.start(key)


@router.post("/{key}/stop")
def stop_collector(key: str):
    _validate_key(key)
    return agent_manager.stop(key)


@router.get("/{key}/logs")
def get_logs(key: str, lines: int = Query(20, ge=1, le=500)):
    _validate_key(key)
    return {"key": key, "lines": agent_manager.tail_log(key, lines)}
