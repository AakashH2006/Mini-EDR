"""
Manages the four collector scripts as child processes of the API
process, so the dashboard can start/stop telemetry collection without
the user opening terminals.

Important scoping note: this manager only knows about processes *it*
spawned. If you started a collector manually from a terminal earlier,
this won't see or control it — the two are independent. Restarting the
API won't leave orphans either way: on shutdown we terminate anything
we started (see main.py's shutdown handler).

Privilege note: spawning a subprocess does NOT elevate it — a child
inherits the parent's token. If the API itself isn't running as
Administrator, the process/USB/logon collectors will start but fail
fast with an access-denied error, visible via the log tail. The
network collector (psutil) works unelevated, just with less visibility
into other users' connections.
"""

import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

AGENT_DIR = Path(__file__).resolve().parent.parent.parent / "agent"
LOG_DIR = Path(__file__).resolve().parent.parent / "data" / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

# Windows-only flag to stop a console window flashing up per collector;
# no-op (0) on other platforms since the attribute doesn't exist there.
_CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


@dataclass
class CollectorHandle:
    key: str
    name: str
    script: str
    process: Optional[subprocess.Popen] = field(default=None, repr=False)
    started_at: Optional[float] = None


COLLECTORS: dict[str, CollectorHandle] = {
    "process": CollectorHandle("process", "Process Collector", "process_collector.py"),
    "network": CollectorHandle("network", "Network Collector", "network_collector.py"),
    "usb": CollectorHandle("usb", "USB Collector", "usb_collector.py"),
    "logon": CollectorHandle("logon", "Logon Collector", "logon_collector.py"),
}


def _log_path(key: str) -> Path:
    return LOG_DIR / f"{key}.log"


def start(key: str) -> dict:
    handle = COLLECTORS[key]

    if handle.process and handle.process.poll() is None:
        return status(key)  # already running — idempotent

    script_path = AGENT_DIR / handle.script
    log_file = open(_log_path(key), "w")  # truncate: fresh log per run

    handle.process = subprocess.Popen(
        [sys.executable, str(script_path)],
        stdout=log_file,
        stderr=subprocess.STDOUT,
        cwd=str(script_path.parent),
        creationflags=_CREATE_NO_WINDOW,
    )
    handle.started_at = time.time()
    return status(key)


def stop(key: str) -> dict:
    handle = COLLECTORS[key]
    if handle.process and handle.process.poll() is None:
        handle.process.terminate()
        try:
            handle.process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            handle.process.kill()  # didn't exit cleanly, force it
    return status(key)


def status(key: str) -> dict:
    handle = COLLECTORS[key]
    running = bool(handle.process and handle.process.poll() is None)
    return {
        "key": handle.key,
        "name": handle.name,
        "running": running,
        "pid": handle.process.pid if running else None,
        "returncode": handle.process.poll() if handle.process and not running else None,
        "started_at": handle.started_at if running else None,
    }


def status_all() -> list[dict]:
    return [status(key) for key in COLLECTORS]


def tail_log(key: str, lines: int = 20) -> list[str]:
    path = _log_path(key)
    if not path.exists():
        return []
    with open(path, "r", errors="replace") as f:
        content = f.readlines()
    return [line.rstrip("\n") for line in content[-lines:]]


def stop_all() -> None:
    for key in COLLECTORS:
        stop(key)