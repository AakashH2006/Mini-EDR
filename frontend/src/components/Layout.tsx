import { useEffect, type ReactNode } from "react";
import Sidebar from "./Sidebar";
import FooterStatusBar from "./FooterStatusBar";
import { triggerRefresh } from "../lib/refreshBus";

export default function Layout({ children }: { children: ReactNode }) {
  // Ctrl+R re-fetches the active page's data instead of reloading the
  // whole app — each page's hook listens for this via the refresh bus.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        triggerRefresh();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg text-text-primary">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1600px] px-8 py-6">{children}</div>
        </main>
        <FooterStatusBar />
      </div>
    </div>
  );
}
