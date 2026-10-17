import type { SeverityTone } from "../lib/eventDisplay";
import { severityTone } from "../lib/eventDisplay";

const TONE_STYLES: Record<SeverityTone, string> = {
  info: "bg-text-muted/10 text-text-secondary",
  low: "bg-success/10 text-success",
  medium: "bg-warning/10 text-warning",
  high: "bg-high/10 text-high",
  critical: "bg-critical/10 text-critical",
};

export default function SeverityBadge({ severity }: { severity: string }) {
  const tone = severityTone(severity);
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE_STYLES[tone]}`}>
      {severity}
    </span>
  );
}
