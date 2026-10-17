"""
Process lineage: walking the parent/child graph recorded in the events
table.

This is the shared foundation for two features that look unrelated but
ask the same question. Phase 3's process tree asks "what did this
process come from and what did it start?" so an analyst can see an
intrusion's shape. Phase 2's incident correlation asks the same thing
to decide whether a new alert belongs to an existing case.

**pid reuse is the whole difficulty here.** Windows recycles pids, so
"the process with pid 4312" is not a unique thing over a 30-day window
— it may be a dozen different processes. Every lookup in this module is
therefore anchored to a point in time: the parent of a process started
at 14:02 is the *most recent* creation of that parent pid at or before
14:02, and a child only counts if it started while the parent was still
alive. Ignoring that produces trees where unrelated processes from last
Tuesday hang off today's shell.

Walks are bounded by MAX_DEPTH and MAX_NODES. The ancestor chain
terminates naturally at the boot-time process whose parent was never
recorded, but a pid-reuse cycle (A's parent resolves to B, B's to A)
is possible in principle, and an `explorer.exe` subtree can run to
thousands of nodes — neither should be able to hang a request.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional

MAX_DEPTH = 24
MAX_NODES = 600

# How long after a parent exits a child creation can still be attributed
# to it. Creation and termination events are written by two different
# WMI watcher threads, so their timestamps can land a few hundred
# milliseconds out of order for processes that start and die quickly.
# Without this grace period those children get orphaned out of the tree.
TERMINATION_GRACE_SECONDS = 2


@dataclass
class ProcNode:
    """One process instance — a single process_creation event, plus
    whatever we later learned about it."""

    event_id: int
    pid: Optional[int]
    parent_pid: Optional[int]
    process_name: Optional[str]
    parent_process: Optional[str]
    user: Optional[str]
    started_at: str
    terminated_at: Optional[str] = None
    command_line: Optional[str] = None
    executable_path: Optional[str] = None
    severity: str = "Information"
    alert_count: int = 0
    max_alert_severity: Optional[str] = None
    children: list["ProcNode"] = field(default_factory=list)
    truncated: bool = False  # subtree hit MAX_NODES / MAX_DEPTH

    @property
    def status(self) -> str:
        return "terminated" if self.terminated_at else "running"

    def to_dict(self) -> dict:
        return {
            "event_id": self.event_id,
            "pid": self.pid,
            "parent_pid": self.parent_pid,
            "process_name": self.process_name,
            "parent_process": self.parent_process,
            "user": self.user,
            "started_at": self.started_at,
            "terminated_at": self.terminated_at,
            "status": self.status,
            "command_line": self.command_line,
            "executable_path": self.executable_path,
            "severity": self.severity,
            "alert_count": self.alert_count,
            "max_alert_severity": self.max_alert_severity,
            "truncated": self.truncated,
            "children": [c.to_dict() for c in self.children],
        }


def _plus_seconds(timestamp: str, seconds: int) -> str:
    """Shift an ISO timestamp, preserving its exact format so string
    comparison against the indexed `timestamp` column stays valid."""
    try:
        return (
            datetime.fromisoformat(timestamp) + timedelta(seconds=seconds)
        ).isoformat(timespec="milliseconds")
    except ValueError:
        return timestamp


_SELECT_NODE = """
    SELECT id, pid, parent_pid, process_name, parent_process, user, timestamp, severity,
           json_extract(details, '$.command_line')    AS command_line,
           json_extract(details, '$.executable_path') AS executable_path
      FROM events
     WHERE event_type = 'process_creation'
"""


def _row_to_node(row) -> ProcNode:
    return ProcNode(
        event_id=row["id"],
        pid=row["pid"],
        parent_pid=row["parent_pid"],
        process_name=row["process_name"],
        parent_process=row["parent_process"],
        user=row["user"],
        started_at=row["timestamp"],
        command_line=row["command_line"],
        executable_path=row["executable_path"],
        severity=row["severity"],
    )


def node_by_event_id(conn, event_id: int) -> Optional[ProcNode]:
    row = conn.execute(_SELECT_NODE + " AND id = ?", (event_id,)).fetchone()
    return _row_to_node(row) if row else None


def node_for_pid_at(conn, pid: int, at_timestamp: str) -> Optional[ProcNode]:
    """The process instance that held `pid` at the given moment.

    The most recent creation at or before that time — which is what
    makes this safe against pid reuse. A still-running process from an
    hour ago wins over one created later; a creation *after* the
    timestamp cannot be the parent of something that already existed.
    """
    row = conn.execute(
        _SELECT_NODE + " AND pid = ? AND timestamp <= ? ORDER BY timestamp DESC LIMIT 1",
        (pid, at_timestamp),
    ).fetchone()
    return _row_to_node(row) if row else None


def termination_time(conn, pid: int, started_at: str) -> Optional[str]:
    """When this instance exited, if we saw it.

    Bounded below by the creation time so a termination belonging to an
    *earlier* use of the same pid is never attributed to this one.
    """
    row = conn.execute(
        """SELECT MIN(timestamp) AS ts FROM events
            WHERE event_type = 'process_termination' AND pid = ? AND timestamp >= ?""",
        (pid, started_at),
    ).fetchone()
    return row["ts"] if row and row["ts"] else None


def _alert_summary(conn, event_ids: list[int]) -> dict[int, tuple[int, str]]:
    """Alert count and worst severity per triggering event id, fetched
    for the whole tree in one query rather than per node — a 600-node
    tree would otherwise issue 600 round trips just to colour itself."""
    if not event_ids:
        return {}

    from .mitre import max_severity

    rows = conn.execute(
        """SELECT event_id, severity FROM alerts
            WHERE event_id IN ({})""".format(",".join("?" * len(event_ids))),
        event_ids,
    ).fetchall()

    summary: dict[int, tuple[int, str]] = {}
    for r in rows:
        count, worst = summary.get(r["event_id"], (0, "Information"))
        summary[r["event_id"]] = (count + 1, max_severity(worst, r["severity"]))
    return summary


def ancestors(conn, node: ProcNode, max_depth: int = MAX_DEPTH) -> list[ProcNode]:
    """Chain from `node`'s parent up towards the root, nearest first.

    Stops at the first pid we have no creation event for — on a machine
    where the collector started after boot, that is every long-running
    system process, and an incomplete chain is the honest answer.
    """
    chain: list[ProcNode] = []
    current = node
    seen: set[int] = {node.event_id}

    for _ in range(max_depth):
        if current.parent_pid is None:
            break
        parent = node_for_pid_at(conn, current.parent_pid, current.started_at)
        if parent is None or parent.event_id in seen:
            break  # unknown parent, or a pid-reuse loop
        seen.add(parent.event_id)
        parent.terminated_at = termination_time(conn, parent.pid, parent.started_at)
        chain.append(parent)
        current = parent

    return chain


def _children_rows(conn, pid: int, started_at: str, ended_at: Optional[str]):
    """Direct children of one process instance.

    The time bounds are what keep a later, unrelated process that
    happened to reuse this pid from inheriting its children. Indexed on
    parent_pid, which is exactly why that column exists.

    The upper bound is computed in Python rather than with SQLite's
    datetime(): that function returns "YYYY-MM-DD HH:MM:SS", and our
    timestamps are ISO-8601 with a "T". Comparing the two as strings
    puts every real timestamp above every datetime() result (T sorts
    after space), so the bound would silently exclude everything.
    """
    if ended_at:
        return conn.execute(
            _SELECT_NODE + """ AND parent_pid = ? AND timestamp >= ? AND timestamp <= ?
                           ORDER BY timestamp ASC""",
            (pid, started_at, _plus_seconds(ended_at, TERMINATION_GRACE_SECONDS)),
        ).fetchall()
    return conn.execute(
        _SELECT_NODE + " AND parent_pid = ? AND timestamp >= ? ORDER BY timestamp ASC",
        (pid, started_at),
    ).fetchall()


def build_subtree(conn, root: ProcNode, max_depth: int = MAX_DEPTH,
                  max_nodes: int = MAX_NODES) -> ProcNode:
    """Expand `root` downwards, breadth-first.

    Breadth-first rather than depth-first so that when a tree is too big
    to render in full, what survives truncation is the shallow structure
    an analyst reads first, not one arbitrarily deep branch.
    """
    root.terminated_at = termination_time(conn, root.pid, root.started_at) if root.pid else None

    queue: list[tuple[ProcNode, int]] = [(root, 0)]
    all_nodes: list[ProcNode] = [root]
    seen_event_ids: set[int] = {root.event_id}

    while queue:
        node, depth = queue.pop(0)
        if depth >= max_depth or node.pid is None:
            node.truncated = depth >= max_depth
            continue

        for row in _children_rows(conn, node.pid, node.started_at, node.terminated_at):
            if row["id"] in seen_event_ids:
                continue  # self-parenting row, or a cycle through reused pids
            if len(all_nodes) >= max_nodes:
                node.truncated = True
                queue.clear()
                break

            child = _row_to_node(row)
            child.terminated_at = termination_time(conn, child.pid, child.started_at)
            seen_event_ids.add(child.event_id)
            node.children.append(child)
            all_nodes.append(child)
            queue.append((child, depth + 1))

    summary = _alert_summary(conn, [n.event_id for n in all_nodes])
    for n in all_nodes:
        count, worst = summary.get(n.event_id, (0, None))
        n.alert_count = count
        n.max_alert_severity = worst

    return root


def lineage_pids(conn, pid: Optional[int], at_timestamp: str,
                 max_depth: int = MAX_DEPTH) -> set[int]:
    """The pid plus its ancestors' pids — the vertical slice an incident
    claims when it adopts an alert.

    Ancestors only, deliberately. Claiming every descendant too would
    mean a single alert on explorer.exe swallowing every process on the
    machine into one incident. Going upward instead means two alerts
    land in the same case when they share a lineage, which is the
    relationship that actually indicates a common origin.
    """
    if pid is None:
        return set()

    pids = {pid}
    node = node_for_pid_at(conn, pid, at_timestamp)
    if node is None:
        return pids

    for ancestor in ancestors(conn, node, max_depth=max_depth):
        if ancestor.pid is not None:
            pids.add(ancestor.pid)
    return pids
