import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Circle, Dot } from "lucide-react";
import type { ProcessTreeNode } from "../lib/api";
import { severityBar, severityText } from "../lib/alertDisplay";
import { formatTimestamp } from "../lib/eventDisplay";

interface Props {
  root: ProcessTreeNode;
  /** The process the analyst asked about — highlighted in the tree. */
  focusEventId?: number;
  /** Processes that raised an alert in the current case. */
  highlightPids?: number[];
  defaultExpandedDepth?: number;
}

/**
 * A process tree rendered as nested rows with connector rails.
 *
 * Indentation plus a vertical rail per level, rather than an SVG graph:
 * a process tree is strictly hierarchical with one parent per node, so
 * it is a list with structure, and a list stays readable at 600 nodes,
 * stays searchable with the browser's own find, and reflows at any
 * width. A force-directed graph would look more impressive and be
 * harder to read.
 *
 * Branches are expanded to `defaultExpandedDepth` and collapsible
 * below that. The depth that matters is usually shallow — how the
 * chain got from a document to a shell — while a noisy subtree of
 * forty short-lived children is exactly what an analyst wants folded
 * away.
 */
export default function ProcessTree({
  root,
  focusEventId,
  highlightPids = [],
  defaultExpandedDepth = 3,
}: Props) {
  return (
    <div className="overflow-x-auto font-mono text-xs">
      <TreeNode
        node={root}
        depth={0}
        focusEventId={focusEventId}
        highlightPids={new Set(highlightPids)}
        defaultExpandedDepth={defaultExpandedDepth}
      />
    </div>
  );
}

function TreeNode({
  node,
  depth,
  focusEventId,
  highlightPids,
  defaultExpandedDepth,
}: {
  node: ProcessTreeNode;
  depth: number;
  focusEventId?: number;
  highlightPids: Set<number>;
  defaultExpandedDepth: number;
}) {
  const [expanded, setExpanded] = useState(depth < defaultExpandedDepth);
  const hasChildren = node.children.length > 0;

  const isFocus = focusEventId !== undefined && node.event_id === focusEventId;
  const isFlagged = node.pid !== null && highlightPids.has(node.pid);
  const alerted = node.alert_count > 0;

  return (
    <div className="relative">
      <div
        className={[
          "group flex items-start gap-2 rounded-md py-1 pr-2 transition-colors hover:bg-panel-hover",
          isFocus ? "bg-primary/10 ring-1 ring-primary/40" : "",
        ].join(" ")}
        style={{ paddingLeft: `${depth * 18 + 4}px` }}
      >
        {/* Expand/collapse, or an alignment spacer when there's nothing
            to fold, so sibling names stay in one column. */}
        {hasChildren ? (
          <button
            onClick={() => setExpanded((e) => !e)}
            className="mt-0.5 shrink-0 rounded text-text-muted transition-colors hover:text-text-primary"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <span className="mt-0.5 w-3.5 shrink-0 text-center text-text-muted">
            <Dot className="h-3.5 w-3.5" />
          </span>
        )}

        {/* Severity rail — same grammar as event rows and status cards. */}
        <span
          className={`mt-1 h-3 w-0.5 shrink-0 rounded-full ${
            alerted ? severityBar(node.max_alert_severity) : "bg-border-strong"
          }`}
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span
              className={[
                "truncate",
                alerted ? severityText(node.max_alert_severity) : "text-text-primary",
                isFlagged ? "font-semibold" : "",
              ].join(" ")}
            >
              {node.process_name ?? "unknown"}
            </span>
            <span className="text-text-muted">pid {node.pid ?? "?"}</span>

            <span
              className={`inline-flex items-center gap-1 text-[10px] ${
                node.status === "running" ? "text-success" : "text-text-muted"
              }`}
            >
              <Circle
                className={`h-1.5 w-1.5 ${
                  node.status === "running" ? "fill-success" : "fill-text-muted"
                }`}
              />
              {node.status}
            </span>

            {alerted && (
              <span
                className={`inline-flex items-center gap-1 rounded px-1.5 py-px text-[10px] font-medium ${severityText(
                  node.max_alert_severity
                )}`}
              >
                <AlertTriangle className="h-3 w-3" />
                {node.alert_count} alert{node.alert_count === 1 ? "" : "s"}
              </span>
            )}

            {node.truncated && (
              <span className="rounded bg-warning/10 px-1.5 py-px text-[10px] text-warning">
                subtree truncated
              </span>
            )}
          </div>

          {node.command_line && (
            <div
              className="truncate text-[11px] text-text-muted group-hover:text-text-secondary"
              title={node.command_line}
            >
              {node.command_line}
            </div>
          )}

          <div className="text-[10px] text-text-muted">
            {formatTimestamp(node.started_at)}
            {node.user ? ` · ${node.user}` : ""}
          </div>
        </div>
      </div>

      {hasChildren && expanded && (
        <div className="relative">
          {/* Connector rail for this level. */}
          <span
            className="absolute top-0 bottom-0 w-px bg-border"
            style={{ left: `${depth * 18 + 11}px` }}
          />
          {node.children.map((child) => (
            <TreeNode
              key={child.event_id}
              node={child}
              depth={depth + 1}
              focusEventId={focusEventId}
              highlightPids={highlightPids}
              defaultExpandedDepth={defaultExpandedDepth}
            />
          ))}
        </div>
      )}
    </div>
  );
}
