"use client";

import { useEffect, useRef, useState } from "react";
import { answerWithReferences, copyRich, STYLES, type Style } from "@/lib/cite";
import { collapse, splitCitations } from "@/lib/text";
import type { Citation, Claim, ClaimStatus, DocumentInfo, SourceHit } from "@/lib/types";
import ScoutSteps from "./ScoutSteps";
import type { Turn } from "./Workspace";

type Props = {
  turns: Turn[];
  activeId: number | null;
  doc: DocumentInfo;
  suggestions: string[];
  onAsk: (q: string) => void;
  onFocus: (id: number) => void;
  onCite: (page: number) => void;
  onSource: (hit: SourceHit) => void;
  onClaim: (claim: Claim) => void;
  onSaveSource?: (hit: SourceHit) => void;
  style: Style;
  setStyle: (s: Style) => void;
};

export default function Thread(props: Props) {
  const { turns, activeId, doc, suggestions, onAsk, onFocus, onCite, onSource, onClaim, onSaveSource, style, setStyle } = props;
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
            onClaim={onClaim}
            onSaveSource={onSaveSource}
            citation={doc.citation}
            style={style}
            setStyle={setStyle}
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
  onClaim: (claim: Claim) => void;
  onSaveSource?: (hit: SourceHit) => void;
  citation?: Citation;
  style: Style;
  setStyle: (s: Style) => void;
};

function TurnView({ turn, active, onFocus, onCite, onSource, onClaim, onSaveSource, citation, style, setStyle }: TurnProps) {
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
            {citation && splitCitations(result.answer).some((p) => p.kind === "cite") && (
              <CopyAnswer answer={result.answer} citation={citation} style={style} setStyle={setStyle} />
            )}
            <FactCheck claims={result.claims} removed={result.removed} gaveUp={result.gaveUp} onClaim={onClaim} />
            <Sources sources={result.sources} onSource={onSource} onSave={onSaveSource} />
          </div>
        )}
      </div>
    </article>
  );
}

// Copies the answer with its page tags turned into in-text citations, plus the reference
function CopyAnswer({ answer, citation, style, setStyle }: { answer: string; citation: Citation; style: Style; setStyle: (s: Style) => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={async () => {
          const { html, plain } = answerWithReferences(answer, citation, style);
          await copyRich(html, plain);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }}
        className="rounded-lg border border-line px-2.5 py-1 text-soft transition hover:border-accent hover:text-accent"
      >
        {copied ? "Copied ✓" : "Copy answer with references"}
      </button>
      <select
        value={style}
        onChange={(e) => setStyle(e.target.value as Style)}
        aria-label="Citation style"
        className="rounded-lg border border-line bg-panel-2 px-2 py-1 text-soft outline-none"
      >
        {STYLES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      {citation.source === "pdf" && <span className="text-warn">Paper details guessed from the PDF; check them first.</span>}
    </div>
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

type FactCheckProps = { claims: Claim[]; removed: number; gaveUp: boolean; onClaim: (claim: Claim) => void };

const statusOf = (c: Claim): ClaimStatus => c.status ?? (c.supported ? "supported" : "unsupported");

const STATUS: Record<ClaimStatus, { icon: string; label: string; badge: string; text: string }> = {
  supported: { icon: "✓", label: "Supported", badge: "bg-mint text-ink", text: "text-soft" },
  partial: { icon: "◐", label: "Partly supported", badge: "bg-warn text-ink", text: "text-soft" },
  unsupported: { icon: "✗", label: "Removed", badge: "bg-bad text-ink", text: "text-bad line-through" },
};

// Every claim with its status. Removed claims are shown with the reason, never dropped silently.
function FactCheck({ claims, gaveUp, onClaim }: FactCheckProps) {
  const [open, setOpen] = useState(false);
  if (gaveUp || claims.length === 0) return null;
  const count = (status: ClaimStatus) => claims.filter((c) => statusOf(c) === status).length;
  const removedClaims = claims.filter((c) => statusOf(c) === "unsupported");
  const partial = count("partial");
  const summary = [
    `${count("supported")} supported`,
    partial ? `${partial} partly supported` : "",
    removedClaims.length ? `${removedClaims.length} removed` : "",
  ].filter(Boolean);
  const icon = removedClaims.length ? STATUS.unsupported : partial ? STATUS.partial : STATUS.supported;

  return (
    <>
      {removedClaims.length > 0 && (
        <div className="mt-4 rounded-xl border border-bad/30 bg-bad/5 px-3.5 py-2.5 text-sm">
          <div className="mb-1 text-xs font-semibold tracking-wide text-bad uppercase">
            Removed from the answer · not backed by the sources
          </div>
          {removedClaims.map((c, i) => (
            <div key={i} className="mt-1.5">
              <span className="text-muted line-through">{c.claim}</span>
              {c.reason && <div className="text-xs text-soft">Why: {c.reason}</div>}
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 rounded-xl border border-line-soft bg-panel-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!open);
          }}
          className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-sm"
        >
          <span className="flex items-center gap-2">
            <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${icon.badge}`}>{icon.icon}</span>
            <span className="text-soft">
              Fact-checked {claims.length} {claims.length === 1 ? "claim" : "claims"}: {summary.join(" · ")}
            </span>
          </span>
          <span className="text-xs text-dim">{open ? "Hide" : "Show"}</span>
        </button>
        {open && (
          <ul className="flex flex-col gap-3 border-t border-line-soft px-3.5 py-3">
            {claims.map((c, i) => {
              const st = STATUS[statusOf(c)];
              return (
                <li key={i} className="text-sm">
                  <div className="flex items-start gap-2">
                    <span
                      title={st.label}
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${st.badge}`}
                    >
                      {st.icon}
                    </span>
                    <span className={st.text}>{c.claim}</span>
                  </div>
                  {c.reason && statusOf(c) !== "supported" && <div className="mt-1 ml-6 text-xs text-warn">{c.reason}</div>}
                  {c.evidence && (
                    <div className="mt-1 ml-6 flex items-start gap-2">
                      {c.page && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onClaim(c);
                          }}
                          title="Show this quote in the PDF"
                          className="mt-0.5 shrink-0 rounded bg-raised px-1.5 py-px font-mono text-[11px] text-muted transition hover:bg-accent hover:text-ink"
                        >
                          p.{c.page}
                        </button>
                      )}
                      <span className="font-serif text-[15px] text-muted italic">“{c.evidence}”</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

type SourcesProps = { sources: SourceHit[]; onSource: (hit: SourceHit) => void; onSave?: (hit: SourceHit) => void };

function Sources({ sources, onSource, onSave }: SourcesProps) {
  const [open, setOpen] = useState(false);
  const shown = open ? sources : sources.slice(0, 3);

  return (
    <div className="mt-4">
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Passages it read</h3>
      <div className="flex flex-col gap-1.5">
        {shown.map((s) => (
          <div key={s.chunk} className="group flex items-start gap-1 rounded-lg transition hover:bg-raised">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSource(s);
              }}
              className="flex min-w-0 flex-1 items-start gap-3 px-2 py-1.5 text-left"
            >
              <span className="mt-0.5 shrink-0 rounded bg-raised px-1.5 py-px font-mono text-xs text-soft group-hover:bg-accent group-hover:text-ink">
                p.{s.page}
              </span>
              <span className="line-clamp-2 min-w-0 flex-1 text-sm text-muted">{collapse(s.text)}</span>
              <ScoreBar score={s.score} />
            </button>
            {onSave && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSave(s);
                }}
                title="Save this passage to your notebook"
                aria-label="Save this passage to your notebook"
                className="mt-1 mr-1 rounded-md px-1.5 py-0.5 text-sm text-dim opacity-0 transition group-hover:opacity-100 hover:text-accent focus:opacity-100"
              >
                ☆
              </button>
            )}
          </div>
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
