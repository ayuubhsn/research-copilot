"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createApi, DemoUnsupportedQuestion, type ResearchApi } from "@/lib/api";
import type { Style } from "@/lib/cite";
import type { AskResult, Chunk, Citation, Claim, DocumentInfo, KnowledgeMap, Mode, Note, Page, Rect, SearchHit, SourceHit } from "@/lib/types";
import AskBar from "./AskBar";
import CitationEditor from "./CitationEditor";
import FilePicker from "./FilePicker";
import FindAgain from "./FindAgain";
import Notebook from "./Notebook";
import Sidebar from "./Sidebar";
import Thread from "./Thread";
import TopBar from "./TopBar";
import Viewer, { type ViewerTab } from "./Viewer";

export type Turn = {
  id: number;
  docId: string;
  question: string;
  mode: Mode;
  status: "running" | "done" | "error";
  phase: string; // what the app is doing right now, shown while running
  revealed: number; // Scout steps shown so far
  result?: AskResult;
  error?: string;
};

// What the page viewer shows: a page, and optionally one passage or quote on it
export type Focus = { page: number; chunk: number | null; rects: Rect[] | null };

export type DocData = { pages: Page[]; chunks: Chunk[]; map: KnowledgeMap; suggestions: string[] };

export type Upload = { name: string; error?: string };

export type View = "ask" | "find" | "notebook";

// One colour per paper, used in Find again and the notebook
const PAPER_COLORS = ["#F2D04B", "#8CA3FF", "#7CC4A4", "#E9A86B", "#C99BE0", "#6FC3D9", "#E58A9A", "#9AB87A"];

function savedStyle(): Style {
  try {
    const s = localStorage.getItem("citation-style");
    if (s === "apa" || s === "harvard" || s === "mla" || s === "chicago" || s === "ieee") return s;
  } catch {
    // storage can be unavailable (private windows); the default is fine
  }
  return "apa";
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function Workspace() {
  const [api, setApi] = useState<ResearchApi | null>(null);
  const [docs, setDocs] = useState<DocumentInfo[]>([]);
  const [docId, setDocId] = useState<string | null>(null);
  const [data, setData] = useState<DocData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("fast");
  const [tab, setTab] = useState<ViewerTab>("page");
  const [focus, setFocus] = useState<Focus>({ page: 1, chunk: null, rects: null });
  const [view, setView] = useState<View>("ask");
  const [notes, setNotes] = useState<Note[]>([]);
  const [style, setStyleState] = useState<Style>("apa");
  const [editing, setEditing] = useState<string | null>(null); // doc whose citation is being edited
  const [notice, setNotice] = useState<string | null>(null);
  const nextId = useRef(1);
  // Where to go once another document has loaded (from Find again or the notebook)
  const pendingFocus = useRef<Focus | null>(null);

  const setStyle = (s: Style) => {
    setStyleState(s);
    try {
      localStorage.setItem("citation-style", s);
    } catch {
      // not remembered, which is fine
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const created = await createApi();
        const [list, saved] = await Promise.all([created.documents(), created.notes()]);
        setApi(created);
        setDocs(list);
        setNotes(saved);
        setStyleState(savedStyle());
        setDocId(list[0]?.id ?? null);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : String(error));
      }
    })();
  }, []);

  // Load pages, passages and the map whenever another document is chosen
  useEffect(() => {
    if (!api || !docId) return;
    let cancelled = false;
    (async () => {
      try {
        const [pages, chunks, map, suggestions] = await Promise.all([
          api.pages(docId),
          api.chunks(docId),
          api.map(docId),
          api.suggestions(docId),
        ]);
        if (!cancelled) {
          setData({ pages, chunks, map, suggestions });
          setFocus(pendingFocus.current ?? { page: 1, chunk: null, rects: null });
          pendingFocus.current = null;
        }
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, docId]);

  const update = (id: number, patch: Partial<Turn>) =>
    setTurns((all) => all.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const showSource = useCallback((hit: SourceHit) => {
    setTab("page");
    setFocus({ page: hit.page, chunk: hit.chunk, rects: hit.rects?.length ? hit.rects : null });
  }, []);

  const showPage = useCallback((page: number) => {
    setTab("page");
    setFocus({ page, chunk: null, rects: null });
  }, []);

  const showClaim = useCallback((claim: Claim) => {
    if (!claim.page) return;
    setTab("page");
    setFocus({ page: claim.page, chunk: null, rects: claim.rects ?? null });
  }, []);

  const selectDoc = (id: string) => {
    if (id === docId) return;
    setData(null);
    setDocId(id);
    setActiveId(null);
  };

  // Opens a page of any paper, switching paper first if needed
  const openAt = (id: string, target: Focus) => {
    setTab("page");
    if (id === docId) {
      setFocus(target);
    } else {
      pendingFocus.current = target;
      selectDoc(id);
    }
  };

  const flash = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice((n) => (n === message ? null : n)), 2400);
  };

  const saveNote = async (id: string, page: number, text: string) => {
    if (!api) return;
    try {
      const note = await api.addNote({ docId: id, page, text });
      setNotes((all) => [...all, note]);
      flash("★ Saved to your notebook");
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error));
    }
  };

  const updateNote = async (id: string, patch: { note?: string; tags?: string[] }) => {
    if (!api) return;
    const updated = await api.updateNote(id, patch);
    setNotes((all) => all.map((n) => (n.id === id ? updated : n)));
  };

  const deleteNote = async (id: string) => {
    if (!api) return;
    await api.deleteNote(id);
    setNotes((all) => all.filter((n) => n.id !== id));
  };

  const saveCitation = async (id: string, citation: Citation) => {
    if (!api) return;
    const updated = await api.updateCitation(id, citation);
    setDocs((all) => all.map((d) => (d.id === id ? updated : d)));
  };

  const uploadFile = async (file: File) => {
    if (!api) return;
    setUpload({ name: file.name });
    try {
      const doc = await api.upload(file);
      setDocs((all) => [...all.filter((d) => d.id !== doc.id), doc]);
      setUpload(null);
      selectDoc(doc.id);
    } catch (error) {
      setUpload({ name: file.name, error: error instanceof Error ? error.message : String(error) });
    }
  };

  const removeDoc = async (id: string) => {
    if (!api) return;
    await api.remove(id);
    const rest = docs.filter((d) => d.id !== id);
    setDocs(rest);
    setTurns((all) => all.filter((t) => t.docId !== id));
    setNotes((all) => all.filter((n) => n.docId !== id));
    if (id === docId) {
      setData(null);
      setDocId(rest[0]?.id ?? null);
    }
  };

  const ask = useCallback(
    async (question: string) => {
      if (!api || !docId || !question.trim()) return;
      const id = nextId.current++;
      const phase = mode === "scout" ? "Scout is planning its searches" : "Searching the paper";
      setTurns((all) => [...all, { id, docId, question, mode, status: "running", phase, revealed: 0 }]);
      setActiveId(id);

      // A live answer takes a few seconds; show what the pipeline is doing meanwhile
      const phases =
        mode === "scout"
          ? ["Scout is searching and judging the hits", "Writing an answer from what it found", "Checking every claim against the sources"]
          : ["Writing an answer from the passages", "Checking every claim against the sources"];
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (api.live) {
        const next = (i: number) => {
          timer = setTimeout(() => {
            update(id, { phase: phases[i] });
            if (i + 1 < phases.length) next(i + 1);
          }, 2500);
        };
        next(0);
      }

      try {
        const result = await api.ask(docId, question, mode);
        clearTimeout(timer);

        // The demo replays recorded runs at a readable pace
        if (!api.live) {
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
            for (const phase of phases) {
              await wait(650);
              update(id, { phase });
            }
            await wait(650);
          }
        }

        update(id, { status: "done", result, revealed: Number.MAX_SAFE_INTEGER });
        if (result.sources[0]) showSource(result.sources[0]);
      } catch (error) {
        clearTimeout(timer);
        const message =
          error instanceof DemoUnsupportedQuestion
            ? "This demo replays recorded answers, so it only knows the suggested questions. Your own questions work once the backend is connected."
            : error instanceof Error
              ? error.message
              : String(error);
        update(id, { status: "error", error: message });
      }
    },
    [api, docId, mode, showSource],
  );

  if (loadError) return <LoadFailure message={loadError} live={!!process.env.NEXT_PUBLIC_API_URL} />;
  if (!api) return <Loading text="Connecting…" />;

  const doc = docs.find((d) => d.id === docId) ?? null;
  const colors = Object.fromEntries(docs.map((d, i) => [d.id, PAPER_COLORS[i % PAPER_COLORS.length]]));
  const editingDoc = docs.find((d) => d.id === editing) ?? null;
  const docTurns = turns.filter((t) => t.docId === docId);
  const activeTurn = docTurns.find((t) => t.id === activeId) ?? null;
  const busy = turns.some((t) => t.status === "running");

  return (
    <div className="flex h-full flex-col">
      <TopBar doc={doc} live={api.live} />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <Sidebar
          docs={docs}
          docId={docId}
          live={api.live}
          upload={upload}
          turns={docTurns}
          activeId={activeId}
          onSelectDoc={selectDoc}
          onUpload={uploadFile}
          onRemove={removeDoc}
          onDismissUpload={() => setUpload(null)}
          onSelect={(turn) => {
            setView("ask");
            setActiveId(turn.id);
            if (turn.result?.sources[0]) showSource(turn.result.sources[0]);
          }}
          onEditCitation={setEditing}
        />
        <main className="flex min-h-[60vh] min-w-0 flex-1 flex-col border-line lg:min-h-0 lg:border-r">
          {doc && <ViewTabs view={view} setView={setView} notes={notes.length} live={api.live} />}
          {doc && view === "find" ? (
            <FindAgain
              docs={docs}
              colors={colors}
              notes={notes}
              search={(q, ids) => api.search(q, ids)}
              onOpen={(hit: SearchHit) => openAt(hit.docId, { page: hit.page, chunk: hit.docId === docId ? hit.chunk : null, rects: hit.rects })}
              onSave={(hit: SearchHit) => saveNote(hit.docId, hit.page, hit.text)}
            />
          ) : doc && view === "notebook" ? (
            <Notebook
              notes={notes}
              docs={docs}
              colors={colors}
              style={style}
              setStyle={setStyle}
              onOpen={(n) => openAt(n.docId, { page: n.page, chunk: null, rects: n.rects })}
              onUpdate={updateNote}
              onDelete={deleteNote}
              onEditCitation={setEditing}
            />
          ) : doc && data ? (
            <>
              <Thread
                turns={docTurns}
                activeId={activeId}
                doc={doc}
                suggestions={data.suggestions}
                onAsk={ask}
                onFocus={setActiveId}
                onCite={showPage}
                onSource={showSource}
                onClaim={showClaim}
                onSaveSource={api.live ? (hit) => saveNote(doc.id, hit.page, hit.text) : undefined}
                style={style}
                setStyle={setStyle}
              />
              <AskBar mode={mode} setMode={setMode} onAsk={ask} busy={busy} suggestions={data.suggestions} />
            </>
          ) : doc ? (
            <Loading text="Loading the paper…" />
          ) : (
            <NoDocuments upload={upload} onUpload={uploadFile} />
          )}
        </main>
        {doc && data && (
          <Viewer
            tab={tab}
            setTab={setTab}
            doc={doc}
            fileUrl={api.fileUrl(doc.id)}
            data={data}
            focus={focus}
            setPage={showPage}
            turn={view === "ask" ? activeTurn : null}
            onSource={showSource}
            notes={notes.filter((n) => n.docId === doc.id)}
            onSaveSelection={api.live ? (page, text) => saveNote(doc.id, page, text) : undefined}
          />
        )}
      </div>
      {editingDoc && (
        <CitationEditor
          doc={editingDoc}
          onSave={(c) => saveCitation(editingDoc.id, c)}
          onLookup={(query) => api.lookupCitation(editingDoc.id, query)}
          onClose={() => setEditing(null)}
        />
      )}
      {notice && (
        <div className="fixed right-5 bottom-5 z-40 rounded-xl border border-line bg-raised px-4 py-2.5 text-sm shadow-2xl shadow-black/50 animate-rise">{notice}</div>
      )}
    </div>
  );
}

function ViewTabs({ view, setView, notes, live }: { view: View; setView: (v: View) => void; notes: number; live: boolean }) {
  const tabs: { id: View; label: string }[] = [
    { id: "ask", label: "Ask" },
    { id: "find", label: "Find again" },
    { id: "notebook", label: notes ? `Notebook · ${notes}` : "Notebook" },
  ];
  return (
    <nav className="flex items-center gap-1 border-b border-line px-4 py-2">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => setView(t.id)}
          disabled={!live && t.id !== "ask"}
          title={!live && t.id !== "ask" ? "Needs the backend" : undefined}
          className={`rounded-lg px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
            view === t.id ? "bg-raised font-medium text-text" : "text-muted hover:text-soft"
          }`}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <div className="flex h-full flex-1 items-center justify-center gap-3 text-muted">
      <span className="h-2 w-2 animate-pulse-dot rounded-full bg-accent" />
      {text}
    </div>
  );
}

function NoDocuments({ upload, onUpload }: { upload: Upload | null; onUpload: (f: File) => void }) {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="font-serif text-4xl leading-tight tracking-tight">Start with a paper.</h1>
        <p className="mt-3 text-soft">
          Upload a research paper as a PDF. It is split into passages and indexed, then you can ask it anything and check
          every answer against the page it came from.
        </p>
        {upload && !upload.error ? (
          <p className="mt-7 flex items-center justify-center gap-2.5 text-sm text-muted">
            <span className="h-2 w-2 animate-pulse-dot rounded-full bg-accent" />
            Reading and indexing {upload.name}…
          </p>
        ) : (
          <FilePicker
            onFile={onUpload}
            className="mt-7 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-ink transition hover:bg-accent-hover"
          >
            Upload a PDF
          </FilePicker>
        )}
        {upload?.error && <p className="mt-4 text-sm text-bad">{upload.error}</p>}
      </div>
    </div>
  );
}

function LoadFailure({ message, live }: { message: string; live: boolean }) {
  return (
    <div className="mx-auto flex h-full max-w-xl flex-col justify-center gap-4 px-6">
      {live ? (
        <>
          <h1 className="font-serif text-3xl">Can&apos;t reach the backend</h1>
          <p className="text-soft">Start the API from the project folder, then reload this page:</p>
          <pre className="overflow-x-auto rounded-lg border border-line bg-panel p-4 font-mono text-sm text-soft">
            uvicorn api.main:app --reload
          </pre>
        </>
      ) : (
        <>
          <h1 className="font-serif text-3xl">No demo data yet</h1>
          <p className="text-soft">
            The app runs in demo mode and replays answers recorded by the Python pipeline. Record them from the project
            folder; the file is saved to <code className="font-mono text-accent">web/public/demo/</code>:
          </p>
          <pre className="overflow-x-auto rounded-lg border border-line bg-panel p-4 font-mono text-sm text-soft">
            python eval/export_demo.py eval/papers/your_paper.pdf eval/demo_questions.txt
          </pre>
        </>
      )}
      <p className="font-mono text-xs text-dim">{message}</p>
    </div>
  );
}
