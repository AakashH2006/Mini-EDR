import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ProcessTree } from "./api";

export type TreeTarget =
  | { kind: "event"; eventId: number; label?: string }
  | { kind: "pid"; pid: number; at?: string; label?: string };

/**
 * Lineage for one process, fetched on demand.
 *
 * `target` is a discriminated union because the two ways in differ in
 * what they can promise. An event id identifies exactly one process
 * instance. A pid does not — Windows reuses them — so that branch
 * carries an optional `at` timestamp telling the backend which
 * instance was meant (see lineage.node_for_pid_at).
 *
 * A null target clears the result instead of leaving the last tree on
 * screen, so a drawer that has been closed and reopened never shows
 * the previous process's lineage while the new one loads.
 */
/** Identity of a target by value, not reference.
 *
 *  Callers build the target object inline (`{ kind: "event", eventId }`),
 *  so it is a fresh object on every render and a reference dependency
 *  would refetch the tree continuously. This key changes only when the
 *  process actually being asked about changes. */
function targetKey(target: TreeTarget | null): string {
  if (!target) return "";
  return target.kind === "event"
    ? `event:${target.eventId}`
    : `pid:${target.pid}:${target.at ?? ""}`;
}

export function useProcessTree(target: TreeTarget | null) {
  const [tree, setTree] = useState<ProcessTree | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = targetKey(target);
  // The latest target, read inside load() without being a dependency —
  // `key` is what decides when a refetch is warranted.
  const targetRef = useRef(target);
  targetRef.current = target;

  const load = useCallback(async (current: TreeTarget | null) => {
    if (!current) {
      setTree(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setTree(
        current.kind === "event"
          ? await api.getProcessTree(current.eventId)
          : await api.getProcessTreeByPid(current.pid, current.at)
      );
    } catch (err) {
      setTree(null);
      setError(err instanceof Error ? err.message : "Failed to build process tree");
    } finally {
      setLoading(false);
    }
  }, []);

  // Refetch when the *identity* of the target changes, reading the
  // current object from the ref. Depending on the object itself would
  // refetch on every render; depending on nothing would leave a stale
  // tree on screen after the drawer is pointed at a different process.
  useEffect(() => {
    load(targetRef.current);
  }, [load, key]);

  const refetch = useCallback(() => load(targetRef.current), [load]);

  return { tree, loading, error, refetch };
}
