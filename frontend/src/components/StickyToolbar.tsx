import type { ReactNode } from "react";

export default function StickyToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky top-0 z-20 -mx-8 border-b border-border bg-bg px-8 py-3">
      {children}
    </div>
  );
}
