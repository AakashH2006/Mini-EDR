import type { LucideIcon } from "lucide-react";

type CardTone = "primary" | "success" | "warning" | "critical" | "secondary";

const TONE_CLASSES: Record<CardTone, { rail: string; icon: string }> = {
  primary: { rail: "bg-primary", icon: "text-primary" },
  secondary: { rail: "bg-secondary", icon: "text-secondary" },
  success: { rail: "bg-success", icon: "text-success" },
  warning: { rail: "bg-warning", icon: "text-warning" },
  critical: { rail: "bg-critical", icon: "text-critical" },
};

interface StatusCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone: CardTone;
  sublabel?: string;
  pulse?: boolean; // live "breathing" dot, used only for Agent Status
  onClick?: () => void;
}

export default function StatusCard({ label, value, icon: Icon, tone, sublabel, pulse, onClick }: StatusCardProps) {
  const { rail, icon } = TONE_CLASSES[tone];

  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              // Enter only — Space is reserved globally for pause/resume
              // live feed, so a focused card must not also react to it.
              if (e.key === "Enter") onClick();
            }
          : undefined
      }
      className={[
        "relative overflow-hidden rounded-xl border border-border bg-panel px-5 py-3 transition-colors",
        onClick ? "cursor-pointer hover:border-border-strong hover:bg-panel-hover" : "",
      ].join(" ")}
    >
      <span className={`absolute left-0 top-0 h-full w-1 ${rail}`} />
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-text-muted">
            {label}
          </div>
          <div className="mt-1 font-mono text-xl font-semibold text-text-primary">
            {value}
          </div>
          {sublabel && <div className="mt-1 text-xs text-text-secondary">{sublabel}</div>}
        </div>
        <div className="relative">
          <Icon className={`h-5 w-5 ${icon}`} strokeWidth={2} />
          {pulse && (
            <span className="absolute -right-0.5 -top-0.5 flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
