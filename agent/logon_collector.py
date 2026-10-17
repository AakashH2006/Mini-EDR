"""
agent/logon_collector.py

Collects authentication activity from the Windows Security Event Log:

    4624  logon            a session was established
    4634  logoff           a session ended
    4625  logon_failed     authentication was refused
    4672  special_logon    a session was granted administrative privileges

4625 and 4672 are what make the Phase 2 authentication rules possible:
a brute-force attempt is only visible as a *run* of failures, and
privilege escalation is only visible if you know which sessions hold
privileged tokens. Collecting 4624/4634 alone would mean those two
rules could never fire.

Why the Security log over WMI Win32_LogonSession polling:
- Event log entries are pushed by the OS the moment they happen —
  exact timestamps, no polling gap.
- Win32_LogonSession polling can miss short sessions between polls and
  gives coarser timing.

Prerequisites (must be done once on the target machine):
1. Run as Administrator — the Security log is not readable by standard
   users by default.
2. Audit policy must be enabled for these events to be logged at all.
   Logon and failure auditing are on by default; Logoff auditing often
   is NOT on client Windows editions:
       auditpol /set /subcategory:"Logon" /success:enable /failure:enable
       auditpol /set /subcategory:"Logoff" /success:enable
       auditpol /set /subcategory:"Special Logon" /success:enable

Approach: poll the Security channel every few seconds with an XPath
filter on TimeCreated > last checkpoint, using the modern
EvtQuery/EvtNext/EvtRender API (returns event XML, which is parsed for
the fields we need — far more reliable than positional StringInserts
parsing, which shifts between Windows versions).

Requires: pywin32.
"""

import re
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
    "4625": "logon_failed",
    "4672": "special_logon",
}

# Windows logs a 4624 for SYSTEM and the two service accounts constantly
# — at boot, on every service start, on every scheduled task. They are
# not user activity and they would be the overwhelming majority of rows
# in the authentication category, so they're dropped at the collector
# rather than filtered in every query downstream.
#
# 4625 (a failure) and 4672 (privileges granted) are never dropped:
# a failed logon *for* a service account is exactly the anomaly worth
# seeing, and the privileged-logon rule does its own service-account
# filtering with the full picture available.
NOISE_ACCOUNTS = {"SYSTEM", "LOCAL SERVICE", "NETWORK SERVICE", "ANONYMOUS LOGON", "-"}
FILTERED_EVENT_TYPES = {"logon", "logoff"}

# Why a session was refused. The raw status codes in a 4625 are opaque;
# an analyst reading the alert wants the reason in words.
FAILURE_REASONS = {
    "0xc0000064": "No such user",
    "0xc000006a": "Wrong password",
    "0xc000006d": "Bad credentials",
    "0xc000006e": "Account restriction",
    "0xc000006f": "Logon outside permitted hours",
    "0xc0000070": "Logon from disallowed workstation",
    "0xc0000071": "Password expired",
    "0xc0000072": "Account disabled",
    "0xc0000133": "Clock skew between client and server",
    "0xc0000193": "Account expired",
    "0xc0000224": "Password change required",
    "0xc0000234": "Account locked out",
}

# The numeric LogonType in 4624/4625. Type 10 (RDP) and type 3
# (network) are the ones that matter for remote access questions.
LOGON_TYPES = {
    "2": "Interactive",
    "3": "Network",
    "4": "Batch",
    "5": "Service",
    "7": "Unlock",
    "8": "NetworkCleartext",
    "9": "NewCredentials",
    "10": "RemoteInteractive (RDP)",
    "11": "CachedInteractive",
}


def _utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds")


_FRACTION = re.compile(r"\.(\d+)")


def _normalise_timestamp(system_time: str | None) -> str:
    """Windows SystemTime -> the same ISO format every other collector
    writes.

    The event log renders times like '2026-08-07T06:59:48.5479221Z':
    100-nanosecond precision and a 'Z' suffix, where the other
    collectors emit milliseconds and '+00:00'. Detection compares
    timestamps as strings against the indexed `timestamp` column (an
    index range scan, where strftime() on every row would be a full
    table scan), and string comparison is only a correct ordering if
    every writer uses one format. So this collector converts rather
    than storing what Windows handed it.
    """
    if not system_time:
        return _utc_now()
    try:
        text = system_time.strip()
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        # fromisoformat accepts at most 6 fractional digits; Windows
        # emits 7. Truncate the fraction without disturbing whatever
        # UTC offset follows it.
        match = _FRACTION.search(text)
        if match:
            text = text[: match.start()] + "." + match.group(1)[:6] + text[match.end():]
        parsed = dt.datetime.fromisoformat(text)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        return parsed.astimezone(dt.timezone.utc).isoformat(timespec="milliseconds")
    except ValueError:
        # An unparseable timestamp must not cost us the event; arrival
        # time is a close enough approximation at a 5s poll interval.
        return _utc_now()


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


def _poll_since(since_iso: str):
    """XPath filter: only events newer than our last checkpoint, and
    only the event IDs we care about."""
    ids = " or ".join(f"EventID={eid}" for eid in EVENT_TYPE_MAP)
    xpath = f"*[System[({ids}) and TimeCreated[@SystemTime>'{since_iso}']]]"
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


def _build_details(mapped_type: str, fields: dict) -> dict:
    """Event-type-specific fields for the details blob. Each rule reads
    named keys out of this, so what's included here is what detection
    and the UI can see."""
    logon_type = fields.get("LogonType")
    details = {
        "logon_type": logon_type,
        "logon_type_label": LOGON_TYPES.get(str(logon_type), None),
        "logon_id": fields.get("TargetLogonId"),
    }

    if mapped_type in ("logon", "logon_failed"):
        details.update(
            {
                "source_address": fields.get("IpAddress"),
                "source_port": fields.get("IpPort"),
                "workstation": fields.get("WorkstationName"),
                "logon_process": fields.get("LogonProcessName"),
                "auth_package": fields.get("AuthenticationPackageName"),
            }
        )

    if mapped_type == "logon_failed":
        status = (fields.get("SubStatus") or fields.get("Status") or "").lower()
        details["status_code"] = status
        details["failure_reason"] = FAILURE_REASONS.get(status, "Unknown")

    if mapped_type == "special_logon":
        details["privileges"] = fields.get("PrivilegeList")

    return details


def run():
    init_db()
    print(
        f"Logon collector running (4624/4634/4625/4672, poll every "
        f"{POLL_INTERVAL_SECONDS}s). Ctrl+C to stop."
    )
    checkpoint = dt.datetime.now(dt.timezone.utc).isoformat()

    try:
        while True:
            time.sleep(POLL_INTERVAL_SECONDS)
            new_checkpoint = dt.datetime.now(dt.timezone.utc).isoformat()

            try:
                events = _poll_since(checkpoint)
            except Exception as exc:
                print(f"Security log read failed (run as Administrator?): {exc}")
                checkpoint = new_checkpoint
                continue

            for evt in events:
                xml_str = win32evtlog.EvtRender(evt, win32evtlog.EvtRenderEventXml)
                root = ET.fromstring(xml_str)
                event_id = root.findtext(".//e:System/e:EventID", namespaces=NS)
                time_created = root.find(".//e:System/e:TimeCreated", NS)
                sys_time = time_created.get("SystemTime") if time_created is not None else None

                mapped_type = EVENT_TYPE_MAP.get(event_id)
                if mapped_type is None:
                    continue

                fields = _event_data_dict(xml_str)
                username = fields.get("TargetUserName")
                domain = fields.get("TargetDomainName")

                if (
                    mapped_type in FILTERED_EVENT_TYPES
                    and (username or "").upper() in NOISE_ACCOUNTS
                ):
                    continue

                user = f"{domain}\\{username}" if domain and username else username

                insert_event(
                    timestamp=_normalise_timestamp(sys_time),
                    event_type=mapped_type,
                    process_name=None,
                    parent_process=None,
                    pid=None,
                    user=user,
                    severity="Information",
                    details=json.dumps(_build_details(mapped_type, fields)),
                )

            checkpoint = new_checkpoint
    except KeyboardInterrupt:
        print("Stopped.")


if __name__ == "__main__":
    run()
