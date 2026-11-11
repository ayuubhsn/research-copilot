"use client";

import { useState } from "react";
import { reference, toHtml } from "@/lib/cite";
import type { Citation, DocumentInfo, PaperType } from "@/lib/types";

type Props = {
  doc: DocumentInfo;
  onSave: (citation: Citation) => Promise<void>;
  onLookup: (query: { doi?: string; title?: string }) => Promise<Citation>;
  onClose: () => void;
};

const TYPES: { id: PaperType; label: string }[] = [
  { id: "article", label: "Journal article" },
  { id: "preprint", label: "Preprint" },
  { id: "conference", label: "Conference paper" },
  { id: "book", label: "Book" },
  { id: "chapter", label: "Book chapter" },
  { id: "report", label: "Report" },
];

const empty = (doc: DocumentInfo): Citation => ({
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

// One author per line, "Family, Given"
const authorsToText = (c: Citation) => c.authors.map((a) => (a.given ? `${a.family}, ${a.given}` : a.family)).join("\n");
const textToAuthors = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [family, ...given] = line.split(",");
      return { family: family.trim(), given: given.join(",").trim() };
    });

export default function CitationEditor({ doc, onSave, onLookup, onClose }: Props) {
  const [c, setC] = useState<Citation>(doc.citation ?? empty(doc));
  const [authors, setAuthors] = useState(authorsToText(doc.citation ?? empty(doc)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookup, setLookup] = useState<{ busy: boolean; message: string | null; ok: boolean }>({ busy: false, message: null, ok: false });

  // Fills the form from Crossref or doi.org; the user still checks and saves
  const runLookup = async (query: { doi?: string; title?: string }) => {
    setLookup({ busy: true, message: null, ok: false });
    try {
      const found = await onLookup(query);
      setC(found);
      setAuthors(authorsToText(found));
      setLookup({ busy: false, message: "Filled in from the DOI register. Check the details, then save.", ok: true });
    } catch (e) {
      setLookup({ busy: false, message: e instanceof Error ? e.message : String(e), ok: false });
    }
  };

  const draft: Citation = { ...c, authors: textToAuthors(authors) };
  const set = (patch: Partial<Citation>) => setC((prev) => ({ ...prev, ...patch }));

  const save = async () => {
    setSaving(true);
    try {
      await onSave({ ...draft, source: "user" });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Edit paper details" className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
        <header className="border-b border-line px-5 py-4">
          <h2 className="font-serif text-2xl">Paper details</h2>
          <p className="mt-1 text-xs text-muted">
            {doc.citation?.source === "doi"
              ? `Looked up from the DOI. Check them, then save.`
              : "Guessed from the PDF. Fill in what is missing so references come out right."}
          </p>
        </header>

        <div className="grid min-h-0 grid-cols-6 gap-3 overflow-y-auto px-5 py-4 text-sm">
          <Field label="Title" span={6}>
            <div className="flex gap-2">
              <input value={c.title} onChange={(e) => set({ title: e.target.value })} className={input} />
              <button
                type="button"
                disabled={lookup.busy || c.title.trim().length < 12}
                onClick={() => runLookup({ title: c.title })}
                title="Search the title in Crossref and fill in authors, journal and year"
                className={lookupButton}
              >
                {lookup.busy ? "Searching…" : "Find by title"}
              </button>
            </div>
          </Field>
          {lookup.message && <p className={`col-span-6 -mt-1 text-xs ${lookup.ok ? "text-mint" : "text-warn"}`}>{lookup.message}</p>}
          <Field label="Authors · one per line, Family, Given" span={6}>
            <textarea value={authors} onChange={(e) => setAuthors(e.target.value)} rows={3} className={`${input} resize-y font-mono text-xs`} placeholder={"Liu, Nelson F.\nLin, Kevin"} />
          </Field>
          <Field label="Type" span={3}>
            <select value={c.type} onChange={(e) => set({ type: e.target.value as PaperType })} className={input}>
              {TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Year" span={3}>
            <input
              value={c.year ?? ""}
              onChange={(e) => set({ year: e.target.value ? Number(e.target.value.replace(/\D/g, "")) || null : null })}
              inputMode="numeric"
              className={input}
            />
          </Field>
          <Field label={c.type === "preprint" ? "Repository (e.g. arXiv)" : c.type === "article" ? "Journal" : "Book or proceedings"} span={6}>
            <input value={c.container} onChange={(e) => set({ container: e.target.value })} className={input} />
          </Field>
          <Field label="Volume" span={2}>
            <input value={c.volume} onChange={(e) => set({ volume: e.target.value })} className={input} />
          </Field>
          <Field label="Issue" span={2}>
            <input value={c.issue} onChange={(e) => set({ issue: e.target.value })} className={input} />
          </Field>
          <Field label="Pages" span={2}>
            <input value={c.pages} onChange={(e) => set({ pages: e.target.value })} placeholder="257–272" className={input} />
          </Field>
          <Field label="Publisher" span={3}>
            <input value={c.publisher} onChange={(e) => set({ publisher: e.target.value })} className={input} />
          </Field>
          <Field label="DOI" span={3}>
            <div className="flex gap-2">
              <input value={c.doi ?? ""} onChange={(e) => set({ doi: e.target.value.trim().replace(/^https?:\/\/doi\.org\//, "") || null })} className={`${input} font-mono text-xs`} />
              <button type="button" disabled={lookup.busy || !c.doi} onClick={() => runLookup({ doi: c.doi ?? "" })} className={lookupButton}>
                Look up
              </button>
            </div>
          </Field>
          <div className="col-span-6 rounded-lg bg-panel-2 px-3 py-2.5">
            <div className="mb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">Preview · APA 7</div>
            <p className="text-xs leading-relaxed text-soft" dangerouslySetInnerHTML={{ __html: toHtml(reference(draft, "apa")) }} />
          </div>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
          <span className="text-xs text-bad">{error}</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-muted hover:text-text">
              Cancel
            </button>
            <button onClick={save} disabled={saving || !c.title.trim()} className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-ink hover:bg-accent-hover disabled:opacity-50">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

const lookupButton =
  "shrink-0 rounded-lg border border-line px-2.5 text-xs whitespace-nowrap text-soft transition hover:border-accent hover:text-accent disabled:opacity-40";
const input = "w-full rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-text outline-none focus:border-accent/60";

function Field({ label, span, children }: { label: string; span: number; children: React.ReactNode }) {
  const spans: Record<number, string> = { 2: "col-span-2", 3: "col-span-3", 6: "col-span-6" };
  return (
    <label className={`flex flex-col gap-1 ${spans[span]}`}>
      <span className="text-[11px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
