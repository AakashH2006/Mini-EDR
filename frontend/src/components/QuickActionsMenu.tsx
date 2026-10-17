import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, RefreshCw, Download, FilterX, Pause, Play } from "lucide-react";
import { useWs } from "../lib/ws";
import { triggerRefresh } from "../lib/refreshBus";

interface Props {
  onExportCsv: () => void;
  onClearFilters: () => void;
}

export default function QuickActionsMenu({ onExportCsv, onClearFilters }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { paused, setPaused } = useWs();

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onClickOutside);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClickOutside);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items = [
    { label: "Refresh", icon: RefreshCw, onClick: () => triggerRefresh(), shortcut: "Ctrl+R" },
    { label: "Export CSV", icon: Download, onClick: onExportCsv },
    { label: "Clear Filters", icon: FilterX, onClick: onClearFilters },
    {
      label: paused ? "Resume Live Feed" : "Pause Live Feed",
      icon: paused ? Play : Pause,
      onClick: () => setPaused(!paused),
      shortcut: "Space",
    },
  ];

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-center rounded-lg border border-border bg-panel p-1.5 text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
        aria-label="Quick actions"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1.5 w-48 overflow-hidden rounded-lg border border-border bg-panel shadow-xl">
          {items.map((item) => (
            <button
              key={item.label}
              onClick={() => {
                item.onClick();
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-panel-hover hover:text-text-primary"
            >
              <span className="flex items-center gap-2">
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </span>
              {item.shortcut && <span className="font-mono text-[10px] text-text-muted">{item.shortcut}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
