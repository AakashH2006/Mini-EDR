"""
agent/logon_collector.py

Collects user logon/logoff via the Windows Security Event Log
(Event ID 4624 = logon, 4634 = logoff).

Why the Security log over WMI Win32_LogonSession polling:
- Event log entries are pushed by the OS the moment they happen —
  exact timestamps, no polling gap.
- Win32_LogonSession polling can miss short sessions between polls and
  gives coarser timing.

Prerequisites (must be done once on the target machine):
1. Run as Administrator — the Security log is not readable by standard
   users by default.
2. Audit policy must be enabled for these events to be logged at all
   (Logon auditing is on by default; Logoff auditing often is NOT on
   client Windows editions):
       auditpol /set /subcategory:"Logon" /success:enable /failure:enable
       auditpol /set /subcategory:"Logoff" /success:enable

Approach: poll the Security channel every few seconds with an XPath
filter on TimeCreated > last checkpoint, using the modern
EvtQuery/EvtNext/EvtRender API (returns event XML, which is parsed for
the fields we need — far more reliable than positional StringInserts
parsing, which shifts between Windows versions).

Requires: pywin32.
"""

import sys
import json
import time
import datetime as dt
import xml.etree.ElementTree as ET
from pathlib import Path

import win32evtlog

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
from app.db.database import insert_event, init_db  # noqa: E402

POLL_INTERVAL_SECONDS = 5
CHANNEL = "Security"
NS = {"e": "http://schemas.microsoft.com/win/2004/08/events/event"}

EVENT_TYPE_MAP = {
    "4624": "logon",
    "4634": "logoff",
}


def _utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds")


def _event_data_dict(xml_str: str) -> dict:
    """Pulls <Data Name="X">value</Data> pairs out of the rendered event
    XML into a plain dict — robust to field-order differences across
    Windows versions, unlike positional StringInserts access."""
    root = ET.fromstring(xml_str)
    data = {}
    for elem in root.findall(".//e:EventData/e:Data", NS):
        name = elem.get("Name")
        if name:
            data[name] = elem.text
    return data


def _poll_since(handle, since_iso: str):
    """XPath filter: only events newer than our last checkpoint, and
    only the two event IDs we care about."""
    xpath = (
        f"*[System[(EventID=4624 or EventID=4634) and "
        f"TimeCreated[@SystemTime>'{since_iso}']]]"
    )
    query = win32evtlog.EvtQuery(
        CHANNEL, win32evtlog.EvtQueryChannelPath, xpath, win32evtlog.EvtQueryForwardDirection
    )
    events = []
    while True:
        batch = win32evtlog.EvtNext(query, 50)
        if not batch:
            break
        events.extend(batch)
    return events


def run():
    init_db()
    print(f"Logon collector running (poll every {POLL_INTERVAL_SECONDS}s). Ctrl+C to stop.")
    checkpoint = dt.datetime.now(dt.timezone.utc).isoformat()

    try:
        while True:
            time.sleep(POLL_INTERVAL_SECONDS)
            new_checkpoint = dt.datetime.now(dt.timezone.utc).isoformat()

            try:
                events = _poll_since(None, checkpoint)
            except Exception as exc:
                print(f"Security log read failed (run as Administrator?): {exc}")
                checkpoint = new_checkpoint
                continue

            for evt in events:
                xml_str = win32evtlog.EvtRender(evt, win32evtlog.EvtRenderEventXml)
                root = ET.fromstring(xml_str)
                event_id = root.findtext(".//e:System/e:EventID", namespaces=NS)
                time_created = root.find(".//e:System/e:TimeCreated", NS)
                sys_time = time_created.get("SystemTime") if time_created is not None else _utc_now()

                mapped_type = EVENT_TYPE_MAP.get(event_id)
                if mapped_type is None:
                    continue

                fields = _event_data_dict(xml_str)
                username = fields.get("TargetUserName")
                domain = fields.get("TargetDomainName")
                user = f"{domain}\\{username}" if domain and username else username

                insert_event(
                    timestamp=sys_time,
                    event_type=mapped_type,
                    process_name=None,
                    parent_process=None,
                    pid=None,
                    user=user,
                    severity="Information",
                    details=json.dumps(
                        {
                            "logon_type": fields.get("LogonType"),
                            "logon_id": fields.get("TargetLogonId"),
                        }
                    ),
                )

            checkpoint = new_checkpoint
    except KeyboardInterrupt:
        print("Stopped.")


if __name__ == "__main__":
    run()
