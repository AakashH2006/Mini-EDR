import { Search } from "lucide-react";
import LiveControls from "./LiveControls";
import type { Category } from "../lib/useEvents";

const CATEGORIES: { key: Category; label: string }[] = [
  { key: "all", label: "All" },
  { key: "processes", label: "Processes" },
  { key: "network", label: "Network" },
  { key: "usb", label: "USB" },
  { key: "authentication", label: "Authentication" },
];

interface Props {
  search: string;
  onSearch: (v: string) => void;
  category: Category;
  onCategory: (c: Category) => void;
}

export default function EventToolbar({ search, onSearch, category, onCategory }: Props) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search process, PID, user, event type…"
            className="w-full rounded-lg border border-border bg-panel py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              onClick={() => onCategory(c.key)}
              className={[
                "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                category === c.key
                  ? "bg-primary text-white"
                  : "border border-border bg-panel text-text-secondary hover:border-border-strong hover:text-text-primary",
              ].join(" ")}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="self-start sm:self-auto">
        <LiveControls />
      </div>
    </div>
  );
}
