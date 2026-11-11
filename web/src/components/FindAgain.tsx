"use client";

import { useState } from "react";
import { shortLabel } from "@/lib/cite";
import { collapse } from "@/lib/text";
import type { DocumentInfo, Note, SearchHit } from "@/lib/types";

type Props = {
  docs: DocumentInfo[];
  colors: Record<string, string>;
  notes: Note[];
  search: (query: string, docIds?: string[]) => Promise<SearchHit[]>;
  onOpen: (hit: SearchHit) => void;
  onSave: (hit: SearchHit) => Promise<void>;
};

const STOP = new Set("a an the of in on at to for and or is are was were be been it its this that with as by from what which when how why".split(" "));

// Words from the query, for marking where a hit matches what the reader typed
function queryWords(query: string) {
  return [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])].filter((w) => w.length > 2 && !STOP.has(w));
}

function Marked({ text, words }: { text: string; words: string[] }) {
  if (words.length === 0) return <>{text}</>;
  // A word matches if it starts like a query word ("degrades" matches "degrade")
  const stems = words.map((w) => w.slice(0, Math.max(4, w.length - 2)));
  const pattern = new RegExp(`\\b(${stems.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})[\\p{L}\\p{N}]*`, "giu");
  const out: React.ReactNode[] = [];
  let i = 0;
  for (const match of text.matchAll(pattern)) {
    const before = text.slice(i, match.index);
    if (before) out.push(before);
    out.push(
      <em key={match.index} className="border-b-2 border-accent bg-accent/15 px-px text-text not-italic">
        {match[0]}
      </em>,
    );
    i = match.index + match[0].length;
  }
  out.push(text.slice(i));
  return <>{out}</>;
}

export default function FindAgain({ docs, colors, notes, search, onOpen, onSave }: Props) {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [only, setOnly] = useState<string | null>(null);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [state, setState] = useState<{ busy: boolean; ms: number | null; error: string | null }>({ busy: false, ms: null, error: null });
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const run = async (q = query, filter = only) => {
    if (!q.trim()) return;
    setState({ busy: true, ms: null, error: null });
    const started = performance.now();
    try {
      const found = await search(q.trim(), filter ? [filter] : undefined);
      setHits(found);
      setSearched(q.trim());
      setState({ busy: false, ms: Math.round(performance.now() - started), error: null });
    } catch (error) {
      setState({ busy: false, ms: null, error: error instanceof Error ? error.message : String(error) });
    }
  };

  const docById = new Map(docs.map((d) => [d.id, d]));
  const isSaved = (hit: SearchHit) => notes.some((n) => n.docId === hit.docId && n.page === hit.page && collapse(n.text) === collapse(hit.text));
  const words = queryWords(searched);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col px-5 py-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
          className="flex items-center gap-3 rounded-2xl border border-line bg-panel px-4 py-3 transition focus-within:border-accent/60"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-muted" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What do you remember? Your own words are fine…"
            className="min-w-0 flex-1 bg-transparent text-[16px] text-text outline-none placeholder:text-dim"
          />
          <button
            type="submit"
            disabled={state.busy || !query.trim()}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-ink transition hover:bg-accent-hover disabled:opacity-40"
          >
            {state.busy ? "Searching…" : "Find"}
          </button>
        </form>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs">
          <span className="text-dim">
            {hits && state.ms != null ? (
              <>
                {hits.length} passages · {(state.ms / 1000).toFixed(2)} s · <span className="text-mint">no AI call, free</span>
              </>
            ) : (
              "Searches every paper by meaning and by exact words. No AI, so it is instant and free."
            )}
          </span>
          {docs.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              <FilterChip active={only === null} onClick={() => (setOnly(null), hits && run(query, null))}>
                All papers
              </FilterChip>
              {docs.map((d) => (
                <FilterChip key={d.id} active={only === d.id} onClick={() => (setOnly(d.id), hits && run(query, d.id))}>
                  <span className="h-2 w-2 rounded-full" style={{ background: colors[d.id] }} />
                  {shortLabel(d.citation, d.file).split(",")[0]}
                </FilterChip>
              ))}
            </div>
          )}
        </div>

        {state.error && <p className="mt-4 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2.5 text-sm text-bad">{state.error}</p>}

        {hits && hits.length === 0 && <p className="mt-8 text-center text-sm text-muted">Nothing matched. Try other words.</p>}

        <div className="mt-4 flex flex-col gap-2.5">
          {hits?.map((hit) => {
            const doc = docById.get(hit.docId);
            const key = `${hit.docId}-${hit.chunk}`;
            const saved = isSaved(hit);
            return (
              <article
                key={key}
                onClick={() => {
                  setActiveKey(key);
                  onOpen(hit);
                }}
                className={`relative cursor-pointer rounded-xl border py-3 pr-4 pl-5 transition animate-rise ${
                  activeKey === key ? "border-line bg-raised" : "border-line-soft bg-panel hover:border-line"
                }`}
              >
                <span className="absolute top-3 bottom-3 left-0 w-[3px] rounded-r" style={{ background: doc ? colors[doc.id] : "#6e7772" }} />
                <header className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                  <span className="flex min-w-0 items-center gap-2">
                    <b className="truncate font-medium text-text">{doc?.citation?.title || doc?.file}</b>
                    <span className="shrink-0">{shortLabel(doc?.citation, doc?.file ?? "")}</span>
                    <span className="shrink-0 rounded bg-raised px-1.5 py-px font-mono text-[11px] text-soft">p.{hit.page}</span>
                  </span>
                  <span className="flex items-center gap-1.5" title={`Similarity ${hit.score.toFixed(2)}`}>
                    <span className="h-1 w-11 overflow-hidden rounded-full bg-line">
                      <span className="block h-full rounded-full bg-mint" style={{ width: `${Math.max(4, Math.min(100, hit.score * 100))}%` }} />
                    </span>
                    <span className="font-mono text-[11px] text-dim">{hit.score.toFixed(2)}</span>
                  </span>
                </header>
                <p className="font-serif text-[16.5px] leading-relaxed text-soft">
                  <Marked text={collapse(hit.text)} words={words} />
                </p>
                <footer className="mt-2 flex gap-4 text-xs">
                  <span className="text-dim">Open in PDF ↗</span>
                  <button
                    disabled={saved}
                    onClick={async (e) => {
                      e.stopPropagation();
                      await onSave(hit);
                    }}
                    className={saved ? "text-accent" : "text-dim transition hover:text-accent"}
                  >
                    {saved ? "★ Saved to notebook" : "☆ Save quote"}
                  </button>
                </footer>
              </article>
            );
          })}
        </div>

        {!hits && (
          <div className="mt-10 rounded-2xl border border-dashed border-line px-6 py-8 text-center">
            <p className="font-serif text-2xl">&ldquo;Where did I read that?&rdquo;</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted">
              Describe what you remember, even roughly. You get the exact passage, the paper and the page, and the PDF
              opens with it highlighted.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 whitespace-nowrap transition ${
        active ? "border-soft text-text" : "border-line text-muted hover:text-soft"
      }`}
    >
      {children}
    </button>
  );
}
