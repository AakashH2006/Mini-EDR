"""
agent/process_collector.py

Collects process creation + termination events via WMI trace classes
(Win32_ProcessStartTrace / Win32_ProcessStopTrace).

Why trace events instead of polling Win32_Process:
- Fire in real time off ETW (Event Tracing for Windows) — no polling
  interval, so short-lived processes aren't missed between polls.
- Win32_ProcessStartTrace exposes ParentProcessID + Sid directly, so
  parent linkage and user resolution don't need a second query per event.

Requirements:
- Windows, pywin32 (`pip install pywin32`)
- Must run elevated (Administrator) — WMI process trace subscriptions
  require it.

Each event type runs its own thread because ExecNotificationQuery's
NextEvent() is a blocking call — one thread per query keeps start and
stop events from blocking each other.
"""

import sys
import json
import threading
import datetime as dt
from pathlib import Path

import pythoncom
import win32com.client
import win32security

# Import the shared DB writer from the backend package.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
from app.db.database import insert_event, init_db  # noqa: E402

_stop_flag = threading.Event()

# pid -> process name, built up as start events arrive, so termination/
# parent-lookup events can resolve names without a fresh WMI query.
_pid_name_cache: dict[int, str] = {}
_cache_lock = threading.Lock()


def _utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds")


def _resolve_user(sid_bytes) -> str | None:
    """Best-effort SID -> DOMAIN\\username resolution. Trace events give
    a raw SID, not a username, so this avoids a second WMI round trip."""
    if not sid_bytes:
        return None
    try:
        sid = win32security.SID(sid_bytes)
        name, domain, _ = win32security.LookupAccountSid(None, sid)
        return f"{domain}\\{name}"
    except Exception:
        return None


def _handle_start_events():
    pythoncom.CoInitialize()
    try:
        wmi = win32com.client.GetObject(r"winmgmts:root\cimv2")
        watcher = wmi.ExecNotificationQuery("SELECT * FROM Win32_ProcessStartTrace")
        while not _stop_flag.is_set():
            try:
                event = watcher.NextEvent(1000)  # 1s timeout so we can check _stop_flag
            except pythoncom.com_error:
                continue  # timeout, loop again

            pid = event.Properties_("ProcessID").Value
            ppid = event.Properties_("ParentProcessID").Value
            name = event.Properties_("ProcessName").Value
            sid = event.Properties_("Sid").Value

            with _cache_lock:
                _pid_name_cache[pid] = name
                parent_name = _pid_name_cache.get(ppid, f"pid:{ppid}")

            insert_event(
                timestamp=_utc_now(),
                event_type="process_creation",
                process_name=name,
                parent_process=parent_name,
                pid=pid,
                user=_resolve_user(sid),
                severity="Information",
                details=json.dumps({"parent_pid": ppid}),
            )
    finally:
        pythoncom.CoUninitialize()


def _handle_stop_events():
    pythoncom.CoInitialize()
    try:
        wmi = win32com.client.GetObject(r"winmgmts:root\cimv2")
        watcher = wmi.ExecNotificationQuery("SELECT * FROM Win32_ProcessStopTrace")
        while not _stop_flag.is_set():
            try:
                event = watcher.NextEvent(1000)
            except pythoncom.com_error:
                continue

            pid = event.Properties_("ProcessID").Value
            name = event.Properties_("ProcessName").Value
            sid = event.Properties_("Sid").Value
            exit_status = event.Properties_("ExitStatus").Value

            insert_event(
                timestamp=_utc_now(),
                event_type="process_termination",
                process_name=name,
                parent_process=None,
                pid=pid,
                user=_resolve_user(sid),
                severity="Information",
                details=json.dumps({"exit_status": exit_status}),
            )

            with _cache_lock:
                _pid_name_cache.pop(pid, None)
    finally:
        pythoncom.CoUninitialize()


def run():
    init_db()
    threads = [
        threading.Thread(target=_handle_start_events, daemon=True),
        threading.Thread(target=_handle_stop_events, daemon=True),
    ]
    for t in threads:
        t.start()
    print("Process collector running. Ctrl+C to stop.")
    try:
        while True:
            threading.Event().wait(1)
    except KeyboardInterrupt:
        _stop_flag.set()
        for t in threads:
            t.join(timeout=2)
        print("Stopped.")


if __name__ == "__main__":
    run()
