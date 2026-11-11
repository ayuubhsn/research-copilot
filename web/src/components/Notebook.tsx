"use client";

import { useMemo, useState } from "react";
import { copyRich, download, inText, referenceList, reference, shortLabel, STYLES, toBibTeX, toHtml, toPlain, toRIS, type Style } from "@/lib/cite";
import type { Citation, DocumentInfo, Note } from "@/lib/types";

type Props = {
  notes: Note[];
  docs: DocumentInfo[];
  colors: Record<string, string>;
  style: Style;
  setStyle: (s: Style) => void;
  onOpen: (note: Note) => void;
  onUpdate: (id: string, patch: { note?: string; tags?: string[] }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onEditCitation: (docId: string) => void;
};

// Used when a paper has no bibliographic data yet
const fallbackCitation = (doc: DocumentInfo): Citation => ({
  title: doc.file.replace(/\.pdf$/i, ""),
  authors: [],
  year: null,
  container: "",
  volume: "",
  issue: "",
  pages: "",
  doi: null,
  type: "article",
  publisher: "",
  source: "pdf",
});

export default function Notebook({ notes, docs, colors, style, setStyle, onOpen, onUpdate, onDelete, onEditCitation }: Props) {
  const [filter, setFilter] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const docById = useMemo(() => new Map(docs.map((d) => [d.id, d])), [docs]);
  const citationOf = (docId: string) => {
    const doc = docById.get(docId);
    return doc ? (doc.citation ?? fallbackCitation(doc)) : null;
  };

  // Papers in the order they first appear in the notebook; IEEE numbers follow this order
  const cited = useMemo(() => [...new Set(notes.map((n) => n.docId))].filter((id) => docById.has(id)), [notes, docById]);
  const number = (docId: string) => cited.indexOf(docId) + 1;

  const allTags = [...new Set(notes.flatMap((n) => n.tags))].sort();
  const needle = filter.trim().toLowerCase();
  const shown = notes.filter(
    (n) =>
      (!tag || n.tags.includes(tag)) &&
      (!needle || `${n.text} ${n.note} ${n.tags.join(" ")}`.toLowerCase().includes(needle)),
  );
  const groups = cited.map((docId) => ({ docId, notes: shown.filter((n) => n.docId === docId).sort((a, b) => a.page - b.page) })).filter((g) => g.notes.length);

  const flash = (key: string) => {
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
  };

  const copyReferences = async () => {
    const list = referenceList(cited.map((id) => citationOf(id)!), style);
    await copyRich(list.map((p) => `<p>${toHtml(p)}</p>`).join(""), list.map(toPlain).join("\n"));
    flash("refs");
  };

  // What to copy for one saved quote: the quote with its citation, the in-text citation alone, or the reference
  const copyNote = async (n: Note, what: CopyWhat) => {
    const c = citationOf(n.docId);
    if (!c) return;
    const cite = inText(c, style, n.page, number(n.docId));
    if (what === "reference") {
      const ref = reference(c, style, number(n.docId));
      await copyRich(toHtml(ref), toPlain(ref));
    } else {
      const text = what === "quote" ? `“${n.text}” ${cite}` : cite;
      await copyRich(text.replace(/&/g, "&amp;").replace(/</g, "&lt;"), text);
    }
    flash(`${n.id}-${what}`);
  };

  const citations = cited.map((id) => citationOf(id)!);

  if (notes.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="max-w-md text-center">
          <p className="font-serif text-3xl">Your notebook is empty</p>
          <p className="mt-3 text-sm text-muted">
            Select text in a PDF and press <span className="text-text">★ Save to notebook</span>, or save a hit from{" "}
            <span className="text-text">Find again</span> or a passage from an answer. Every quote keeps its paper and page, and
            you can copy it with a citation in the style you need.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-5 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex rounded-lg border border-line p-0.5 text-xs" role="radiogroup" aria-label="Citation style">
            {STYLES.map((s) => (
              <button
                key={s.id}
                role="radio"
                aria-checked={style === s.id}
                onClick={() => setStyle(s.id)}
                className={`rounded-md px-2.5 py-1 font-medium transition ${style === s.id ? "bg-raised text-text" : "text-dim hover:text-soft"}`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <ActionButton onClick={copyReferences}>{copied === "refs" ? "Copied ✓" : "Copy reference list"}</ActionButton>
            <ActionButton onClick={() => download("references.bib", toBibTeX(citations), "application/x-bibtex")}>BibTeX</ActionButton>
            <ActionButton onClick={() => download("references.ris", toRIS(citations), "application/x-research-info-systems")}>RIS</ActionButton>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`Search ${notes.length} saved quotes…`}
            className="min-w-48 flex-1 rounded-lg border border-line bg-panel px-3 py-1.5 text-sm outline-none placeholder:text-dim focus:border-accent/60"
          />
          {allTags.map((t) => (
            <button
              key={t}
              onClick={() => setTag(tag === t ? null : t)}
              className={`rounded-full border px-2.5 py-0.5 text-xs transition ${tag === t ? "border-accent text-accent" : "border-line text-muted hover:text-soft"}`}
            >
              #{t}
            </button>
          ))}
        </div>

        {groups.length === 0 && <p className="py-6 text-center text-sm text-muted">No saved quotes match.</p>}

        {groups.map(({ docId, notes: group }) => {
          const doc = docById.get(docId)!;
          const c = citationOf(docId)!;
          return (
            <section key={docId} className="flex flex-col gap-2">
              <header className="flex items-start gap-2.5 rounded-xl bg-panel-2 px-3 py-2.5">
                <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colors[docId] }} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{shortLabel(c, doc.file)}</div>
                  <p
                    className="mt-0.5 text-xs leading-relaxed text-muted [&_i]:text-soft"
                    dangerouslySetInnerHTML={{ __html: toHtml(reference(c, style, number(docId))) }}
                  />
                  {c.source !== "doi" && c.source !== "user" && (
                    <p className="mt-1 text-[11px] text-warn">Guessed from the PDF. Check the details before citing.</p>
                  )}
                </div>
                <button onClick={() => onEditCitation(docId)} className="shrink-0 text-xs text-dim hover:text-accent">
                  Edit details
                </button>
              </header>
              {group.map((n) => (
                <NoteCard
                  key={n.id}
                  note={n}
                  color={colors[docId]}
                  citation={inText(c, style, n.page, number(docId))}
                  copied={copied?.startsWith(`${n.id}-`) ? (copied.slice(n.id.length + 1) as CopyWhat) : null}
                  onOpen={() => onOpen(n)}
                  onCopy={(what) => copyNote(n, what)}
                  onUpdate={(patch) => onUpdate(n.id, patch)}
                  onDelete={() => onDelete(n.id)}
                />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

type CopyWhat = "quote" | "intext" | "reference";

type CardProps = {
  note: Note;
  color: string;
  citation: string;
  copied: CopyWhat | null;
  onOpen: () => void;
  onCopy: (what: CopyWhat) => void;
  onUpdate: (patch: { note?: string; tags?: string[] }) => Promise<void>;
  onDelete: () => void;
};

function NoteCard({ note, color, citation, copied, onOpen, onCopy, onUpdate, onDelete }: CardProps) {
  const [text, setText] = useState(note.note);
  const [newTag, setNewTag] = useState("");

  const addTag = () => {
    const t = newTag.trim().replace(/^#/, "");
    if (t && !note.tags.includes(t)) onUpdate({ tags: [...note.tags, t] });
    setNewTag("");
  };

  return (
    <article className="relative rounded-xl border border-line-soft bg-panel py-3 pr-4 pl-5 animate-rise">
      <span className="absolute top-3 bottom-3 left-0 w-[3px] rounded-r" style={{ background: color }} />
      <blockquote className="font-serif text-[16.5px] leading-relaxed text-text">“{note.text}”</blockquote>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="font-mono">{citation}</span>
        <button onClick={onOpen} className="rounded bg-raised px-1.5 py-px font-mono text-[11px] text-soft transition hover:bg-accent hover:text-ink">
          p.{note.page} ↗
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== note.note && onUpdate({ note: text })}
        rows={1}
        placeholder="Add a note: why this matters, where to use it…"
        className="mt-2.5 w-full resize-y rounded-lg border border-transparent bg-panel-2 px-2.5 py-1.5 text-sm text-soft outline-none placeholder:text-dim focus:border-line"
      />

      <footer className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          {note.tags.map((t) => (
            <span key={t} className="flex items-center gap-1 rounded-full bg-raised px-2 py-0.5 text-soft">
              #{t}
              <button onClick={() => onUpdate({ tags: note.tags.filter((x) => x !== t) })} className="text-dim hover:text-bad" aria-label={`Remove tag ${t}`}>
                ×
              </button>
            </span>
          ))}
          <input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTag()}
            onBlur={addTag}
            placeholder="+ tag"
            className="w-16 bg-transparent text-xs text-soft outline-none placeholder:text-dim focus:w-24"
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-dim">Copy:</span>
          {(
            [
              ["quote", "Quote + citation"],
              ["intext", "In-text citation"],
              ["reference", "Reference"],
            ] as [CopyWhat, string][]
          ).map(([what, label]) => (
            <button key={what} onClick={() => onCopy(what)} className="text-accent transition hover:text-accent-hover">
              {copied === what ? "Copied ✓" : label}
            </button>
          ))}
          <button onClick={onDelete} className="ml-1 text-dim transition hover:text-bad">
            Delete
          </button>
        </div>
      </footer>
    </article>
  );
}

function ActionButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="rounded-lg border border-line px-2.5 py-1 text-soft transition hover:border-accent hover:text-accent">
      {children}
    </button>
  );
}
