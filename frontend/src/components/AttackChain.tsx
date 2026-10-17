import type { ChainStep } from "../lib/api";
import {
  TACTIC_ORDER,
  severityBadge,
  severityBar,
  severityText,
  tacticMeta,
  tacticRank,
} from "../lib/alertDisplay";
import { formatTimestamp } from "../lib/eventDisplay";

interface Props {
  chain: ChainStep[];
  onSelectAlert?: (alertId: number) => void;
}

/**
 * The case's alerts laid out as a kill chain: one column per ATT&CK
 * tactic reached, in kill-chain order, with that tactic's alerts
 * stacked inside it.
 *
 * Grouping by tactic rather than listing alerts chronologically is the
 * whole point of this view. A flat time-ordered list is already
 * available in the alert table; what an analyst cannot get from that
 * is "this intrusion got as far as credential access, and here is the
 * path it took". Stages are what carry that, and interleaved
 * background noise destroys it.
 *
 * Tactics the case never reached are shown as empty, dimmed slots.
 * The gap is information — a case with execution and impact but no
 * credential access is a different problem from one with all three —
 * and a view that only rendered the tactics present would hide it.
 *
 * Within a column, alerts stay in timestamp order and each carries its
 * real time, so the actual sequence survives the regrouping.
 */
export default function AttackChain({ chain, onSelectAlert }: Props) {
  if (chain.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-panel px-5 py-8 text-center text-sm text-text-muted">
        No alerts in this case yet.
      </div>
    );
  }

  const reached = new Set(chain.map((s) => s.mitre_tactic).filter(Boolean) as string[]);

  // Trim the empty tails: everything before the first tactic reached
  // and after the last is scenery. The gaps *between* reached stages
  // are the meaningful ones and stay.
  const ranks = [...reached].map(tacticRank).filter((r) => r < TACTIC_ORDER.length);
  const firstRank = Math.min(...ranks);
  const lastRank = Math.max(...ranks);
  const visibleTactics = TACTIC_ORDER.slice(firstRank, lastRank + 1);

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex min-w-max items-stretch gap-2">
        {visibleTactics.map((tactic, index) => {
          const steps = chain
            .filter((s) => s.mitre_tactic === tactic)
            .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
          const meta = tacticMeta(tactic);
          const Icon = meta.icon;
          const active = steps.length > 0;

          // Worst severity in this stage drives its accent.
          const worst = steps.reduce<string>(
            (acc, s) => pickWorse(acc, s.severity),
            "Information"
          );

          return (
            <div key={tactic} className="flex items-stretch">
              <div
                className={[
                  "flex w-60 flex-col rounded-xl border bg-panel transition-colors",
                  active ? "border-border-strong" : "border-border/60 opacity-50",
                ].join(" ")}
              >
                {/* Stage header */}
                <div className="relative overflow-hidden rounded-t-xl border-b border-border px-3 py-2">
                  <span
                    className={`absolute left-0 top-0 h-full w-0.5 ${
                      active ? severityBar(worst) : "bg-border"
                    }`}
                  />
                  <div className="flex items-center gap-2">
                    <Icon
                      className={`h-3.5 w-3.5 shrink-0 ${
                        active ? severityText(worst) : "text-text-muted"
                      }`}
                    />
                    <span
                      className={`truncate text-xs font-medium ${
                        active ? "text-text-primary" : "text-text-muted"
                      }`}
                    >
                      {meta.label}
                    </span>
                    {active && (
                      <span className="ml-auto font-mono text-[10px] text-text-muted">
                        {steps.length}
                      </span>
                    )}
                  </div>
                </div>

                {/* Stage contents */}
                <div className="flex-1 space-y-1.5 p-2">
                  {steps.length === 0 ? (
                    <div className="flex h-full min-h-14 items-center justify-center text-[11px] text-text-muted">
                      not observed
                    </div>
                  ) : (
                    steps.map((step) => (
                      <button
                        key={step.id}
                        onClick={() => onSelectAlert?.(step.id)}
                        className="group w-full rounded-lg border border-border bg-bg px-2.5 py-2 text-left transition-colors hover:border-border-strong hover:bg-panel-hover"
                      >
                        <div className="mb-1 flex items-center gap-1.5">
                          <span
                            className={`rounded-full px-1.5 py-px text-[10px] font-medium ${severityBadge(step.severity)}`}
                          >
                            {step.severity}
                          </span>
                          <span className="font-mono text-[10px] text-text-muted">
                            {step.mitre_id}
                          </span>
                        </div>
                        <div className="line-clamp-2 text-[11px] leading-snug text-text-primary">
                          {step.title}
                        </div>
                        <div className="mt-1 font-mono text-[10px] text-text-muted">
                          {formatTimestamp(step.timestamp)}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>

              {/* Connector between stages */}
              {index < visibleTactics.length - 1 && (
                <div className="flex w-2 items-center justify-center" aria-hidden="true">
                  <span className="h-px w-full bg-border" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const SEVERITY_WEIGHT: Record<string, number> = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
  Information: 0,
};

function pickWorse(a: string, b: string): string {
  return (SEVERITY_WEIGHT[b] ?? 0) > (SEVERITY_WEIGHT[a] ?? 0) ? b : a;
}

/** Compact tactic coverage strip, for incident rows in the case list. */
export function TacticStrip({ tactics }: { tactics: string[] }) {
  const reached = new Set(tactics);
  return (
    <div className="flex items-center gap-0.5">
      {TACTIC_ORDER.map((tactic) => {
        const meta = tacticMeta(tactic);
        const hit = reached.has(tactic);
        return (
          <span
            key={tactic}
            title={`${meta.label}${hit ? "" : " — not observed"}`}
            className={`h-1.5 w-3 rounded-full ${hit ? "bg-primary" : "bg-border"}`}
          />
        );
      })}
    </div>
  );
}
