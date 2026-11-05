import type { DocumentInfo } from "@/lib/types";
import type { Turn } from "./Workspace";

type Props = {
  doc: DocumentInfo;
  live: boolean;
  turns: Turn[];
  activeId: number | null;
  onSelect: (turn: Turn) => void;
};

export default function Sidebar({ doc, live, turns, activeId, onSelect }: Props) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col gap-6 overflow-y-auto border-r border-line bg-panel-2 p-4 lg:flex">
      <section>
        <h2 className="mb-2.5 text-xs font-semibold tracking-wide text-muted uppercase">Library</h2>
        <div className="rounded-xl border border-accent/40 bg-raised p-3">
          <div className="flex items-start gap-2.5">
            <PdfIcon />
            <div className="min-w-0">
              <div className="truncate font-mono text-[13px]">{doc.file}</div>
              <div className="mt-0.5 text-xs text-muted">
                {doc.pageCount} pages · {doc.passages} passages
              </div>
            </div>
          </div>
          <div className="mt-2.5 flex items-center gap-1.5 text-xs text-mint">
            <span className="h-1.5 w-1.5 rounded-full bg-mint" />
            Indexed for search
          </div>
        </div>
        <button
          disabled={!live}
          title={live ? "Upload a PDF" : "Uploading needs the backend. The demo has one paper."}
          className="mt-2.5 w-full rounded-xl border border-dashed border-line px-3 py-2.5 text-sm text-muted transition enabled:hover:border-accent enabled:hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          + Upload PDF
        </button>
      </section>

      <section className="min-h-0">
        <h2 className="mb-2.5 text-xs font-semibold tracking-wide text-muted uppercase">Questions</h2>
        {turns.length === 0 ? (
          <p className="text-sm text-dim">Questions you ask show up here.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {turns.map((turn) => (
              <li key={turn.id}>
                <button
                  onClick={() => onSelect(turn)}
                  className={`w-full rounded-lg px-2.5 py-2 text-left text-sm transition ${
                    turn.id === activeId ? "bg-raised text-text" : "text-soft hover:bg-raised/60"
                  }`}
                >
                  <span className="line-clamp-2">{turn.question}</span>
                  <span className="mt-1 flex items-center gap-1.5 text-[11px] text-dim">
                    <span className={turn.mode === "scout" ? "text-accent" : "text-mint"}>
                      {turn.mode === "scout" ? "Scout" : "Fast"}
                    </span>
                    {turn.status === "running" && <span className="animate-pulse-dot">· working</span>}
                    {turn.status === "error" && <span className="text-bad">· not available</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

function PdfIcon() {
  return (
    <span className="relative mt-0.5 h-8 w-6 shrink-0 rounded-[3px] bg-paper" aria-hidden>
      <span className="absolute top-2 right-1 left-1 h-0.5 rounded bg-paper-line" />
      <span className="absolute top-3.5 right-2 left-1 h-0.5 rounded bg-paper-line" />
      <span className="absolute top-5 right-1 left-1 h-0.5 rounded bg-accent" />
    </span>
  );
}
