// Shapes shared by the UI. They mirror what the Python side produces
// (eval/export_demo.py today, the FastAPI backend later).

export type Page = { page: number; text: string };
export type Chunk = { page: number; text: string };

export type MapPoint = { x: number; y: number; island: number; page: number };
export type Island = { id: number; x: number; y: number; label: string; size: number };
export type KnowledgeMap = { points: MapPoint[]; islands: Island[] };

// A highlight on a PDF page, as fractions (0–1) of the page width and height
export type Rect = { x: number; y: number; w: number; h: number };

export type ClaimStatus = "supported" | "partial" | "unsupported";

// status and reason come from the fact-check; page and rects are set when the
// backend found the supporting quote in the PDF
export type Claim = {
  claim: string;
  supported: boolean;
  status?: ClaimStatus;
  reason?: string;
  evidence?: string;
  page?: number | null;
  rects?: Rect[];
};

export type SourceHit = {
  chunk: number;
  page: number;
  score: number;
  phrase_match?: boolean;
  text: string;
  rects?: Rect[];
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
  | { type: "check"; claims: Claim[]; removed: number; partial?: number };

export type Mode = "fast" | "scout";

export type Author = { family: string; given: string };

export type PaperType = "article" | "preprint" | "conference" | "book" | "chapter" | "report";

// Bibliographic data for references. source says where it came from:
// "doi" (looked up), "pdf" (guessed from the file) or "user" (edited)
export type Citation = {
  title: string;
  authors: Author[];
  year: number | null;
  container: string; // journal, conference or repository
  volume: string;
  issue: string;
  pages: string;
  doi: string | null;
  type: PaperType;
  publisher: string;
  source: "doi" | "pdf" | "user";
};

export type DocumentInfo = {
  id: string;
  file: string;
  pageCount: number;
  passages: number;
  citation?: Citation;
};

// One hit from "Find again", the search across the whole library
export type SearchHit = {
  docId: string;
  chunk: number;
  page: number;
  score: number;
  text: string;
  rects: Rect[];
};

// A quote saved in the notebook
export type Note = {
  id: string;
  docId: string;
  page: number;
  text: string;
  rects: Rect[];
  note: string;
  tags: string[];
  created: number;
};

// One answered question, the same shape for both modes
export type AskResult = {
  question: string;
  mode: Mode;
  answer: string;
  claims: Claim[];
  removed: number;
  partial?: number;
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
