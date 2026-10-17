import SearchInput from "./SearchInput";
import LiveControls from "./LiveControls";
import QuickActionsMenu from "./QuickActionsMenu";
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
  onExportCsv: () => void;
}

export default function EventToolbar({ search, onSearch, category, onCategory, onExportCsv }: Props) {
  const clearFilters = () => {
    onSearch("");
    onCategory("all");
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {/* Search is the primary control on this toolbar — sized to
            60-70% of the row on wider screens per the design spec,
            full-width on mobile where there's no room to share. */}
        <div className="sm:basis-[65%]">
          <SearchInput
            value={search}
            onChange={onSearch}
            placeholder="Search processes, PID, user, command line…"
          />
        </div>
        <div className="flex flex-1 flex-wrap items-center justify-between gap-2 sm:justify-end">
          <LiveControls />
          <QuickActionsMenu onExportCsv={onExportCsv} onClearFilters={clearFilters} />
        </div>
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
  );
}
