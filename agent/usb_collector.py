"""
agent/usb_collector.py

Collects USB drive insertion/removal via Win32_VolumeChangeEvent.

Why this over Win32_PnPEntity creation events:
- Win32_PnPEntity fires for every plug-and-play device (USB mice,
  keyboards, hubs, bluetooth, etc.) — very noisy, needs class filtering
  to isolate storage devices.
- Win32_VolumeChangeEvent fires specifically on drive letter mount/
  unmount, which is what "USB inserted/removed" means for a storage
  device in practice. Simpler, matches the requirement directly.
  (Trade-off: won't catch non-storage USB devices like keyboards —
  acceptable, this collector is about removable media.)

EventType values: 1=Config changed, 2=Device arrival, 3=Device removal,
4=Docking.

Win32_VolumeChangeEvent is an intrinsic WMI event class, so the query
needs a WITHIN polling clause (the WMI provider itself polls internally
at that interval — this isn't our own poll loop).

Requires: pywin32.
"""

import sys
import json
import datetime as dt
from pathlib import Path

import pythoncom
import win32com.client

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
from app.db.database import insert_event, init_db  # noqa: E402

EVENT_TYPE_MAP = {
    2: "usb_insert",
    3: "usb_remove",
}


def _utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds")


def run():
    init_db()
    pythoncom.CoInitialize()
    try:
        wmi = win32com.client.GetObject(r"winmgmts:root\cimv2")
        watcher = wmi.ExecNotificationQuery(
            "SELECT * FROM Win32_VolumeChangeEvent WITHIN 2"
        )
        print("USB collector running. Ctrl+C to stop.")
        while True:
            event = watcher.NextEvent()  # blocking; Ctrl+C handled below
            event_type = event.Properties_("EventType").Value
            drive_name = event.Properties_("DriveName").Value

            mapped_type = EVENT_TYPE_MAP.get(event_type)
            if mapped_type is None:
                continue  # config-change/docking events, not USB storage

            insert_event(
                timestamp=_utc_now(),
                event_type=mapped_type,
                process_name=None,
                parent_process=None,
                pid=None,
                user=None,
                severity="Information",
                details=json.dumps({"drive": drive_name}),
            )
            print(f"{mapped_type}: {drive_name}")
    except KeyboardInterrupt:
        print("Stopped.")
    finally:
        pythoncom.CoUninitialize()


if __name__ == "__main__":
    run()
