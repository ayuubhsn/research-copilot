"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { highlightPage } from "@/lib/text";
import type { DocumentInfo, Note, SourceHit } from "@/lib/types";
import PdfPage, { type Highlight } from "./PdfPage";
import type { DocData, Focus, Turn } from "./Workspace";

export type ViewerTab = "page" | "map";

type Props = {
  tab: ViewerTab;
  setTab: (t: ViewerTab) => void;
  doc: DocumentInfo;
  fileUrl: string | null; // the original PDF; null in the demo, which shows the page text instead
  data: DocData;
  focus: Focus;
  setPage: (p: number) => void;
  turn: Turn | null;
  onSource: (hit: SourceHit) => void;
  notes: Note[]; // saved quotes in this document, shown in green
  onSaveSelection?: (page: number, text: string) => Promise<void>;
};

export default function Viewer(props: Props) {
  const { tab, setTab } = props;
  return (
    <section className="flex min-h-[70vh] w-full shrink-0 flex-col border-t border-line bg-panel-2 lg:min-h-0 lg:w-[44%] lg:max-w-[720px] lg:border-t-0">
      <div className="flex items-center gap-1.5 border-b border-line px-4 py-2.5">
        <TabButton active={tab === "page"} onClick={() => setTab("page")}>
          Page
        </TabButton>
        <TabButton active={tab === "map"} onClick={() => setTab("map")}>
          Map of the paper
        </TabButton>
      </div>
      {tab === "page" ? <PageView {...props} /> : <MapView {...props} />}
    </section>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm transition ${active ? "bg-raised font-medium text-text" : "text-muted hover:text-soft"}`}
    >
      {children}
    </button>
  );
}

function PageView({ doc, fileUrl, data, focus, setPage, turn, notes, onSaveSelection }: Props) {
  const sources = useMemo(() => (turn?.status === "done" ? (turn.result?.sources ?? []) : []), [turn]);
  const sourcePages = [...new Set(sources.map((s) => s.page))].sort((a, b) => a - b);
  const page = Math.min(Math.max(focus.page, 1), doc.pageCount);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-1">
          {sourcePages.length > 0 && <span className="mr-1 text-xs text-dim">Cited:</span>}
          {sourcePages.map((p) => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={`rounded px-1.5 py-px font-mono text-xs transition ${
                p === page ? "bg-accent text-ink" : "bg-raised text-muted hover:text-text"
              }`}
            >
              p.{p}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 font-mono text-xs text-muted">
          <PagerButton disabled={page <= 1} onClick={() => setPage(page - 1)} label="Previous page">
            ‹
          </PagerButton>
          <span className="px-1">
            page {page} of {doc.pageCount}
          </span>
          <PagerButton disabled={page >= doc.pageCount} onClick={() => setPage(page + 1)} label="Next page">
            ›
          </PagerButton>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {fileUrl ? (
          <>
            <PdfPage
              url={fileUrl}
              page={page}
              highlights={pdfHighlights(sources, notes, page, focus)}
              onSaveSelection={onSaveSelection ? (text) => onSaveSelection(page, text) : undefined}
            />
            {onSaveSelection && (
              <p className="mt-2 text-center text-xs text-dim">
                Select text on the page to save it to your notebook. <span className="text-mint">Green</span> marks what you saved.
              </p>
            )}
          </>
        ) : (
          <TextPage data={data} page={page} focus={focus} sources={sources} hasResult={!!turn?.result} />
        )}
      </div>
    </div>
  );
}

// Saved quotes are green, passages the answer used light yellow, and the one in focus strong yellow
function pdfHighlights(sources: SourceHit[], notes: Note[], page: number, focus: Focus): Highlight[] {
  const highlights: Highlight[] = notes.filter((n) => n.page === page && n.rects.length).map((n) => ({ rects: n.rects, kind: "saved" }));
  const onPage = sources.filter((s) => s.page === page && s.rects?.length);
  highlights.push(...onPage.map((s): Highlight => ({ rects: s.rects!, kind: "source" })));
  if (focus.page === page && focus.rects) {
    highlights.push({ rects: focus.rects, kind: "focus" });
  } else if (onPage[0]) {
    const focused = onPage.find((s) => s.chunk === focus.chunk) ?? onPage[0];
    highlights.push({ rects: focused.rects!, kind: "focus" });
  }
  return highlights;
}

type TextPageProps = { data: DocData; page: number; focus: Focus; sources: SourceHit[]; hasResult: boolean };

// The demo cannot publish the PDF itself, so it shows the extracted text of the page
function TextPage({ data, page, focus, sources, hasResult }: TextPageProps) {
  const current = data.pages.find((p) => p.page === page) ?? data.pages[0];
  const markRef = useRef<HTMLElement | null>(null);

  const segments = useMemo(() => {
    const onPage = sources.filter((s) => s.page === current.page).map((s) => s.text);
    const chunk = focus.chunk != null ? data.chunks[focus.chunk] : null;
    const active = chunk && chunk.page === current.page ? chunk.text : null;
    // Without a chosen passage, the strongest hit on the page is the focus
    return highlightPage(current.text, onPage, active ?? onPage[0] ?? null);
  }, [current, sources, focus, data.chunks]);

  useEffect(() => {
    markRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [segments]);

  const firstActive = segments.findIndex((seg) => seg.mark === "active");

  return (
    <article className="rounded-md bg-paper px-6 py-7 text-ink shadow-xl shadow-black/40 sm:px-8">
      <div className="mb-5 flex justify-between font-mono text-[11px] text-ink-soft">
        <span>{hasResult ? "" : "Ask a question to see where the answer comes from"}</span>
        <span>p. {current.page}</span>
      </div>
      <p className="font-serif text-[16.5px] leading-[1.75] break-words hyphens-auto">
        {segments.map((seg, i) => {
          if (seg.mark === "none") return <span key={i}>{seg.text}</span>;
          return (
            <mark
              key={i}
              ref={i === firstActive ? (el) => void (markRef.current = el) : undefined}
              className={
                seg.mark === "active"
                  ? "rounded-[2px] bg-accent px-0.5 text-ink"
                  : "rounded-[2px] bg-accent/25 text-ink underline decoration-accent decoration-2 underline-offset-2"
              }
            >
              {seg.text}
            </mark>
          );
        })}
      </p>
    </article>
  );
}

function PagerButton({ disabled, onClick, label, children }: { disabled: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded-md text-base transition hover:bg-raised hover:text-text disabled:opacity-30"
    >
      {children}
    </button>
  );
}

export const ISLAND_COLORS = ["#7CC4A4", "#8CA3FF", "#E9A86B", "#C99BE0", "#6FC3D9", "#D9C36F", "#E58A9A", "#9AB87A"];

function MapView({ data, turn, onSource, focus }: Props) {
  const { map, chunks } = data;
  const activeChunk = focus.chunk;
  const [hover, setHover] = useState<number | null>(null);
  const result = turn?.status === "done" ? turn.result : undefined;
  const hitScore = new Map((result?.sources ?? []).map((s) => [s.chunk, s.score]));
  const color = (island: number) => ISLAND_COLORS[island % ISLAND_COLORS.length];
  const flip = (y: number) => 100 - y; // the map's y axis points up, SVG's points down

  const hovered = hover != null ? chunks[hover] : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <p className="text-sm text-muted">
        Every dot is a passage, placed by meaning: passages about the same thing sit together. The colours are topic
        islands.{" "}
        {result ? "Lines show where the answer was found." : "Ask a question to see where in the paper the answer comes from."}
      </p>

      <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-line-soft bg-[#0B0F0E]">
        <svg viewBox="0 0 100 100" className="h-full w-full" role="img" aria-label="Knowledge map of the paper">

          {result?.position &&
            result.sources.map((s) => {
              const p = map.points[s.chunk];
              return (
                <line
                  key={`line-${s.chunk}`}
                  x1={result.position!.x}
                  y1={flip(result.position!.y)}
                  x2={p.x}
                  y2={flip(p.y)}
                  stroke="#F2D04B"
                  strokeWidth={0.25}
                  strokeDasharray="0.8 0.8"
                  opacity={0.3 + 0.6 * Math.max(0, s.score)}
                />
              );
            })}

          {map.points.map((p, i) => {
            const isHit = hitScore.has(i);
            return (
              <circle
                key={i}
                cx={p.x}
                cy={flip(p.y)}
                r={isHit ? 1.35 : 0.85}
                fill={color(p.island)}
                opacity={result && !isHit ? 0.35 : 0.85}
                stroke={isHit ? "#F2D04B" : i === hover || i === activeChunk ? "#ECEDE8" : "none"}
                strokeWidth={0.45}
                className="cursor-pointer"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onSource({ chunk: i, page: p.page, score: hitScore.get(i) ?? 0, text: chunks[i].text })}
              />
            );
          })}

          {result?.position && <Star x={result.position.x} y={flip(result.position.y)} />}
        </svg>

        {hovered && (
          <div className="pointer-events-none absolute right-2 bottom-2 left-2 rounded-lg border border-line bg-raised/95 p-2.5 text-xs shadow-xl">
            <div className="mb-1 font-mono text-accent">
              p.{hovered.page}
              {hitScore.has(hover!) && <span className="ml-2 text-mint">used for the answer</span>}
            </div>
            <div className="line-clamp-3 text-soft">{hovered.text}</div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1.5">
        {map.islands.map((island) => (
          <span key={island.id} className="flex items-center gap-1.5 text-xs text-muted">
            <span className="h-2 w-2 rounded-full" style={{ background: color(island.id) }} />
            {island.label}
            <span className="text-dim">({island.size})</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Star({ x, y }: { x: number; y: number }) {
  const points = Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 === 0 ? 2.6 : 1.1;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    return `${x + r * Math.cos(a)},${y + r * Math.sin(a)}`;
  }).join(" ");
  return (
    <g>
      <title>Your question</title>
      <polygon points={points} fill="#F2D04B" stroke="#0E1211" strokeWidth={0.3} />
    </g>
  );
}
