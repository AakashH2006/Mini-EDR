"""
The Phase 2 rule pack.

Each rule is a dataclass holding its metadata plus a `check` callable.
Rules are plain functions over one event (with a DB handle for the few
that need to correlate across events) rather than a config DSL: at this
size a DSL would be more code than the rules it expresses, and a Python
predicate can say things ("the drive letter in this path is currently a
mounted USB volume") that a comparison grammar could not.

Two shapes of rule:

- **Single-event rules** look only at the event in front of them —
  command-line content, parent/child pairing, executable path. Cheap,
  so they run on every matching event.
- **Correlation rules** (R009, R012, R015) count related events inside
  a sliding window. They cost a query each, so each one is gated behind
  a cheap single-event pre-filter: the discovery-burst query only runs
  once the event is already a known discovery tool.

Windowed queries anchor on the *triggering event's* timestamp, never
`now()`. During backfill the engine replays historical events, and a
window measured from the wall clock would find nothing for all of them.

Noise control is `cooldown_seconds` plus a per-rule dedup entity (see
engine.py). A burst of fifty child processes under one exploited parent
is one alert, not fifty.

Severity/score are the rule's assessment in isolation. Correlation into
incidents (Phase 3) is where a Medium that co-occurs with a Critical
starts to matter more than its own score suggests.
"""

from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Callable, Optional

# --- Rule plumbing ------------------------------------------------------


@dataclass
class RuleContext:
    """Everything a check function is handed.

    The lowercased fields are precomputed once per event rather than
    inside each rule: nearly every rule does a substring test against
    the command line, and lowercasing it eighteen times per event is
    pure waste.
    """

    event: dict
    details: dict
    conn: object  # sqlite3.Connection; typed loosely to keep this module import-light

    event_type: str = ""
    process: str = ""          # lowercased process_name, "" if absent
    parent: str = ""           # lowercased parent process NAME, "" if unresolved
    cmdline: str = ""          # lowercased command line
    path: str = ""             # lowercased executable path
    user: str = ""             # lowercased user

    @classmethod
    def build(cls, event: dict, details: dict, conn) -> "RuleContext":
        parent_raw = (event.get("parent_process") or "").lower()
        # The collector falls back to "pid:1234" when it can't resolve a
        # parent's name from its cache. That's a placeholder, not a
        # process called "pid:1234" — rules must not match on it.
        parent = "" if parent_raw.startswith("pid:") else parent_raw

        return cls(
            event=event,
            details=details,
            conn=conn,
            event_type=event.get("event_type") or "",
            process=(event.get("process_name") or "").lower(),
            parent=parent,
            cmdline=(details.get("command_line") or "").lower(),
            path=(details.get("executable_path") or "").lower(),
            user=(event.get("user") or "").lower(),
        )

    def window_start(self, seconds: int) -> str:
        """ISO timestamp `seconds` before this event, for windowed queries.

        All collectors emit the same ISO-8601 format (millisecond
        precision, +00:00 offset), so string comparison against the
        indexed `timestamp` column is a correct ordering and an index
        range scan — which is why this returns a string rather than
        making the query call strftime() on every row.
        """
        from datetime import datetime

        ts = datetime.fromisoformat(self.event["timestamp"])
        return (ts - timedelta(seconds=seconds)).isoformat(timespec="milliseconds")


@dataclass
class Match:
    """A rule firing. `title` is instance-specific (names the actual
    process/user/host), while the rule's own name and description stay
    generic — an alert list reads much better when every row says what
    happened rather than repeating the rule name."""

    title: str
    evidence: dict = field(default_factory=dict)
    severity: Optional[str] = None       # override the rule's base severity
    score: Optional[int] = None          # override the rule's base score
    dedup_entity: Optional[str] = None   # defaults to the pid in engine.py
    extra_event_ids: tuple[int, ...] = ()


@dataclass
class Rule:
    id: str
    name: str
    severity: str                 # Low | Medium | High | Critical
    score: int                    # 0-100, the rule's standalone risk weight
    description: str
    mitre_id: str
    mitre_tactic: str
    mitre_technique: str
    event_types: tuple[str, ...]  # which events this rule is offered
    check: Callable[[RuleContext], Optional[Match]]
    cooldown_seconds: int = 300   # same rule + same entity stays quiet this long


# --- Shared vocabulary --------------------------------------------------

SHELLS = {"cmd.exe", "powershell.exe", "pwsh.exe"}

SCRIPT_HOSTS = {"wscript.exe", "cscript.exe", "mshta.exe"}

# Signed Microsoft binaries routinely abused to execute or fetch code
# ("living off the land"). Their presence isn't suspicious; what they
# are asked to do is.
LOLBINS = {
    "certutil.exe", "bitsadmin.exe", "regsvr32.exe", "rundll32.exe",
    "msiexec.exe", "installutil.exe", "mshta.exe", "msbuild.exe",
    "regasm.exe", "regsvcs.exe", "curl.exe", "wget.exe",
}

# Applications that open untrusted content from the internet. A shell
# descending from one of these is the classic phishing-payload shape.
CONTENT_APPS = {
    "winword.exe", "excel.exe", "powerpnt.exe", "outlook.exe", "msaccess.exe",
    "onenote.exe", "mspub.exe", "visio.exe", "acrord32.exe", "acrobat.exe",
    "chrome.exe", "msedge.exe", "firefox.exe", "iexplore.exe",
    "7zfm.exe", "winrar.exe", "explorer.exe",
}

SUSPICIOUS_CHILDREN = SHELLS | SCRIPT_HOSTS | LOLBINS

# Core Windows binaries that must live in System32/SysWOW64. A copy
# anywhere else wearing one of these names is masquerading.
SYSTEM_BINARIES = {
    "svchost.exe", "lsass.exe", "services.exe", "csrss.exe", "winlogon.exe",
    "smss.exe", "wininit.exe", "taskhostw.exe", "spoolsv.exe", "dllhost.exe",
    "conhost.exe", "rundll32.exe", "lsaiso.exe", "fontdrvhost.exe",
}

SYSTEM_DIRS = ("\\windows\\system32\\", "\\windows\\syswow64\\", "\\windows\\winsxs\\")

# User-writable directories: a program running from one of these was
# dropped there, not installed. Legitimate installers pass through here
# too, which is why this rule is Medium and heavily deduplicated.
SUSPECT_DIRS = (
    "\\appdata\\local\\temp\\",
    "\\windows\\temp\\",
    "\\users\\public\\",
    "\\downloads\\",
    "\\$recycle.bin\\",
    "\\programdata\\temp\\",
    "\\perflogs\\",
)

DISCOVERY_TOOLS = {
    "whoami.exe", "net.exe", "net1.exe", "ipconfig.exe", "systeminfo.exe",
    "nltest.exe", "tasklist.exe", "netstat.exe", "arp.exe", "route.exe",
    "quser.exe", "query.exe", "hostname.exe", "dsquery.exe", "nbtstat.exe",
    "wmic.exe", "reg.exe",
}

# Ports strongly associated with tooling defaults or covert channels
# rather than ordinary application traffic.
SUSPICIOUS_PORTS = {
    4444: "Metasploit default handler",
    4445: "Metasploit alternate handler",
    1337: "Common backdoor/tooling port",
    31337: "Historic backdoor port",
    9001: "Tor ORPort",
    9050: "Tor SOCKS proxy",
    6667: "IRC, legacy botnet C2",
    6666: "IRC, legacy botnet C2",
    1080: "SOCKS proxy",
    8888: "Common ad-hoc listener",
}


def _any_in(haystack: str, needles) -> Optional[str]:
    """First needle present in haystack, or None. Returning the needle
    (not a bool) lets the caller put the matched indicator straight into
    the alert's evidence, so the analyst sees *what* matched."""
    for n in needles:
        if n in haystack:
            return n
    return None


def _is_external_ip(addr: Optional[str]) -> bool:
    """True for routable internet addresses only.

    Loopback, RFC1918, link-local and multicast are excluded: a C2 or
    beaconing rule that fires on 127.0.0.1 or a LAN print server is
    noise, and local traffic is the overwhelming majority of what the
    network collector sees.
    """
    if not addr:
        return False
    try:
        ip = ipaddress.ip_address(addr)
    except ValueError:
        return False
    return not (
        ip.is_private or ip.is_loopback or ip.is_link_local
        or ip.is_multicast or ip.is_reserved or ip.is_unspecified
    )


def _mounted_removable_drives(ctx: RuleContext) -> set[str]:
    """Drive letters inserted and not yet removed as of this event.

    Same insert-minus-remove shape /stats uses for its USB count, but
    bounded by the event's own timestamp so a backfill sees the state
    as it was at the time, not as it is now.
    """
    rows = ctx.conn.execute(
        """SELECT json_extract(details, '$.drive') AS drive
             FROM events
            WHERE event_type = 'usb_insert' AND timestamp <= ?
           EXCEPT
           SELECT json_extract(details, '$.drive')
             FROM events
            WHERE event_type = 'usb_remove' AND timestamp <= ?""",
        (ctx.event["timestamp"], ctx.event["timestamp"]),
    ).fetchall()
    return {str(r["drive"]).lower().rstrip("\\") for r in rows if r["drive"]}


# --- Rule implementations -----------------------------------------------
#
# Each returns a Match when the pattern holds, None otherwise. Keeping
# them as module-level functions (rather than lambdas in the registry)
# means each one has somewhere to explain the false positives it knows
# it has.


def _check_content_app_spawns_shell(ctx: RuleContext) -> Optional[Match]:
    if ctx.parent not in CONTENT_APPS or ctx.process not in SUSPICIOUS_CHILDREN:
        return None
    # explorer.exe launches shells constantly — that's a user double-
    # clicking a terminal, not an exploit. Only count it when the child
    # is something nobody opens on purpose.
    if ctx.parent == "explorer.exe" and ctx.process in SHELLS:
        return None
    return Match(
        title=f"{ctx.parent} spawned {ctx.process}",
        evidence={
            "parent_process": ctx.parent,
            "child_process": ctx.process,
            "command_line": ctx.details.get("command_line"),
        },
    )


_ENCODED_PS_FLAG = re.compile(r"\s-(?:e|en|enc|ec|encodedcommand)\s+[a-z0-9+/=]{24,}")


def _check_encoded_powershell(ctx: RuleContext) -> Optional[Match]:
    if ctx.process not in {"powershell.exe", "pwsh.exe"}:
        return None
    if not _ENCODED_PS_FLAG.search(ctx.cmdline):
        return None
    # The concealment flags that usually travel with it. They don't gate
    # the match (encoding alone is enough) but each one raises confidence.
    stealth = [f for f in ("-w hidden", "-windowstyle hidden", "-nop", "-noprofile",
                           "-noni", "-noninteractive", "bypass") if f in ctx.cmdline]
    return Match(
        title="PowerShell executed a base64-encoded command",
        evidence={
            "command_line": ctx.details.get("command_line"),
            "stealth_flags": stealth,
        },
        severity="Critical" if stealth else "High",
        score=88 if stealth else 75,
    )


_DOWNLOAD_INDICATORS = (
    "certutil -urlcache", "certutil.exe -urlcache", "-urlcache", "-decode",
    "bitsadmin /transfer", "bitsadmin.exe /transfer",
    "downloadstring", "downloadfile", "invoke-webrequest", "iwr ", "wget ",
    "net.webclient", "start-bitstransfer", "curl -o", "curl.exe -o",
    "regsvr32 /i:http", "regsvr32.exe /i:http", "/i:http",
)


def _check_lolbin_download(ctx: RuleContext) -> Optional[Match]:
    indicator = _any_in(ctx.cmdline, _DOWNLOAD_INDICATORS)
    if not indicator:
        return None
    # mshta/rundll32 pointed straight at a URL is the same behaviour in
    # a different wrapper.
    if ctx.process not in LOLBINS and ctx.process not in SHELLS:
        return None
    return Match(
        title=f"{ctx.process} used to download remote content",
        evidence={
            "indicator": indicator,
            "command_line": ctx.details.get("command_line"),
        },
    )


def _check_remote_hosted_script(ctx: RuleContext) -> Optional[Match]:
    if ctx.process not in {"mshta.exe", "rundll32.exe", "regsvr32.exe"}:
        return None
    scheme = _any_in(ctx.cmdline, ("http://", "https://", "javascript:", "vbscript:", "\\\\"))
    if not scheme:
        return None
    return Match(
        title=f"{ctx.process} executed a remotely hosted script",
        evidence={"scheme": scheme, "command_line": ctx.details.get("command_line")},
    )


_RECOVERY_TAMPERING = (
    "vssadmin delete shadows", "vssadmin.exe delete shadows",
    "shadowcopy delete", "delete shadows",
    "wbadmin delete catalog", "wbadmin delete systemstatebackup",
    "bcdedit /set {default} recoveryenabled no", "recoveryenabled no",
    "bootstatuspolicy ignoreallfailures",
    "wmic shadowcopy delete",
)


def _check_recovery_tampering(ctx: RuleContext) -> Optional[Match]:
    indicator = _any_in(ctx.cmdline, _RECOVERY_TAMPERING)
    if not indicator:
        return None
    return Match(
        title="Backup or shadow copy deletion attempted",
        evidence={"indicator": indicator, "command_line": ctx.details.get("command_line")},
    )


_DEFENSE_TAMPERING = (
    "set-mppreference -disablerealtimemonitoring",
    "disablerealtimemonitoring $true", "disablerealtimemonitoring 1",
    "add-mppreference -exclusionpath", "-exclusionextension", "-exclusionprocess",
    "stop windefend", "config windefend", "stop sense", "stop wscsvc",
    "advfirewall set allprofiles state off", "netsh firewall set opmode disable",
    "set-service -name windefend", "uninstall-windowsfeature windows-defender",
)


def _check_defense_tampering(ctx: RuleContext) -> Optional[Match]:
    indicator = _any_in(ctx.cmdline, _DEFENSE_TAMPERING)
    if not indicator:
        return None
    return Match(
        title="Security control tampering attempted",
        evidence={"indicator": indicator, "command_line": ctx.details.get("command_line")},
    )


# Matched against the command line with the invoking binary already
# stripped off conceptually — these are fragments of the *arguments*,
# not whole command lines. "save hklm\sam" rather than "reg save
# hklm\sam", because Windows resolves `reg` and `reg.exe` to the same
# thing and the command line records whichever the caller typed.
_CRED_ACCESS = (
    "sekurlsa", "mimikatz", "lsadump", "logonpasswords",
    "comsvcs.dll, minidump", "comsvcs.dll minidump",
    "-ma lsass", "/ma lsass", "-accepteula -ma lsass",
    "save hklm\\sam", "save hklm\\system", "save hklm\\security",
    "ntdsutil", "ifm create full", "vaultcmd /list",
)


def _check_credential_access(ctx: RuleContext) -> Optional[Match]:
    indicator = _any_in(ctx.cmdline, _CRED_ACCESS)
    if not indicator:
        return None
    return Match(
        title="Credential dumping indicators in command line",
        evidence={"indicator": indicator, "command_line": ctx.details.get("command_line")},
    )


_LOG_CLEARING = (
    "wevtutil cl ", "wevtutil.exe cl ", "clear-eventlog", "wevtutil clear-log",
    "remove-eventlog", "clear-history", "fsutil usn deletejournal",
)


def _check_log_clearing(ctx: RuleContext) -> Optional[Match]:
    indicator = _any_in(ctx.cmdline, _LOG_CLEARING)
    if not indicator:
        return None
    return Match(
        title="Event log clearing attempted",
        evidence={"indicator": indicator, "command_line": ctx.details.get("command_line")},
    )


_PERSISTENCE = (
    "schtasks /create", "schtasks.exe /create", "register-scheduledtask",
    "currentversion\\run", "currentversion\\runonce",
    "sc create", "sc.exe create", "new-service",
    "\\start menu\\programs\\startup", "currentversion\\explorer\\shell folders",
    "wmic /namespace:\\\\root\\subscription",
)


def _check_persistence(ctx: RuleContext) -> Optional[Match]:
    indicator = _any_in(ctx.cmdline, _PERSISTENCE)
    if not indicator:
        return None
    return Match(
        title=f"Persistence mechanism created via {ctx.process or 'unknown process'}",
        evidence={"indicator": indicator, "command_line": ctx.details.get("command_line")},
    )


_REMOTE_EXEC = (
    "psexec", "paexec", "psexesvc", "winrs ", "winrs.exe",
    "/node:", "process call create", "invoke-command -computername",
    "enter-pssession", "invoke-wmimethod -computername", "-computername",
)


def _check_remote_execution(ctx: RuleContext) -> Optional[Match]:
    indicator = _any_in(ctx.cmdline, _REMOTE_EXEC)
    if not indicator:
        return None
    return Match(
        title=f"Remote execution tooling invoked ({ctx.process or 'unknown process'})",
        evidence={"indicator": indicator, "command_line": ctx.details.get("command_line")},
    )


def _check_suspicious_location(ctx: RuleContext) -> Optional[Match]:
    if not ctx.path:
        return None
    directory = _any_in(ctx.path, SUSPECT_DIRS)
    if not directory:
        return None
    return Match(
        title=f"{ctx.process} executed from {directory.strip(chr(92))}",
        evidence={"executable_path": ctx.details.get("executable_path"), "directory": directory},
        # Keyed on the path, not the pid: an installer that re-runs the
        # same temp binary a dozen times is one finding, and the hour-long
        # cooldown below means it stays one finding.
        dedup_entity=ctx.path,
    )


def _check_masquerading(ctx: RuleContext) -> Optional[Match]:
    if ctx.process not in SYSTEM_BINARIES or not ctx.path:
        return None
    if any(d in ctx.path for d in SYSTEM_DIRS):
        return None
    return Match(
        title=f"{ctx.process} running from a non-system directory",
        evidence={
            "executable_path": ctx.details.get("executable_path"),
            "expected_directories": list(SYSTEM_DIRS),
        },
    )


def _check_svchost_parent(ctx: RuleContext) -> Optional[Match]:
    """svchost.exe is started by the Service Control Manager and nothing
    else. A different parent means either process hollowing or something
    pretending to be svchost.

    Only fires when the parent name actually resolved — an unresolved
    parent (the "pid:1234" placeholder, already normalised to "" by
    RuleContext) is missing data, not evidence.
    """
    if ctx.process != "svchost.exe" or not ctx.parent:
        return None
    if ctx.parent in {"services.exe", "svchost.exe"}:
        return None
    return Match(
        title=f"svchost.exe spawned by {ctx.parent} instead of services.exe",
        evidence={"parent_process": ctx.parent, "expected_parent": "services.exe"},
    )


DISCOVERY_BURST_THRESHOLD = 4
DISCOVERY_BURST_WINDOW_SECONDS = 300


def _check_discovery_burst(ctx: RuleContext) -> Optional[Match]:
    """Any one of these tools is unremarkable on its own — admins run
    whoami and ipconfig all day. Running four *different* ones within
    five minutes is the shape of an operator orienting themselves on a
    freshly accessed host.

    Counted by distinct tool name, not invocation count: a script
    looping `net view` a hundred times is one tool, not a sweep.
    """
    if ctx.process not in DISCOVERY_TOOLS:
        return None

    rows = ctx.conn.execute(
        """SELECT id, process_name
             FROM events
            WHERE event_type = 'process_creation'
              AND timestamp BETWEEN ? AND ?
              AND lower(process_name) IN ({})""".format(
            ",".join("?" * len(DISCOVERY_TOOLS))
        ),
        (
            ctx.window_start(DISCOVERY_BURST_WINDOW_SECONDS),
            ctx.event["timestamp"],
            *sorted(DISCOVERY_TOOLS),
        ),
    ).fetchall()

    distinct = {(r["process_name"] or "").lower() for r in rows}
    if len(distinct) < DISCOVERY_BURST_THRESHOLD:
        return None

    return Match(
        title=f"{len(distinct)} distinct discovery tools run within 5 minutes",
        evidence={
            "tools": sorted(distinct),
            "window_seconds": DISCOVERY_BURST_WINDOW_SECONDS,
            "invocations": len(rows),
        },
        # One burst, one alert, regardless of which tool happened to be
        # the fourth — the pid of that tool is incidental.
        dedup_entity=f"host:{ctx.event.get('user') or 'any'}",
        extra_event_ids=tuple(r["id"] for r in rows),
    )


def _check_shell_external_connection(ctx: RuleContext) -> Optional[Match]:
    """A command interpreter or script host talking to the internet.

    These are not network clients. powershell.exe reaching a routable
    address is either a download or a C2 channel, and either way it is
    worth an analyst's attention.
    """
    if ctx.process not in (SHELLS | SCRIPT_HOSTS | {"rundll32.exe", "regsvr32.exe",
                                                    "certutil.exe", "bitsadmin.exe"}):
        return None
    remote = ctx.details.get("remote_addr")
    if not _is_external_ip(remote):
        return None
    return Match(
        title=f"{ctx.process} connected to external host {remote}",
        evidence={
            "remote_addr": remote,
            "remote_port": ctx.details.get("remote_port"),
            "local_port": ctx.details.get("local_port"),
        },
    )


def _check_suspicious_port(ctx: RuleContext) -> Optional[Match]:
    remote = ctx.details.get("remote_addr")
    port = ctx.details.get("remote_port")
    if port not in SUSPICIOUS_PORTS or not _is_external_ip(remote):
        return None
    return Match(
        title=f"Outbound connection to {remote}:{port}",
        evidence={
            "remote_addr": remote,
            "remote_port": port,
            "why": SUSPICIOUS_PORTS[port],
        },
    )


SCAN_DISTINCT_HOSTS = 15
SCAN_WINDOW_SECONDS = 120


def _check_network_scan(ctx: RuleContext) -> Optional[Match]:
    """One process reaching many distinct hosts in a short window.

    Distinct *addresses*, not connections: a browser opens dozens of
    sockets to a handful of CDN endpoints and must not look like a
    sweep. Fifteen separate destinations in two minutes from a single
    pid is scanning behaviour.
    """
    pid = ctx.event.get("pid")
    if pid is None:
        return None

    rows = ctx.conn.execute(
        """SELECT id, json_extract(details, '$.remote_addr') AS addr
             FROM events
            WHERE event_type = 'network_connection'
              AND pid = ?
              AND timestamp BETWEEN ? AND ?""",
        (pid, ctx.window_start(SCAN_WINDOW_SECONDS), ctx.event["timestamp"]),
    ).fetchall()

    hosts = {r["addr"] for r in rows if r["addr"]}
    if len(hosts) < SCAN_DISTINCT_HOSTS:
        return None

    return Match(
        title=f"{ctx.process or f'pid {pid}'} contacted {len(hosts)} hosts in 2 minutes",
        evidence={
            "distinct_hosts": len(hosts),
            "sample": sorted(hosts)[:12],
            "window_seconds": SCAN_WINDOW_SECONDS,
        },
        extra_event_ids=tuple(r["id"] for r in rows),
    )


FAILED_LOGON_THRESHOLD = 5
FAILED_LOGON_WINDOW_SECONDS = 300


def _check_failed_logon_burst(ctx: RuleContext) -> Optional[Match]:
    user = ctx.event.get("user")
    if not user:
        return None

    rows = ctx.conn.execute(
        """SELECT id FROM events
            WHERE event_type = 'logon_failed'
              AND user = ?
              AND timestamp BETWEEN ? AND ?""",
        (user, ctx.window_start(FAILED_LOGON_WINDOW_SECONDS), ctx.event["timestamp"]),
    ).fetchall()

    if len(rows) < FAILED_LOGON_THRESHOLD:
        return None

    return Match(
        title=f"{len(rows)} failed logons for {user} in 5 minutes",
        evidence={
            "user": user,
            "attempts": len(rows),
            "logon_type": ctx.details.get("logon_type"),
            "window_seconds": FAILED_LOGON_WINDOW_SECONDS,
        },
        dedup_entity=f"user:{user}",
        extra_event_ids=tuple(r["id"] for r in rows),
    )


# Accounts that are *supposed* to hold privileged tokens. Windows logs
# a special-privileges event for these continuously at boot and on every
# service start; without this filter the rule would fire thousands of
# times a day and mean nothing.
SERVICE_ACCOUNTS = {"system", "local service", "network service", "dwm-1", "dwm-2", "umfd-0", "umfd-1"}


def _check_privileged_logon(ctx: RuleContext) -> Optional[Match]:
    user = (ctx.event.get("user") or "")
    bare = user.split("\\")[-1].lower()
    if not bare or bare in SERVICE_ACCOUNTS:
        return None
    # Machine accounts (DOMAIN\HOST$) are computers authenticating, not
    # people escalating.
    if bare.endswith("$"):
        return None
    return Match(
        title=f"Privileged logon session created for {user}",
        evidence={"user": user, "privileges": ctx.details.get("privileges"),
                  "logon_id": ctx.details.get("logon_id")},
        dedup_entity=f"user:{bare}",
    )


def _check_removable_media(ctx: RuleContext) -> Optional[Match]:
    drive = ctx.details.get("drive")
    return Match(
        title=f"Removable drive {drive or '?'} mounted",
        evidence={"drive": drive},
        dedup_entity=f"drive:{drive}",
    )


def _check_execution_from_removable(ctx: RuleContext) -> Optional[Match]:
    """A binary launched from a drive that is currently a mounted
    removable volume. Needs the USB collector running to fire at all —
    without an insert event there's nothing to match the drive letter
    against, and the rule simply stays silent rather than guessing."""
    if not ctx.path or len(ctx.path) < 2 or ctx.path[1] != ":":
        return None
    drive = ctx.path[:2]
    if drive in ("c:",):
        return None
    if drive not in _mounted_removable_drives(ctx):
        return None
    return Match(
        title=f"{ctx.process} executed from removable drive {drive.upper()}",
        evidence={"drive": drive.upper(), "executable_path": ctx.details.get("executable_path")},
    )


# --- The pack -----------------------------------------------------------

RULES: list[Rule] = [
    Rule(
        id="EDR-001",
        name="Content Application Spawned Shell",
        severity="High",
        score=78,
        description=(
            "An application that opens untrusted content (Office, a browser, a PDF "
            "reader, an archive tool) started a command interpreter or script host. "
            "This is the standard shape of a malicious document or drive-by payload "
            "executing its first stage."
        ),
        mitre_id="T1204.002",
        mitre_tactic="execution",
        mitre_technique="User Execution: Malicious File",
        event_types=("process_creation",),
        check=_check_content_app_spawns_shell,
    ),
    Rule(
        id="EDR-002",
        name="Encoded PowerShell Command",
        severity="High",
        score=75,
        description=(
            "PowerShell was invoked with a base64-encoded command block. Encoding "
            "hides the payload from casual log review and from command-line string "
            "matching; legitimate administration almost never needs it."
        ),
        mitre_id="T1059.001",
        mitre_tactic="execution",
        mitre_technique="Command and Scripting Interpreter: PowerShell",
        event_types=("process_creation",),
        check=_check_encoded_powershell,
    ),
    Rule(
        id="EDR-003",
        name="LOLBin Used to Download Content",
        severity="High",
        score=76,
        description=(
            "A signed Microsoft utility was used to retrieve a file from a remote "
            "host. Attackers prefer these over curl or a dropped downloader because "
            "they are already present and already trusted."
        ),
        mitre_id="T1105",
        mitre_tactic="command-and-control",
        mitre_technique="Ingress Tool Transfer",
        event_types=("process_creation",),
        check=_check_lolbin_download,
    ),
    Rule(
        id="EDR-004",
        name="Remotely Hosted Script Executed",
        severity="High",
        score=80,
        description=(
            "mshta, rundll32 or regsvr32 was pointed at a URL, a UNC path or an "
            "inline script scheme. Each of these can execute remote code without "
            "anything ever being written to disk."
        ),
        mitre_id="T1218",
        mitre_tactic="defense-evasion",
        mitre_technique="System Binary Proxy Execution",
        event_types=("process_creation",),
        check=_check_remote_hosted_script,
    ),
    Rule(
        id="EDR-005",
        name="Backup and Shadow Copy Deletion",
        severity="Critical",
        score=95,
        description=(
            "Volume shadow copies, backup catalogs or boot recovery options were "
            "deleted or disabled. This is ransomware's standard preparation step: "
            "remove the victim's ability to roll back before encrypting."
        ),
        mitre_id="T1490",
        mitre_tactic="impact",
        mitre_technique="Inhibit System Recovery",
        event_types=("process_creation",),
        check=_check_recovery_tampering,
    ),
    Rule(
        id="EDR-006",
        name="Security Control Tampering",
        severity="High",
        score=82,
        description=(
            "Real-time protection, a Defender exclusion, a security service or the "
            "firewall was modified or disabled from the command line. Attackers "
            "clear the way before deploying a payload that would otherwise be caught."
        ),
        mitre_id="T1562.001",
        mitre_tactic="defense-evasion",
        mitre_technique="Impair Defenses: Disable or Modify Tools",
        event_types=("process_creation",),
        check=_check_defense_tampering,
    ),
    Rule(
        id="EDR-007",
        name="Credential Dumping Indicators",
        severity="Critical",
        score=92,
        description=(
            "A command line referenced LSASS memory dumping, registry hive export "
            "or a known credential-theft tool. Successful credential access turns a "
            "single compromised host into movement across the network."
        ),
        mitre_id="T1003",
        mitre_tactic="credential-access",
        mitre_technique="OS Credential Dumping",
        event_types=("process_creation",),
        check=_check_credential_access,
    ),
    Rule(
        id="EDR-008",
        name="Event Log Clearing",
        severity="High",
        score=84,
        description=(
            "A Windows event log was cleared. Outside of a deliberate, announced "
            "maintenance action there is no benign reason to destroy audit history, "
            "and it usually means something earlier in the log was worth hiding."
        ),
        mitre_id="T1070.001",
        mitre_tactic="defense-evasion",
        mitre_technique="Indicator Removal: Clear Windows Event Logs",
        event_types=("process_creation",),
        check=_check_log_clearing,
    ),
    Rule(
        id="EDR-009",
        name="Persistence Mechanism Created",
        severity="High",
        score=72,
        description=(
            "A scheduled task, service, Run key or startup-folder entry was created "
            "from the command line. Legitimate software does this at install time, "
            "so judge it by what created it and what it points at."
        ),
        mitre_id="T1053.005",
        mitre_tactic="persistence",
        mitre_technique="Scheduled Task/Job: Scheduled Task",
        event_types=("process_creation",),
        check=_check_persistence,
    ),
    Rule(
        id="EDR-010",
        name="Remote Execution Tooling",
        severity="High",
        score=74,
        description=(
            "PsExec, WinRS, WMI process creation or PowerShell remoting was used to "
            "run a command against another host. Normal for administrators, and "
            "equally normal for an operator moving laterally with stolen credentials."
        ),
        mitre_id="T1021",
        mitre_tactic="lateral-movement",
        mitre_technique="Remote Services",
        event_types=("process_creation",),
        check=_check_remote_execution,
    ),
    Rule(
        id="EDR-011",
        name="Execution From User-Writable Directory",
        severity="Medium",
        score=48,
        description=(
            "A program ran from Temp, Downloads, Public or another user-writable "
            "location rather than an installed program directory. Installers and "
            "updaters legitimately do this, so treat it as context that sharpens "
            "other findings rather than as a finding on its own."
        ),
        mitre_id="T1036",
        mitre_tactic="defense-evasion",
        mitre_technique="Masquerading",
        event_types=("process_creation",),
        check=_check_suspicious_location,
        # An hour, keyed on the path: installers re-run the same temp
        # binary repeatedly and would otherwise bury the alert list.
        cooldown_seconds=3600,
    ),
    Rule(
        id="EDR-012",
        name="System Binary in Non-System Path",
        severity="High",
        score=85,
        description=(
            "A core Windows binary name was found running from outside System32 or "
            "SysWOW64. The real binary never moves, so a copy elsewhere wearing its "
            "name is deliberately impersonating it."
        ),
        mitre_id="T1036.005",
        mitre_tactic="defense-evasion",
        mitre_technique="Masquerading: Match Legitimate Name or Location",
        event_types=("process_creation",),
        check=_check_masquerading,
    ),
    Rule(
        id="EDR-013",
        name="svchost.exe With Unexpected Parent",
        severity="High",
        score=80,
        description=(
            "svchost.exe is launched by the Service Control Manager (services.exe) "
            "and by nothing else. Another parent indicates process hollowing or a "
            "look-alike binary."
        ),
        mitre_id="T1055",
        mitre_tactic="defense-evasion",
        mitre_technique="Process Injection",
        event_types=("process_creation",),
        check=_check_svchost_parent,
    ),
    Rule(
        id="EDR-014",
        name="Host Discovery Burst",
        severity="Medium",
        score=55,
        description=(
            "Several different reconnaissance utilities ran in quick succession. "
            "Any one is routine; the cluster is what an operator does in the first "
            "minutes on a host they have just reached."
        ),
        mitre_id="T1082",
        mitre_tactic="discovery",
        mitre_technique="System Information Discovery",
        event_types=("process_creation",),
        check=_check_discovery_burst,
        cooldown_seconds=900,
    ),
    Rule(
        id="EDR-015",
        name="Interpreter Connected to External Host",
        severity="High",
        score=70,
        description=(
            "A shell, script host or proxy-execution binary opened a connection to "
            "a routable internet address. These are not network clients; such a "
            "connection is a download or a command channel."
        ),
        mitre_id="T1071",
        mitre_tactic="command-and-control",
        mitre_technique="Application Layer Protocol",
        event_types=("network_connection",),
        check=_check_shell_external_connection,
        cooldown_seconds=600,
    ),
    Rule(
        id="EDR-016",
        name="Connection to Suspicious Port",
        severity="Medium",
        score=58,
        description=(
            "An outbound connection targeted a port associated with offensive "
            "tooling defaults, IRC botnets, Tor or ad-hoc proxies rather than "
            "ordinary application traffic."
        ),
        mitre_id="T1571",
        mitre_tactic="command-and-control",
        mitre_technique="Non-Standard Port",
        event_types=("network_connection",),
        check=_check_suspicious_port,
        cooldown_seconds=600,
    ),
    Rule(
        id="EDR-017",
        name="Internal Network Scanning",
        severity="Medium",
        score=60,
        description=(
            "A single process contacted an unusual number of distinct hosts in a "
            "short window, the signature of a port or host sweep looking for the "
            "next target."
        ),
        mitre_id="T1046",
        mitre_tactic="discovery",
        mitre_technique="Network Service Discovery",
        event_types=("network_connection",),
        check=_check_network_scan,
        cooldown_seconds=600,
    ),
    Rule(
        id="EDR-018",
        name="Failed Logon Burst",
        severity="High",
        score=68,
        description=(
            "Repeated failed authentication attempts against one account in a short "
            "window: password guessing, a spray hitting this account, or stale "
            "credentials in a service that will keep retrying."
        ),
        mitre_id="T1110",
        mitre_tactic="credential-access",
        mitre_technique="Brute Force",
        event_types=("logon_failed",),
        check=_check_failed_logon_burst,
        cooldown_seconds=900,
    ),
    Rule(
        id="EDR-019",
        name="Privileged Logon Session",
        severity="Medium",
        score=42,
        description=(
            "A logon session was assigned administrative privileges by a non-service "
            "account. Expected for an admin doing admin work; meaningful when it "
            "appears next to activity nobody authorised."
        ),
        mitre_id="T1078.003",
        mitre_tactic="privilege-escalation",
        mitre_technique="Valid Accounts: Local Accounts",
        event_types=("special_logon",),
        check=_check_privileged_logon,
        cooldown_seconds=1800,
    ),
    Rule(
        id="EDR-020",
        name="Removable Media Mounted",
        severity="Low",
        score=25,
        description=(
            "A removable drive was attached. Logged on its own as the start of a "
            "possible data-transfer or malware-introduction path, and used as "
            "context for anything that subsequently runs from that drive."
        ),
        mitre_id="T1091",
        mitre_tactic="initial-access",
        mitre_technique="Replication Through Removable Media",
        event_types=("usb_insert",),
        check=_check_removable_media,
        cooldown_seconds=60,
    ),
    Rule(
        id="EDR-021",
        name="Execution From Removable Media",
        severity="High",
        score=77,
        description=(
            "A program was launched directly from a drive that is currently a "
            "mounted removable volume, rather than being copied and installed first. "
            "This is how removable media introduces code to a host."
        ),
        mitre_id="T1091",
        mitre_tactic="initial-access",
        mitre_technique="Replication Through Removable Media",
        event_types=("process_creation",),
        check=_check_execution_from_removable,
    ),
]

RULES_BY_ID: dict[str, Rule] = {r.id: r for r in RULES}

# Built once at import: the engine asks "which rules care about this
# event type?" for every single event, and scanning all twenty-one rules
# each time would make the hot path proportional to the pack size.
RULES_BY_EVENT_TYPE: dict[str, list[Rule]] = {}
for _rule in RULES:
    for _et in _rule.event_types:
        RULES_BY_EVENT_TYPE.setdefault(_et, []).append(_rule)
