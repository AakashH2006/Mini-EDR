"""
agent/network_collector.py

Collects network connection events by polling psutil.net_connections()
and diffing against the previous snapshot.

Why polling instead of ETW/ncsi trace:
- psutil is cross-platform and gives PID-per-connection directly, no
  correlation step needed.
- Connection *state changes* (new sockets) are what matters for
  telemetry here, not packet-level detail — a 3-5s poll interval is
  fine for that and far simpler than an ETW provider subscription.
- Trade-off (documented per your choice): very short-lived connections
  between two polls can be missed. Acceptable for Phase 1 telemetry;
  revisit with ETW (Microsoft-Windows-TCPIP provider) if that gap
  matters later.

Requires: psutil (`pip install psutil`). On Windows, run elevated to
see connections owned by other users' processes.
"""

import sys
import json
import time
import datetime as dt
from pathlib import Path

import psutil

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
from app.db.database import insert_event, init_db  # noqa: E402

POLL_INTERVAL_SECONDS = 5

# Only log connections in these states — ESTABLISHED is the meaningful
# "a connection now exists" signal. LISTEN sockets are servers on the
# box, not outbound activity, and change rarely; skip them for noise.
TRACKED_STATES = {"ESTABLISHED"}


def _utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds")


def _process_name(pid: int | None) -> str | None:
    if pid is None:
        return None
    try:
        return psutil.Process(pid).name()
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        return None


def _snapshot() -> set[tuple]:
    """Returns a set of connection fingerprints for diffing between polls."""
    conns = set()
    try:
        for c in psutil.net_connections(kind="inet"):
            if c.status not in TRACKED_STATES or not c.raddr:
                continue
            conns.add((c.pid, c.laddr.ip, c.laddr.port, c.raddr.ip, c.raddr.port, c.status))
    except (psutil.AccessDenied, PermissionError):
        print("Access denied reading connections — run as Administrator for full visibility.")
    return conns


def run():
    init_db()
    print(f"Network collector running (poll every {POLL_INTERVAL_SECONDS}s). Ctrl+C to stop.")
    previous = _snapshot()
    try:
        while True:
            time.sleep(POLL_INTERVAL_SECONDS)
            current = _snapshot()
            new_conns = current - previous

            for pid, lip, lport, rip, rport, status in new_conns:
                insert_event(
                    timestamp=_utc_now(),
                    event_type="network_connection",
                    process_name=_process_name(pid),
                    parent_process=None,
                    pid=pid,
                    user=None,
                    severity="Information",
                    details=json.dumps(
                        {
                            "local_addr": lip,
                            "local_port": lport,
                            "remote_addr": rip,
                            "remote_port": rport,
                            "status": status,
                        }
                    ),
                )
            previous = current
    except KeyboardInterrupt:
        print("Stopped.")


if __name__ == "__main__":
    run()
