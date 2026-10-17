import { tacticMeta } from "../lib/alertDisplay";

interface Props {
  tactic: string | null;
  techniqueId?: string | null;
  technique?: string | null;
  /** Compact drops the technique name, for table cells. */
  compact?: boolean;
}

/**
 * An ATT&CK attribution: tactic icon, technique id, technique name.
 *
 * The technique id is monospaced because it's an identifier an analyst
 * copies and looks up, which is the same reason PIDs and IPs are
 * monospaced everywhere else in this UI.
 */
export default function MitreBadge({ tactic, techniqueId, technique, compact }: Props) {
  const meta = tacticMeta(tactic);
  const Icon = meta.icon;

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-0.5 text-xs text-text-secondary"
      title={
        technique
          ? `${meta.label} · ${techniqueId ?? ""} ${technique}`.trim()
          : meta.label
      }
    >
      <Icon className="h-3 w-3 shrink-0 text-text-muted" />
      {techniqueId && <span className="font-mono text-[11px] text-text-primary">{techniqueId}</span>}
      <span className={compact ? "sr-only" : ""}>{meta.label}</span>
    </span>
  );
}
