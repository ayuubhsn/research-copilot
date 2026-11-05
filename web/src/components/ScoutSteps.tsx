import type { TraceStep } from "@/lib/types";
import { ScoreBar } from "./Thread";

type Props = {
  trace: TraceStep[];
  revealed: number;
  onCite: (page: number) => void;
};

// Scout's log: its plan and every search, with how good the best hit was.
// Answer and fact-check steps are shown elsewhere, so they are skipped here.
export default function ScoutSteps({ trace, revealed, onCite }: Props) {
  const steps = trace.filter((s) => s.type === "think" || s.type === "search").slice(0, revealed);
  if (steps.length === 0) return null;
  const searchNumber = new Map<number, number>();
  steps.forEach((step, i) => step.type === "search" && searchNumber.set(i, searchNumber.size + 1));

  return (
    <ol className="relative mb-4 flex flex-col gap-3 border-l border-line pl-5">
      {steps.map((step, i) => {
        if (step.type === "think") {
          return (
            <li key={i} className="relative animate-rise">
              <Dot className="bg-muted" />
              <div className="text-xs font-medium text-muted">Plan</div>
              <div className="text-sm text-soft">{step.text}</div>
            </li>
          );
        }
        if (step.type !== "search") return null;
        const pages = [...new Set(step.hits.map((h) => h.page))];

        return (
          <li key={i} className="relative animate-rise">
            <Dot className={step.weak ? "bg-warn" : "bg-accent"} />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className="font-medium text-muted">Search {searchNumber.get(i)}</span>
              {step.weak ? (
                <span className="text-warn">weak match, will rephrase</span>
              ) : (
                <span className="text-mint">{step.phrase_found ? "exact phrase found" : "good match"}</span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <code className="rounded bg-panel-2 px-2 py-1 font-mono text-[13px] text-text">“{step.query}”</code>
              <ScoreBar score={step.best} weak={step.weak} />
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {pages.map((p) => (
                <button
                  key={p}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCite(p);
                  }}
                  className="rounded bg-raised px-1.5 py-px font-mono text-[11px] text-muted transition hover:bg-accent hover:text-ink"
                >
                  p.{p}
                </button>
              ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Dot({ className }: { className: string }) {
  return <span className={`absolute top-1.5 -left-[24.5px] h-2 w-2 rounded-full ring-4 ring-panel ${className}`} />;
}
