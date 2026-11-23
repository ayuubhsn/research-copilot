// Find again for the demo: BM25 over the recorded passages, in the browser.
// The live app uses the same idea on the server, combined with embeddings.

import type { Chunk, SearchHit } from "./types";

const STOP = new Set(
  "a an the of in on at to for and or is are was were be been being it its this that these those with as by from what which who when how why do does did not no can could should would than then there their they we our you your".split(
    " ",
  ),
);

export const tokenize = (text: string) =>
  (text.toLowerCase().replace(/(\w)-\s+(\w)/g, "$1$2").match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 1 && !STOP.has(t));

export function createSearch(chunks: Chunk[], docId: string) {
  const docs = chunks.map((c) => tokenize(c.text));
  const avg = docs.reduce((sum, d) => sum + d.length, 0) / Math.max(1, docs.length);
  const df = new Map<string, number>();
  docs.forEach((d) => new Set(d).forEach((t) => df.set(t, (df.get(t) ?? 0) + 1)));
  const idf = (t: string) => {
    const n = df.get(t) ?? 0;
    return Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
  };
  const k1 = 1.5;
  const b = 0.75;

  return (query: string, limit = 15): SearchHit[] => {
    const terms = [...new Set(tokenize(query))];
    if (terms.length === 0) return [];
    const phrase = query.toLowerCase().replace(/\s+/g, " ").trim();

    const scored = docs.map((d, i) => {
      let score = 0;
      for (const t of terms) {
        // A word also matches longer forms of itself ("degrade" matches "degrades")
        const tf = d.filter((w) => w === t || (t.length > 4 && w.startsWith(t.slice(0, -1)))).length;
        if (tf) score += idf(t) * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * d.length) / avg)));
      }
      // The exact phrase counts extra
      if (phrase.split(" ").length > 2 && chunks[i].text.toLowerCase().replace(/\s+/g, " ").includes(phrase)) score *= 1.5;
      return { i, score };
    });

    const best = Math.max(...scored.map((s) => s.score), 1e-9);
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b2) => b2.score - a.score)
      .slice(0, limit)
      .map(({ i, score }) => ({
        docId,
        chunk: i,
        page: chunks[i].page,
        score: Math.round((score / best) * 100) / 100,
        text: chunks[i].text,
        rects: chunks[i].rects ?? [],
      }));
  };
}
