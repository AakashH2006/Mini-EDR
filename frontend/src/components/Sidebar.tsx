import { NavLink } from "react-router-dom";
import {
  ShieldHalf,
  ListTree,
  Cpu,
  Network,
  GanttChartSquare,
  Settings,
} from "lucide-react";

const NAV_ITEMS = [
  { to: "/", label: "Activity Explorer", icon: ListTree, end: true },
  { to: "/processes", label: "Processes", icon: Cpu },
  { to: "/network", label: "Network", icon: Network },
  { to: "/timeline", label: "Timeline", icon: GanttChartSquare },
  { to: "/settings", label: "Settings", icon: Settings },
];

export default function Sidebar() {
  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-panel">
      <div className="flex items-center gap-2.5 border-b border-border px-5 py-5">
        <ShieldHalf className="h-6 w-6 text-primary" strokeWidth={2} />
        <div>
          <div className="text-sm font-semibold tracking-tight text-text-primary">
            Mini EDR
          </div>
          <div className="text-[11px] font-mono text-text-muted">
            endpoint telemetry
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-4">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              [
                "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-panel-hover text-text-primary"
                  : "text-text-secondary hover:bg-panel-hover hover:text-text-primary",
              ].join(" ")
            }
          >
            {({ isActive }) => (
              <>
                {/* signature severity/status rail — reused on status
                    cards and table rows so active-state, health, and
                    severity all share the same visual grammar */}
                <span
                  className={[
                    "absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full transition-colors",
                    isActive ? "bg-primary" : "bg-transparent",
                  ].join(" ")}
                />
                <Icon
                  className={[
                    "h-4 w-4 shrink-0",
                    isActive ? "text-primary" : "text-text-muted group-hover:text-text-secondary",
                  ].join(" ")}
                  strokeWidth={2}
                />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-border px-5 py-4">
        <div className="text-[11px] font-mono text-text-muted">
          Phase 1 · Telemetry only
        </div>
      </div>
    </aside>
  );
}
