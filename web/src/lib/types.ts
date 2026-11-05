// Shapes shared by the UI. They mirror what the Python side produces
// (eval/export_demo.py today, the FastAPI backend later).

export type Page = { page: number; text: string };
export type Chunk = { page: number; text: string };

export type MapPoint = { x: number; y: number; island: number; page: number };
export type Island = { id: number; x: number; y: number; label: string; size: number };
export type KnowledgeMap = { points: MapPoint[]; islands: Island[] };

export type Claim = { claim: string; supported: boolean; evidence?: string };

export type SourceHit = {
  chunk: number;
  page: number;
  score: number;
  phrase_match?: boolean;
  text: string;
};

export type TraceStep =
  | { type: "think" | "answer" | "stop"; text: string | null }
  | {
      type: "search";
      query: string;
      best: number;
      weak: boolean;
      phrase_found: boolean;
      hits: { chunk: number | null; page: number; source: string; score: number }[];
    }
  | { type: "check"; claims: Claim[]; removed: number };

export type Mode = "fast" | "scout";

export type DocumentInfo = {
  id: string;
  file: string;
  pageCount: number;
  passages: number;
};

// One answered question, the same shape for both modes
export type AskResult = {
  question: string;
  mode: Mode;
  answer: string;
  claims: Claim[];
  removed: number;
  gaveUp: boolean;
  searches: number;
  sources: SourceHit[];
  trace: TraceStep[];
  position: { x: number; y: number } | null;
};

// Raw file written by eval/export_demo.py
export type DemoData = {
  paper: { file: string; page_count: number; pages: Page[] };
  chunks: Chunk[];
  map: KnowledgeMap;
  runs: {
    question: string;
    position: { x: number; y: number };
    rag: {
      answer: string;
      draft: string;
      claims: Claim[];
      removed: number;
      sources: SourceHit[];
    };
    scout: { answer: string; searches: number; gave_up: boolean; trace: TraceStep[] };
  }[];
};
