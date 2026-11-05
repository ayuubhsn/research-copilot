"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createDemoApi, DemoUnsupportedQuestion, type ResearchApi } from "@/lib/api";
import type { AskResult, Chunk, DocumentInfo, KnowledgeMap, Mode, Page, SourceHit } from "@/lib/types";
import AskBar from "./AskBar";
import Sidebar from "./Sidebar";
import Thread from "./Thread";
import TopBar from "./TopBar";
import Viewer, { type ViewerTab } from "./Viewer";

export type Turn = {
  id: number;
  question: string;
  mode: Mode;
  status: "running" | "done" | "error";
  phase: string; // what the app is doing right now, shown while running
  revealed: number; // Scout steps shown so far
  result?: AskResult;
  error?: string;
};

type Loaded = {
  api: ResearchApi;
  doc: DocumentInfo;
  pages: Page[];
  chunks: Chunk[];
  map: KnowledgeMap;
  suggestions: string[];
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function Workspace() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("fast");
  const [tab, setTab] = useState<ViewerTab>("page");
  const [page, setPage] = useState(1);
  const [activeChunk, setActiveChunk] = useState<number | null>(null);
  const nextId = useRef(1);

  useEffect(() => {
    (async () => {
      try {
        const api = await createDemoApi();
        const [doc] = await api.documents();
        const [pages, chunks, map, suggestions] = await Promise.all([
          api.pages(doc.id),
          api.chunks(doc.id),
          api.map(doc.id),
          api.suggestions(doc.id),
        ]);
        setLoaded({ api, doc, pages, chunks, map, suggestions });
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : String(error));
      }
    })();
  }, []);

  const update = (id: number, patch: Partial<Turn>) =>
    setTurns((all) => all.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const showSource = useCallback((hit: SourceHit) => {
    setTab("page");
    setPage(hit.page);
    setActiveChunk(hit.chunk);
  }, []);

  const showPage = useCallback((p: number) => {
    setTab("page");
    setPage(p);
    setActiveChunk(null);
  }, []);

  const ask = useCallback(
    async (question: string) => {
      if (!loaded || !question.trim()) return;
      const id = nextId.current++;
      setTurns((all) => [...all, { id, question, mode, status: "running", phase: "Searching the paper", revealed: 0 }]);
      setActiveId(id);

      try {
        const result = await loaded.api.ask(loaded.doc.id, question, mode);

        // The demo replays recorded runs at a readable pace
        if (!loaded.api.live) {
          if (mode === "scout") {
            const steps = result.trace.filter((s) => s.type === "think" || s.type === "search").length;
            for (let i = 1; i <= steps; i++) {
              await wait(750);
              update(id, { revealed: i, phase: "Scout is searching", result });
            }
            await wait(600);
            update(id, { phase: "Checking every claim against the sources" });
            await wait(700);
          } else {
            await wait(650);
            update(id, { phase: "Writing an answer from the passages" });
            await wait(650);
            update(id, { phase: "Checking every claim against the sources" });
            await wait(650);
          }
        }

        update(id, { status: "done", result, revealed: Number.MAX_SAFE_INTEGER });
        if (result.sources[0]) showSource(result.sources[0]);
      } catch (error) {
        const message =
          error instanceof DemoUnsupportedQuestion
            ? "This demo replays recorded answers, so it only knows the suggested questions. Your own questions work once the backend is connected."
            : error instanceof Error
              ? error.message
              : String(error);
        update(id, { status: "error", error: message });
      }
    },
    [loaded, mode, showSource],
  );

  if (loadError) return <LoadFailure message={loadError} />;
  if (!loaded) return <Loading />;

  const activeTurn = turns.find((t) => t.id === activeId) ?? null;
  const busy = turns.some((t) => t.status === "running");

  return (
    <div className="flex h-full flex-col">
      <TopBar doc={loaded.doc} live={loaded.api.live} />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <Sidebar
          doc={loaded.doc}
          live={loaded.api.live}
          turns={turns}
          activeId={activeId}
          onSelect={(turn) => {
            setActiveId(turn.id);
            if (turn.result?.sources[0]) showSource(turn.result.sources[0]);
          }}
        />
        <main className="flex min-h-[60vh] min-w-0 flex-1 flex-col border-line lg:min-h-0 lg:border-r">
          <Thread
            turns={turns}
            activeId={activeId}
            doc={loaded.doc}
            suggestions={loaded.suggestions}
            chunks={loaded.chunks}
            onAsk={ask}
            onFocus={setActiveId}
            onCite={showPage}
            onSource={showSource}
          />
          <AskBar mode={mode} setMode={setMode} onAsk={ask} busy={busy} suggestions={loaded.suggestions} />
        </main>
        <Viewer
          tab={tab}
          setTab={setTab}
          pages={loaded.pages}
          chunks={loaded.chunks}
          map={loaded.map}
          page={page}
          setPage={(p) => showPage(p)}
          activeChunk={activeChunk}
          turn={activeTurn}
          onSource={showSource}
        />
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex h-full items-center justify-center gap-3 text-muted">
      <span className="h-2 w-2 animate-pulse-dot rounded-full bg-accent" />
      Loading the paper…
    </div>
  );
}

function LoadFailure({ message }: { message: string }) {
  return (
    <div className="mx-auto flex h-full max-w-xl flex-col justify-center gap-4 px-6">
      <h1 className="font-serif text-3xl">No demo data yet</h1>
      <p className="text-soft">
        The app runs in demo mode and replays answers recorded by the Python pipeline. Record them from the project
        folder; the file is saved to <code className="font-mono text-accent">web/public/demo/</code>:
      </p>
      <pre className="overflow-x-auto rounded-lg border border-line bg-panel p-4 font-mono text-sm text-soft">
        python eval/export_demo.py eval/papers/your_paper.pdf eval/demo_questions.txt
      </pre>
      <p className="font-mono text-xs text-dim">{message}</p>
    </div>
  );
}
