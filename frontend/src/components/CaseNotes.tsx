import { useState } from "react";
import { Bot, MessageSquare, Send, Shuffle, User } from "lucide-react";
import type { CaseNote } from "../lib/api";
import { relativeTime } from "../lib/alertDisplay";
import { formatTimestamp } from "../lib/eventDisplay";

const KIND_META = {
  note: { icon: MessageSquare, className: "text-primary", label: "Note" },
  status_change: { icon: Shuffle, className: "text-warning", label: "Status" },
  system: { icon: Bot, className: "text-text-muted", label: "System" },
} as const;

interface Props {
  notes: CaseNote[];
  busy: boolean;
  onAddNote: (body: string) => Promise<unknown>;
}

/**
 * The case's working record: analyst notes and automatic status-change
 * entries in one chronological feed.
 *
 * Interleaved rather than separated into "notes" and "history",
 * because the two only mean anything together — "moved to contained"
 * is answered by the note written beside it. Oldest-first for the same
 * reason: a case is read as a narrative from the top, unlike the alert
 * feed which is read newest-first.
 */
export default function CaseNotes({ notes, busy, onAddNote }: Props) {
  const [draft, setDraft] = useState("");

  const submit = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    await onAddNote(body);
    setDraft("");
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-2">
        {notes.length === 0 ? (
          <p className="text-sm text-text-muted">
            No activity recorded on this case yet.
          </p>
        ) : (
          notes.map((note) => {
            const meta = KIND_META[note.kind] ?? KIND_META.note;
            const Icon = meta.icon;
            return (
              <div
                key={note.id}
                className="flex items-start gap-2.5 rounded-lg border border-border bg-bg px-3 py-2.5"
              >
                <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${meta.className}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-relaxed text-text-primary">{note.body}</p>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-text-muted">
                    <User className="h-3 w-3" />
                    <span>{note.author ?? "unknown"}</span>
                    <span>·</span>
                    <span className="font-mono">{formatTimestamp(note.created_at)}</span>
                    <span>·</span>
                    <span>{relativeTime(note.created_at)}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Ctrl/Cmd+Enter submits; plain Enter stays a newline,
            // since case notes run to several lines more often than not.
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          rows={2}
          placeholder="Add a note — findings, actions taken, why this was closed…"
          className="flex-1 resize-y rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
        />
        <button
          onClick={submit}
          disabled={busy || !draft.trim()}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-panel-hover px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" />
          Add
        </button>
      </div>
    </div>
  );
}
