import type { EventRow } from "./api";

export interface HourGroup {
  key: string;
  label: string;
  events: EventRow[];
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dayLabel(date: Date): string {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (isSameDay(date, now)) return "Today";
  if (isSameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function hourRangeLabel(date: Date): string {
  const start = new Date(date);
  start.setMinutes(0, 0, 0);
  const end = new Date(start);
  end.setHours(start.getHours() + 1);
  const fmt = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", hour12: true });
  return `${fmt(start)} – ${fmt(end)}`;
}

/** Assumes `events` is already sorted newest-first; grouping preserves
 * that order, it doesn't re-sort — a stable single pass is enough. */
export function groupByHour(events: EventRow[]): HourGroup[] {
  const groups: HourGroup[] = [];
  const indexByKey = new Map<string, number>();

  for (const event of events) {
    const d = new Date(event.timestamp);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`;

    let idx = indexByKey.get(key);
    if (idx === undefined) {
      idx = groups.length;
      indexByKey.set(key, idx);
      groups.push({ key, label: `${dayLabel(d)} · ${hourRangeLabel(d)}`, events: [] });
    }
    groups[idx].events.push(event);
  }

  return groups;
}
