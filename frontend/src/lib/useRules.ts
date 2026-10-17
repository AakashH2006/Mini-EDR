import { useCallback, useEffect, useState } from "react";
import { api, type DetectionRule } from "./api";
import { onRefresh } from "./refreshBus";

/**
 * The detection rule pack and its enabled state.
 *
 * Toggling is optimistic with rollback rather than optimistic with a
 * refetch: this is a switch the analyst is watching, so it must move
 * the instant it is clicked, and if the call fails it must move back
 * rather than sit in a state the backend doesn't agree with.
 */
export function useRules() {
  const [rules, setRules] = useState<DetectionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRules(await api.getRules());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load detection rules");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => onRefresh(load), [load]);

  const toggle = useCallback(
    async (id: string, enabled: boolean) => {
      setPending((prev) => new Set(prev).add(id));
      setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled } : r)));
      try {
        const updated = await api.toggleRule(id, enabled);
        setRules((prev) => prev.map((r) => (r.id === id ? updated : r)));
      } catch (err) {
        setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: !enabled } : r)));
        setError(err instanceof Error ? err.message : `Failed to toggle ${id}`);
      } finally {
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    []
  );

  return { rules, loading, error, pending, toggle, refetch: load };
}
