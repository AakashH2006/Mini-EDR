"""
GET /process-tree/{event_id}   the full lineage around one process
GET /process-tree              lineage found by pid, or the noteworthy trees

Phase 3's answer to "where did this come from?". The Processes table
tells you a process ran; the tree tells you what started it, what it
started in turn, and which of those raised alerts — which is the
difference between a row and an explanation.

A tree is always returned rooted at the topmost *known* ancestor rather
than at the process asked about, with `focus_event_id` marking the one
that was asked for. An analyst clicking a suspicious powershell.exe
wants to see that it descended from winword.exe; starting the tree at
powershell.exe would hide precisely the fact that matters.

How far back "topmost known" reaches depends on when the collector
started: ancestors that were already running before then have no
creation event, so the chain ends there. That is a real boundary of the
telemetry, and the response reports it (`root_is_complete`) instead of
presenting a partial chain as a whole one.
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from app.db.database import connection
from app.detection import lineage

router = APIRouter()


def _tree_payload(conn, node: lineage.ProcNode) -> dict:
    chain = lineage.ancestors(conn, node)
    root_node = chain[-1] if chain else node
    tree = lineage.build_subtree(conn, root_node)

    return {
        "focus_event_id": node.event_id,
        "focus_pid": node.pid,
        "ancestor_count": len(chain),
        # True when we walked up to a process that genuinely had no
        # recorded parent, rather than stopping at one whose parent
        # predates the collector.
        "root_is_complete": root_node.parent_pid is None,
        "root": tree.to_dict(),
    }


@router.get("/process-tree/{event_id}")
def process_tree_by_event(event_id: int):
    with connection() as conn:
        node = lineage.node_by_event_id(conn, event_id)
        if node is None:
            raise HTTPException(
                404,
                "No process_creation event with that id. Trees are built from "
                "creation events; a termination or network event has no lineage.",
            )
        return _tree_payload(conn, node)


@router.get("/process-tree")
def process_tree(
    pid: Optional[int] = Query(None, description="resolve the instance of this pid"),
    at: Optional[str] = Query(
        None, description="ISO timestamp; which instance of a reused pid to resolve"
    ),
    limit: int = Query(10, ge=1, le=50),
):
    """With a pid: that process's tree. Without: the trees worth looking
    at — the distinct lineages that produced alerts, newest first."""
    with connection() as conn:
        if pid is not None:
            # Without `at`, resolve the most recent instance of the pid:
            # on a machine where pids have been reused, "now" is the one
            # the user means.
            anchor = at or conn.execute(
                "SELECT MAX(timestamp) FROM events"
            ).fetchone()[0]

            node = lineage.node_for_pid_at(conn, pid, anchor)
            if node is None:
                raise HTTPException(404, f"No process creation recorded for pid {pid}")
            return _tree_payload(conn, node)

        alert_rows = conn.execute(
            """SELECT DISTINCT a.pid, a.timestamp
                 FROM alerts a
                WHERE a.pid IS NOT NULL
             ORDER BY a.timestamp DESC
                LIMIT ?""",
            (limit * 4,),  # over-fetch: several alerts often share one lineage
        ).fetchall()

        trees: list[dict] = []
        seen_roots: set[int] = set()

        for row in alert_rows:
            if len(trees) >= limit:
                break
            node = lineage.node_for_pid_at(conn, row["pid"], row["timestamp"])
            if node is None:
                continue
            chain = lineage.ancestors(conn, node)
            root_node = chain[-1] if chain else node
            if root_node.event_id in seen_roots:
                continue
            seen_roots.add(root_node.event_id)
            trees.append(
                {
                    "focus_event_id": node.event_id,
                    "focus_pid": node.pid,
                    "ancestor_count": len(chain),
                    "root_is_complete": root_node.parent_pid is None,
                    "root": lineage.build_subtree(conn, root_node).to_dict(),
                }
            )

    return {"trees": trees}
