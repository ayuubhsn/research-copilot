"use client";

import { useEffect, useRef, useState } from "react";
import { collapse, splitCitations } from "@/lib/text";
import type { Chunk, DocumentInfo, SourceHit } from "@/lib/types";
import ScoutSteps from "./ScoutSteps";
import type { Turn } from "./Workspace";

type Props = {
  turns: Turn[];
  activeId: number | null;
  doc: DocumentInfo;
  suggestions: string[];
  chunks: Chunk[];
  onAsk: (q: string) => void;
  onFocus: (id: number) => void;
  onCite: (page: number) => void;
  onSource: (hit: SourceHit) => void;
};

export default function Thread({ turns, activeId, doc, suggestions, onAsk, onFocus, onCite, onSource }: Props) {
  const bottom = useRef<HTMLDivElement>(null);
  const last = turns[turns.length - 1];

  // Follow the newest turn while it is being answered
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, last?.revealed, last?.status]);

  if (turns.length === 0) return <EmptyState doc={doc} suggestions={suggestions} onAsk={onAsk} />;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-5 py-6">
        {turns.map((turn) => (
          <TurnView
            key={turn.id}
            turn={turn}
            active={turn.id === activeId}
            onFocus={() => onFocus(turn.id)}
            onCite={onCite}
            onSource={onSource}
          />
        ))}
        <div ref={bottom} />
      </div>
    </div>
  );
}

function EmptyState({ doc, suggestions, onAsk }: { doc: DocumentInfo; suggestions: string[]; onAsk: (q: string) => void }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col px-5 py-10 sm:py-16">
        <h1 className="font-serif text-4xl leading-tight tracking-tight sm:text-5xl">
          Ask the paper.
          <br />
          <span className="text-muted">Check every answer.</span>
        </h1>
        <p className="mt-4 max-w-lg text-soft">
          Answers come only from <span className="font-mono text-sm text-text">{doc.file}</span>, with the page behind
          every claim. Click a page tag to see the passage. If the answer isn&apos;t in the paper, it says so.
        </p>
        <h2 className="mt-9 mb-3 text-xs font-semibold tracking-wide text-muted uppercase">Try one of these</h2>
        <div className="flex flex-col gap-2">
          {suggestions.map((q) => (
            <button
              key={q}
              onClick={() => onAsk(q)}
              className="group flex items-center justify-between gap-4 rounded-xl border border-line bg-panel px-4 py-3 text-left text-[15px] transition hover:border-accent/60 hover:bg-raised"
            >
              {q}
              <span className="text-dim transition group-hover:translate-x-0.5 group-hover:text-accent">→</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

type TurnProps = {
  turn: Turn;
  active: boolean;
  onFocus: () => void;
  onCite: (page: number) => void;
  onSource: (hit: SourceHit) => void;
};

function TurnView({ turn, active, onFocus, onCite, onSource }: TurnProps) {
  const result = turn.result;
  const done = turn.status === "done" && result;

  return (
    <article className="animate-rise" onClick={onFocus}>
      <div className="mb-3 flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-raised px-4 py-2.5 text-[15px]">{turn.question}</div>
      </div>

      <div
        className={`rounded-2xl border p-4 transition sm:p-5 ${active ? "border-line bg-panel" : "border-line-soft bg-panel/60"}`}
      >
        <div className="mb-3 flex items-center gap-2 text-xs">
          <span
            className={`rounded-full px-2 py-0.5 font-medium ${
              turn.mode === "scout" ? "bg-accent/15 text-accent" : "bg-mint/15 text-mint"
            }`}
          >
            {turn.mode === "scout" ? "Scout · deep search" : "Fast answer"}
          </span>
          {done && (
            <span className="text-dim">
              {result.searches} {result.searches === 1 ? "search" : "searches"} · {result.sources.length} passages
            </span>
          )}
        </div>

        {turn.mode === "scout" && result && (
          <ScoutSteps trace={result.trace} revealed={turn.revealed} onCite={onCite} />
        )}

        {turn.status === "running" && <Working phase={turn.phase} />}

        {turn.status === "error" && (
          <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2.5 text-sm text-warn">{turn.error}</p>
        )}

        {done && (
          <div className="animate-rise">
            {result.gaveUp && (
              <p className="mb-3 text-sm text-warn">
                Scout stopped after {result.searches} weak searches in a row instead of guessing.
              </p>
            )}
            <Answer text={result.answer} onCite={onCite} />
            <FactCheck claims={result.claims} removed={result.removed} gaveUp={result.gaveUp} />
            <Sources sources={result.sources} onSource={onSource} />
          </div>
        )}
      </div>
    </article>
  );
}

function Working({ phase }: { phase: string }) {
  return (
    <div className="flex items-center gap-2.5 py-1 text-sm text-muted">
      <span className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-accent" style={{ animationDelay: `${i * 0.18}s` }} />
        ))}
      </span>
      {phase}…
    </div>
  );
}

export function Answer({ text, onCite }: { text: string; onCite: (page: number) => void }) {
  return (
    <p className="font-serif text-[19px] leading-[1.6] text-text">
      {splitCitations(text).map((part, i) =>
        part.kind === "text" ? (
          <span key={i}>{part.text}</span>
        ) : (
          <span key={i} className="whitespace-nowrap">
            {part.pages.map((p) => (
              <button
                key={p}
                onClick={(e) => {
                  e.stopPropagation();
                  onCite(p);
                }}
                title={part.raw}
                className="mx-0.5 rounded bg-accent px-1.5 py-px align-[2px] font-mono text-xs font-medium text-ink transition hover:bg-accent-hover"
              >
                p.{p}
              </button>
            ))}
          </span>
        ),
      )}
    </p>
  );
}

function FactCheck({ claims, removed, gaveUp }: { claims: { claim: string; supported: boolean; evidence?: string }[]; removed: number; gaveUp: boolean }) {
  const [open, setOpen] = useState(false);
  if (gaveUp || claims.length === 0) return null;
  const ok = removed === 0;

  return (
    <div className="mt-4 rounded-xl border border-line-soft bg-panel-2">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-sm"
      >
        <span className="flex items-center gap-2">
          <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${ok ? "bg-mint text-ink" : "bg-warn text-ink"}`}>
            {ok ? "✓" : "!"}
          </span>
          <span className="text-soft">
            Fact-checked: {claims.length} {claims.length === 1 ? "claim" : "claims"},{" "}
            {ok ? "all supported by the sources" : `${removed} removed as unsupported`}
          </span>
        </span>
        <span className="text-xs text-dim">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <ul className="flex flex-col gap-2.5 border-t border-line-soft px-3.5 py-3">
          {claims.map((c, i) => (
            <li key={i} className="text-sm">
              <div className="flex gap-2">
                <span className={c.supported ? "text-mint" : "text-bad"}>{c.supported ? "✓" : "✗"}</span>
                <span className={c.supported ? "text-soft" : "text-bad line-through"}>{c.claim}</span>
              </div>
              {c.evidence && <div className="mt-1 ml-5 font-serif text-[15px] text-muted italic">“{c.evidence}”</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Sources({ sources, onSource }: { sources: SourceHit[]; onSource: (hit: SourceHit) => void }) {
  const [open, setOpen] = useState(false);
  const shown = open ? sources : sources.slice(0, 3);

  return (
    <div className="mt-4">
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Passages it read</h3>
      <div className="flex flex-col gap-1.5">
        {shown.map((s) => (
          <button
            key={s.chunk}
            onClick={(e) => {
              e.stopPropagation();
              onSource(s);
            }}
            className="group flex items-start gap-3 rounded-lg px-2 py-1.5 text-left transition hover:bg-raised"
          >
            <span className="mt-0.5 shrink-0 rounded bg-raised px-1.5 py-px font-mono text-xs text-soft group-hover:bg-accent group-hover:text-ink">
              p.{s.page}
            </span>
            <span className="line-clamp-2 min-w-0 flex-1 text-sm text-muted">{collapse(s.text)}</span>
            <ScoreBar score={s.score} />
          </button>
        ))}
      </div>
      {sources.length > 3 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!open);
          }}
          className="mt-1 px-2 text-xs text-dim hover:text-accent"
        >
          {open ? "Show fewer" : `Show all ${sources.length}`}
        </button>
      )}
    </div>
  );
}

export function ScoreBar({ score, weak = false }: { score: number; weak?: boolean }) {
  const width = Math.max(4, Math.min(100, score * 100));
  return (
    <span className="mt-1.5 flex shrink-0 items-center gap-1.5" title={`Similarity ${score.toFixed(2)}`}>
      <span className="h-1 w-12 overflow-hidden rounded-full bg-line">
        <span className={`block h-full rounded-full ${weak ? "bg-warn" : "bg-mint"}`} style={{ width: `${width}%` }} />
      </span>
      <span className="w-7 font-mono text-[11px] text-dim">{score.toFixed(2)}</span>
    </span>
  );
}
