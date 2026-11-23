import type {
  AskResult,
  Chunk,
  Citation,
  DemoData,
  DocumentInfo,
  KnowledgeMap,
  Mode,
  Note,
  Page,
  SearchHit,
  SourceHit,
} from "./types";
import { createSearch } from "./demoSearch";

// Where the app is served from, e.g. "/research-copilot/app" on GitHub Pages
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

// Everything the UI needs from a backend. The demo implementation below
// replays pre-recorded runs; a FastAPI implementation can replace it later
// without touching the components.
export interface ResearchApi {
  readonly live: boolean;
  documents(): Promise<DocumentInfo[]>;
  upload(file: File): Promise<DocumentInfo>;
  remove(docId: string): Promise<void>;
  // URL of the original PDF, or null when only the text is available (demo)
  fileUrl(docId: string): string | null;
  pages(docId: string): Promise<Page[]>;
  chunks(docId: string): Promise<Chunk[]>;
  map(docId: string): Promise<KnowledgeMap>;
  suggestions(docId: string): Promise<string[]>;
  ask(docId: string, question: string, mode: Mode): Promise<AskResult>;
  updateCitation(docId: string, citation: Citation): Promise<DocumentInfo>;
  // Looks up paper details from a DOI, or searches a title; nothing is saved
  lookupCitation(docId: string, query: { doi?: string; title?: string }): Promise<Citation>;
  // Find again: search across the library, no language model involved
  search(query: string, docIds?: string[]): Promise<SearchHit[]>;
  notes(): Promise<Note[]>;
  addNote(note: { docId: string; page: number; text: string; note?: string; tags?: string[] }): Promise<Note>;
  updateNote(id: string, patch: { note?: string; tags?: string[] }): Promise<Note>;
  deleteNote(id: string): Promise<void>;
}

const needsBackend = async (): Promise<never> => {
  throw new Error("This needs the backend. The demo only replays recorded answers.");
};

export class DemoUnsupportedQuestion extends Error {}

const normalize = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// The demo keeps saved quotes in this browser only
const NOTES_KEY = "demo-notebook";
function loadNotes(): Note[] {
  try {
    return JSON.parse(localStorage.getItem(NOTES_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function storeNotes(notes: Note[]) {
  try {
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
  } catch {
    // not remembered after a reload, which is fine for a demo
  }
}

export async function createDemoApi(url = `${BASE_PATH}/demo/demo_data.json`): Promise<ResearchApi> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);
  const data: DemoData = await response.json();
  // PowerShell can write a byte order mark at the start of the file
  data.runs.forEach((r) => (r.question = r.question.replace(/^﻿/, "")));

  const doc: DocumentInfo = {
    id: "demo",
    file: data.paper.file,
    pageCount: data.paper.page_count,
    passages: data.chunks.length,
    citation: data.paper.citation,
    license: data.paper.license,
  };
  const search = createSearch(data.chunks, doc.id);
  let notes = loadNotes();
  const saveNotes = (next: Note[]) => {
    notes = next;
    storeNotes(notes);
  };

  const findRun = (question: string) => data.runs.find((r) => normalize(r.question) === normalize(question));

  return {
    live: false,
    documents: async () => [doc],
    upload: async () => {
      throw new Error("Uploading needs the backend.");
    },
    remove: async () => {},
    fileUrl: () => (data.paper.pdf ? `${url.slice(0, url.lastIndexOf("/") + 1)}${data.paper.pdf}` : null),
    async updateCitation(_docId, citation) {
      doc.citation = citation;
      return { ...doc };
    },
    lookupCitation: needsBackend,
    search: async (query) => search(query),
    notes: async () => notes,
    async addNote({ docId, page, text, note = "", tags = [] }) {
      // Without the backend the quote cannot be located on the page, unless it is a whole passage
      const chunk = data.chunks.find((c) => c.page === page && c.text.replace(/\s+/g, " ").trim() === text.replace(/\s+/g, " ").trim());
      const saved: Note = { id: Math.random().toString(36).slice(2, 14), docId, page, text, rects: chunk?.rects ?? [], note, tags, created: Date.now() };
      saveNotes([...notes, saved]);
      return saved;
    },
    async updateNote(id, patch) {
      saveNotes(notes.map((n) => (n.id === id ? { ...n, ...patch } : n)));
      return notes.find((n) => n.id === id)!;
    },
    async deleteNote(id) {
      saveNotes(notes.filter((n) => n.id !== id));
    },
    pages: async () => data.paper.pages,
    chunks: async () => data.chunks,
    map: async () => data.map,
    suggestions: async () => data.runs.map((r) => r.question),

    async ask(_docId, question, mode) {
      const run = findRun(question);
      if (!run) throw new DemoUnsupportedQuestion(question);

      if (mode === "fast") {
        return {
          question: run.question,
          mode,
          answer: run.rag.answer,
          claims: run.rag.claims,
          removed: run.rag.removed,
          partial: run.rag.partial,
          gaveUp: false,
          searches: 1,
          sources: run.rag.sources,
          trace: [],
          position: run.position,
        };
      }

      // Scout: every hit from every search, best score first, each chunk once
      const seen = new Map<number, SourceHit>();
      for (const step of run.scout.trace) {
        if (step.type !== "search") continue;
        for (const hit of step.hits) {
          if (hit.chunk == null) continue;
          const previous = seen.get(hit.chunk);
          if (!previous || previous.score < hit.score) {
            const chunk = data.chunks[hit.chunk];
            seen.set(hit.chunk, { chunk: hit.chunk, page: hit.page, score: hit.score, text: chunk.text, rects: chunk.rects });
          }
        }
      }
      const check = run.scout.trace.find((s) => s.type === "check");

      return {
        question: run.question,
        mode,
        answer: run.scout.answer,
        claims: check && check.type === "check" ? check.claims : [],
        removed: check && check.type === "check" ? check.removed : 0,
        gaveUp: run.scout.gave_up,
        searches: run.scout.searches,
        sources: [...seen.values()].sort((a, b) => b.score - a.score),
        trace: run.scout.trace,
        position: run.position,
      };
    },
  };
}

// Starter questions that work for most research papers
const GENERIC_QUESTIONS = [
  "What research question does this paper ask?",
  "What method or data do the authors use?",
  "What are the main findings?",
  "What limitations do the authors mention?",
];

export class ApiError extends Error {}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

// The FastAPI backend in api/main.py
export function createHttpApi(baseUrl: string): ResearchApi {
  const base = baseUrl.replace(/\/$/, "");

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(base + path, init);
    } catch {
      throw new ApiError(`Could not reach the backend at ${base}. Is it running?`);
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new ApiError(body?.detail ?? `The backend answered ${response.status}.`);
    }
    return response.status === 204 ? (undefined as T) : response.json();
  }

  return {
    live: true,
    documents: () => call("/documents"),
    upload(file) {
      const form = new FormData();
      form.append("file", file);
      return call("/documents", { method: "POST", body: form });
    },
    remove: (docId) => call(`/documents/${docId}`, { method: "DELETE" }),
    fileUrl: (docId) => `${base}/documents/${docId}/file`,
    pages: (docId) => call(`/documents/${docId}/pages`),
    chunks: (docId) => call(`/documents/${docId}/chunks`),
    map: (docId) => call(`/documents/${docId}/map`),
    suggestions: async () => GENERIC_QUESTIONS,
    updateCitation: (docId, citation) => call(`/documents/${docId}/citation`, json("PUT", citation)),
    lookupCitation: (docId, query) => call(`/documents/${docId}/citation/lookup`, json("POST", query)),
    search: (query, docIds) => {
      const params = new URLSearchParams({ q: query, limit: "15" });
      if (docIds?.length) params.set("docs", docIds.join(","));
      return call(`/search?${params}`);
    },
    notes: () => call("/notebook"),
    addNote: (note) => call("/notebook", json("POST", note)),
    updateNote: (id, patch) => call(`/notebook/${id}`, json("PATCH", patch)),
    deleteNote: (id) => call(`/notebook/${id}`, { method: "DELETE" }),
    ask: (docId, question, mode) => call(`/documents/${docId}/ask`, json("POST", { question, mode })),
  };
}

// Uses the backend when NEXT_PUBLIC_API_URL is set, otherwise the recorded demo
export async function createApi(): Promise<ResearchApi> {
  const url = process.env.NEXT_PUBLIC_API_URL;
  return url ? createHttpApi(url) : createDemoApi();
}
