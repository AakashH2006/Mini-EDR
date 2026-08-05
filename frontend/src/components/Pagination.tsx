import { ChevronLeft, ChevronRight } from "lucide-react";

interface Props {
  page: number; // 0-indexed
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export default function Pagination({ page, pageSize, total, onPageChange }: Props) {
  const start = total === 0 ? 0 : page * pageSize + 1;
  const end = Math.min(total, (page + 1) * pageSize);
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);

  return (
    <div className="flex items-center justify-between px-1 py-2 text-xs text-text-secondary">
      <span>
        Showing <span className="font-mono text-text-primary">{start}</span>–
        <span className="font-mono text-text-primary">{end}</span> of{" "}
        <span className="font-mono text-text-primary">{total}</span>
      </span>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onPageChange(Math.max(0, page - 1))}
          disabled={page === 0}
          className="flex items-center gap-1 rounded-lg border border-border bg-panel px-2.5 py-1.5 font-medium text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Prev
        </button>
        <span className="px-1 font-mono text-text-muted">
          {page + 1} / {lastPage + 1}
        </span>
        <button
          onClick={() => onPageChange(Math.min(lastPage, page + 1))}
          disabled={page >= lastPage}
          className="flex items-center gap-1 rounded-lg border border-border bg-panel px-2.5 py-1.5 font-medium text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
