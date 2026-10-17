import { useEffect, useState } from "react";
import { GitBranch, Info, X } from "lucide-react";
import { useProcessTree, type TreeTarget } from "../lib/useProcessTree";
import ProcessTree from "./ProcessTree";

const TRANSITION_MS = 250;

interface Props {
  target: TreeTarget | null;
  onClose: () => void;
}

/**
 * Process lineage in a slide-out, so a tree can be pulled up from
 * anywhere a process appears — the Processes table, an alert drawer,
 * an incident — without navigating away from what the analyst was
 * doing.
 *
 * Wider than the other drawers (max-w-3xl): a deep tree with command
 * lines needs horizontal room, and truncating the command line is the
 * one thing that would make the view useless.
 */
export default function ProcessTreeDrawer({ target, onClose }: Props) {
  const [renderedTarget, setRenderedTarget] = useState<TreeTarget | null>(null);
  const [visible, setVisible] = useState(false);
  const { tree, loading, error } = useProcessTree(target);

  useEffect(() => {
    if (target) {
      setRenderedTarget(target);
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    const timer = setTimeout(() => setRenderedTarget(null), TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [target]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && target && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, onClose]);

  if (!renderedTarget) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className={`absolute inset-0 bg-black/50 transition-opacity duration-250 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />
      <div
        className={`relative flex h-full w-full max-w-3xl flex-col border-l border-border bg-panel shadow-2xl transition-transform duration-250 ease-out ${
          visible ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2.5">
            <GitBranch className="h-5 w-5 text-text-secondary" />
            <div>
              <div className="text-sm font-semibold text-text-primary">Process Tree</div>
              <div className="font-mono text-xs text-text-muted">
                {renderedTarget.label ??
                  (renderedTarget.kind === "pid"
                    ? `pid ${renderedTarget.pid}`
                    : `event ${renderedTarget.eventId}`)}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-panel-hover hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="text-sm text-text-muted">Building process tree…</p>
          ) : error ? (
            <div className="rounded-lg border border-critical/30 bg-critical/5 px-3 py-2 text-sm text-critical">
              {error}
            </div>
          ) : !tree ? (
            <p className="text-sm text-text-muted">No lineage available for this process.</p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
                <span>
                  Ancestors walked:{" "}
                  <span className="font-mono text-text-secondary">{tree.ancestor_count}</span>
                </span>
                <span>
                  Root:{" "}
                  <span className="font-mono text-text-secondary">
                    {tree.root.process_name ?? "unknown"}
                  </span>
                </span>
              </div>

              {!tree.root_is_complete && (
                // The chain stopping early is a property of the
                // telemetry, not a bug, and saying so is better than
                // letting a partial tree read as the whole story.
                <div className="mb-3 flex items-start gap-2 rounded-lg border border-border bg-bg px-3 py-2 text-xs text-text-muted">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    The chain stops at{" "}
                    <span className="font-mono text-text-secondary">
                      {tree.root.process_name ?? "this process"}
                    </span>
                    , whose own parent was never recorded — it was already running before
                    the collector started.
                  </span>
                </div>
              )}

              <ProcessTree root={tree.root} focusEventId={tree.focus_event_id} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
