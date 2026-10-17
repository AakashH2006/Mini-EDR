import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useRules } from "../lib/useRules";
import { severityBadge, tacticMeta } from "../lib/alertDisplay";

/**
 * The detection rule pack, with a switch per rule.
 *
 * Collapsed to one row per rule by default — twenty-one full
 * descriptions is a wall of text — and expanding a row reveals what
 * the rule actually looks for, what it costs in false positives, and
 * its ATT&CK attribution. That text is the rule's own `description`
 * from the backend, so there is exactly one place it is written.
 *
 * Disabling a rule stops it firing from the next detection batch
 * onwards; it does not retract alerts already raised, which the
 * footnote says plainly because it is the first thing someone will
 * wonder after flipping a switch.
 */
export default function RulePanel() {
  const { rules, loading, error, pending, toggle } = useRules();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (loading && rules.length === 0) {
    return <p className="text-sm text-text-muted">Loading detection rules…</p>;
  }

  const enabledCount = rules.filter((r) => r.enabled).length;

  return (
    <div className="space-y-2">
      {error && (
        <div className="rounded-lg border border-critical/30 bg-critical/5 px-3 py-2 text-xs text-critical">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between pb-1 text-xs text-text-muted">
        <span>
          <span className="font-mono text-text-secondary">{enabledCount}</span> of{" "}
          <span className="font-mono text-text-secondary">{rules.length}</span> rules enabled
        </span>
        <span>
          <span className="font-mono text-text-secondary">
            {rules.reduce((sum, r) => sum + r.alert_count, 0)}
          </span>{" "}
          alerts raised
        </span>
      </div>

      {rules.map((rule) => {
        const isOpen = expanded.has(rule.id);
        const meta = tacticMeta(rule.mitre_tactic);
        const Icon = meta.icon;
        const busy = pending.has(rule.id);

        return (
          <div
            key={rule.id}
            className={`overflow-hidden rounded-lg border border-border bg-bg transition-opacity ${
              rule.enabled ? "" : "opacity-60"
            }`}
          >
            <div className="flex items-center gap-3 px-3 py-2.5">
              <button
                onClick={() => toggleExpanded(rule.id)}
                className="shrink-0 text-text-muted transition-colors hover:text-text-primary"
                aria-label={isOpen ? "Collapse rule" : "Expand rule"}
              >
                {isOpen ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </button>

              <Icon className="h-4 w-4 shrink-0 text-text-muted" />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] text-text-muted">{rule.id}</span>
                  <span className="truncate text-sm text-text-primary">{rule.name}</span>
                  <span
                    className={`rounded-full px-1.5 py-px text-[10px] font-medium ${severityBadge(rule.severity)}`}
                  >
                    {rule.severity}
                  </span>
                </div>
                <div className="font-mono text-[11px] text-text-muted">
                  {rule.mitre_id} · {rule.tactic_label ?? meta.label}
                  {rule.alert_count > 0 && ` · ${rule.alert_count} fired`}
                </div>
              </div>

              <Switch
                checked={rule.enabled}
                disabled={busy}
                onChange={(next) => toggle(rule.id, next)}
                label={`${rule.enabled ? "Disable" : "Enable"} ${rule.id}`}
              />
            </div>

            {isOpen && (
              <div className="border-t border-border px-3 py-2.5 pl-10">
                <p className="text-xs leading-relaxed text-text-secondary">
                  {rule.description}
                </p>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                  <Meta label="Technique" value={`${rule.mitre_id} ${rule.mitre_technique}`} />
                  <Meta label="Base score" value={`${rule.score} / 100`} />
                  <Meta label="Event types" value={rule.event_types.join(", ")} />
                  <Meta
                    label="Cooldown"
                    value={
                      rule.cooldown_seconds >= 60
                        ? `${Math.round(rule.cooldown_seconds / 60)} min`
                        : `${rule.cooldown_seconds}s`
                    }
                  />
                </dl>
              </div>
            )}
          </div>
        );
      })}

      <p className="pt-1 text-xs text-text-muted">
        Disabling a rule stops it firing from the next detection pass onward. Alerts it has
        already raised are kept — they were real observations, and removing them would rewrite
        history someone may have acted on.
      </p>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <dt className="shrink-0 text-text-muted">{label}:</dt>
      <dd className="truncate font-mono text-text-secondary" title={value}>
        {value}
      </dd>
    </div>
  );
}

function Switch({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        "relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-primary" : "bg-border-strong",
      ].join(" ")}
    >
      <span
        className={[
          "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5",
        ].join(" ")}
      />
    </button>
  );
}
