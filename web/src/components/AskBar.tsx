"use client";

import { useState } from "react";
import type { Mode } from "@/lib/types";

type Props = {
  mode: Mode;
  setMode: (m: Mode) => void;
  onAsk: (q: string) => void;
  busy: boolean;
  suggestions: string[];
};

export default function AskBar({ mode, setMode, onAsk, busy, suggestions }: Props) {
  const [question, setQuestion] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  const submit = (q: string) => {
    if (busy || !q.trim()) return;
    onAsk(q.trim());
    setQuestion("");
    setShowSuggestions(false);
  };

  return (
    <div className="border-t border-line bg-panel-2 px-4 pt-3 pb-4">
      <div className="relative mx-auto max-w-3xl">
        {showSuggestions && (
          <div className="absolute right-0 bottom-full left-0 mb-2 rounded-xl border border-line bg-raised p-1.5 shadow-2xl shadow-black/50">
            {suggestions.map((s) => (
              <button
                key={s}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => submit(s)}
                className="block w-full rounded-lg px-3 py-2 text-left text-sm text-soft hover:bg-panel hover:text-text"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(question);
          }}
          className="flex items-end gap-2 rounded-2xl border border-line bg-panel p-2 transition focus-within:border-accent/60"
        >
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setShowSuggestions(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(question);
              }
            }}
            rows={1}
            placeholder="Ask a question about the paper…"
            className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] text-text outline-none placeholder:text-dim"
          />
          <button
            type="submit"
            disabled={busy || !question.trim()}
            className="h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-ink transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            Ask
          </button>
        </form>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
          <div className="flex rounded-lg border border-line p-0.5" role="radiogroup" aria-label="Answer mode">
            <ModeButton active={mode === "fast"} onClick={() => setMode("fast")} label="Fast" />
            <ModeButton active={mode === "scout"} onClick={() => setMode("scout")} label="Scout" />
          </div>
          <span className="text-dim">
            {mode === "fast"
              ? "One hybrid search, then an answer with page citations."
              : "Scout plans, searches several times and rephrases weak searches. Every step is shown."}
          </span>
        </div>
      </div>
    </div>
  );
}

function ModeButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`rounded-md px-3 py-1 font-medium transition ${active ? "bg-raised text-text" : "text-dim hover:text-soft"}`}
    >
      {label}
    </button>
  );
}
