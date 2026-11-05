import type { AskResult, Chunk, DemoData, DocumentInfo, KnowledgeMap, Mode, Page, SourceHit } from "./types";

// Everything the UI needs from a backend. The demo implementation below
// replays pre-recorded runs; a FastAPI implementation can replace it later
// without touching the components.
export interface ResearchApi {
  readonly live: boolean;
  documents(): Promise<DocumentInfo[]>;
  pages(docId: string): Promise<Page[]>;
  chunks(docId: string): Promise<Chunk[]>;
  map(docId: string): Promise<KnowledgeMap>;
  suggestions(docId: string): Promise<string[]>;
  ask(docId: string, question: string, mode: Mode): Promise<AskResult>;
}

export class DemoUnsupportedQuestion extends Error {}

const normalize = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export async function createDemoApi(url = "/demo/demo_data.json"): Promise<ResearchApi> {
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
  };

  const findRun = (question: string) => data.runs.find((r) => normalize(r.question) === normalize(question));

  return {
    live: false,
    documents: async () => [doc],
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
            seen.set(hit.chunk, { chunk: hit.chunk, page: hit.page, score: hit.score, text: data.chunks[hit.chunk].text });
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
