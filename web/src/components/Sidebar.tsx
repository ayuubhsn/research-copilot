import { shortLabel } from "@/lib/cite";
import type { DocumentInfo } from "@/lib/types";
import FilePicker from "./FilePicker";
import type { Turn, Upload } from "./Workspace";

type Props = {
  docs: DocumentInfo[];
  docId: string | null;
  live: boolean;
  upload: Upload | null;
  turns: Turn[];
  activeId: number | null;
  onSelectDoc: (id: string) => void;
  onUpload: (file: File) => void;
  onRemove: (id: string) => void;
  onDismissUpload: () => void;
  onSelect: (turn: Turn) => void;
  onEditCitation: (docId: string) => void;
};

export default function Sidebar(props: Props) {
  const { docs, docId, live, upload, turns, activeId } = props;

  return (
    <aside className="hidden w-64 shrink-0 flex-col gap-6 overflow-y-auto border-r border-line bg-panel-2 p-4 lg:flex">
      <section>
        <h2 className="mb-2.5 text-xs font-semibold tracking-wide text-muted uppercase">Library</h2>
        <ul className="flex flex-col gap-1.5">
          {docs.map((doc) => (
            <li key={doc.id} className="group relative">
              <button
                onClick={() => props.onSelectDoc(doc.id)}
                className={`w-full rounded-xl border p-3 text-left transition ${
                  doc.id === docId ? "border-accent/40 bg-raised" : "border-transparent hover:bg-raised/60"
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <PdfIcon />
                  <div className="min-w-0">
                    <div className="truncate pr-12 font-mono text-[13px]">{doc.file}</div>
                    <div className="mt-0.5 truncate text-xs text-soft">{doc.citation ? shortLabel(doc.citation, doc.file) : ""}</div>
                    <div className="mt-0.5 text-xs text-muted">
                      {doc.pageCount} pages · {doc.passages} passages
                    </div>
                  </div>
                </div>
              </button>
              {live && (
                <button
                  onClick={() => props.onEditCitation(doc.id)}
                  title="Edit paper details for references"
                  aria-label={`Edit details for ${doc.file}`}
                  className="absolute top-2.5 right-9 hidden h-6 w-6 items-center justify-center rounded-md text-xs text-dim group-hover:flex hover:bg-panel hover:text-accent"
                >
                  ✎
                </button>
              )}
              {live && (
                <button
                  onClick={() => props.onRemove(doc.id)}
                  title={`Remove ${doc.file}`}
                  aria-label={`Remove ${doc.file}`}
                  className="absolute top-2.5 right-2.5 hidden h-6 w-6 items-center justify-center rounded-md text-dim group-hover:flex hover:bg-panel hover:text-bad"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>

        {upload && (
          <div className="mt-2 rounded-xl border border-line p-3 text-xs">
            <div className="truncate font-mono text-soft">{upload.name}</div>
            {upload.error ? (
              <div className="mt-1 flex items-start justify-between gap-2 text-bad">
                {upload.error}
                <button onClick={props.onDismissUpload} className="text-dim hover:text-text" aria-label="Dismiss">
                  ×
                </button>
              </div>
            ) : (
              <div className="mt-1 flex items-center gap-2 text-muted">
                <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-accent" />
                Reading and indexing…
              </div>
            )}
          </div>
        )}

        {live ? (
          <FilePicker
            onFile={props.onUpload}
            className="mt-2.5 w-full rounded-xl border border-dashed border-line px-3 py-2.5 text-sm text-muted transition hover:border-accent hover:text-accent"
          >
            + Upload PDF
          </FilePicker>
        ) : (
          <button
            disabled
            title="Uploading needs the backend. The demo has one paper."
            className="mt-2.5 w-full cursor-not-allowed rounded-xl border border-dashed border-line px-3 py-2.5 text-sm text-muted opacity-60"
          >
            + Upload PDF
          </button>
        )}
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
                  onClick={() => props.onSelect(turn)}
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
