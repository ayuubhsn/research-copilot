// Text helpers: citations in answers and highlights on pages.

export type AnswerPart = { kind: "text"; text: string } | { kind: "cite"; pages: number[]; raw: string };

// Turns "... 56.1% (lost_in_the_middle.pdf, page 5)." into text and citation parts.
// Handles "page 5", "pages 2 and 5", "pages 7-8" and several sources in one bracket.
export function splitCitations(answer: string): AnswerPart[] {
  const parts: AnswerPart[] = [];
  const pattern = /\(([^()]*?\.pdf[^()]*?)\)/gi;
  let last = 0;
  for (const match of answer.matchAll(pattern)) {
    const pages = pagesIn(match[1]);
    if (pages.length === 0) continue;
    if (match.index > last) parts.push({ kind: "text", text: answer.slice(last, match.index) });
    parts.push({ kind: "cite", pages, raw: match[0] });
    last = match.index + match[0].length;
  }
  if (last < answer.length) parts.push({ kind: "text", text: answer.slice(last) });
  return parts;
}

function pagesIn(text: string): number[] {
  const pages = new Set<number>();
  for (const m of text.matchAll(/pages?\s+([\d\s,–-]+(?:\s*(?:and|&)\s*\d+)*)/gi)) {
    const spec = m[1];
    for (const range of spec.matchAll(/(\d+)\s*[–-]\s*(\d+)/g)) {
      for (let p = Number(range[1]); p <= Number(range[2]) && p - Number(range[1]) < 20; p++) pages.add(p);
    }
    for (const n of spec.matchAll(/\d+/g)) pages.add(Number(n[0]));
  }
  return [...pages].sort((a, b) => a - b);
}

// Collapses whitespace and rejoins words the PDF split at a line break ("abil- ity")
export const collapse = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .replace(/([a-z])- ([a-z])/g, "$1$2")
    .trim();

export type Segment = { text: string; mark: "none" | "hit" | "active" };

// Splits a page into plain and highlighted segments. Chunks are matched on
// collapsed whitespace, the same way the Python chunker cleans them.
export function highlightPage(pageText: string, hits: string[], active: string | null): Segment[] {
  const page = collapse(pageText);
  const marks = new Array<0 | 1 | 2>(page.length).fill(0);

  const paint = (needle: string, level: 1 | 2) => {
    const n = collapse(needle);
    if (!n) return;
    const start = page.indexOf(n);
    if (start < 0) return;
    for (let i = start; i < start + n.length; i++) marks[i] = Math.max(marks[i], level) as 0 | 1 | 2;
  };
  hits.forEach((h) => paint(h, 1));
  if (active) paint(active, 2);

  const segments: Segment[] = [];
  const names = ["none", "hit", "active"] as const;
  let start = 0;
  for (let i = 1; i <= page.length; i++) {
    if (i === page.length || marks[i] !== marks[start]) {
      segments.push({ text: page.slice(start, i), mark: names[marks[start]] });
      start = i;
    }
  }
  return segments;
}
