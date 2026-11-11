// References and in-text citations in five styles, plus BibTeX and RIS for Zotero.
//
// A reference is built as parts, some in italics, so it can be copied both as
// rich text (Word keeps the italics) and as plain text.

import { splitCitations } from "./text";
import type { Author, Citation } from "./types";

export type Style = "apa" | "harvard" | "mla" | "chicago" | "ieee";

export const STYLES: { id: Style; label: string }[] = [
  { id: "apa", label: "APA 7" },
  { id: "harvard", label: "Harvard" },
  { id: "mla", label: "MLA 9" },
  { id: "chicago", label: "Chicago" },
  { id: "ieee", label: "IEEE" },
];

export type Part = { text: string; italic?: boolean };

const it = (text: string): Part => ({ text, italic: true });
const tx = (text: string): Part => ({ text });

const dash = (pages: string) => pages.replace(/\s*[-–—]+\s*/g, "–");
const doiUrl = (doi: string) => `https://doi.org/${doi}`;
const year = (c: Citation) => (c.year ? String(c.year) : "n.d.");
const end = (s: string) => (/[.?!]$/.test(s) ? s : `${s}.`);

// "Nelson F." -> "N. F."   "Jean-Paul" -> "J.-P."
function initials(given: string, spaced = true) {
  const parts = given
    .split(/\s+/)
    .filter(Boolean)
    .map((name) =>
      name
        .split("-")
        .map((p) => `${p[0].toUpperCase()}.`)
        .join("-"),
    );
  return parts.join(spaced ? " " : "");
}

function joinNames(names: string[], and: string, serialComma: boolean) {
  if (names.length <= 1) return names.join("");
  if (names.length === 2) return `${names[0]} ${and} ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}${serialComma ? "," : ""} ${and} ${names[names.length - 1]}`;
}

function authorList(authors: Author[], style: Style): string {
  if (authors.length === 0) return "";
  switch (style) {
    case "apa": {
      const names = authors.map((a) => `${a.family}${a.given ? `, ${initials(a.given)}` : ""}`);
      if (names.length > 20) return `${names.slice(0, 19).join(", ")}, . . . ${names[names.length - 1]}`;
      return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}`;
    }
    case "harvard":
      return joinNames(
        authors.map((a) => `${a.family}${a.given ? `, ${initials(a.given, false)}` : ""}`),
        "and",
        false,
      );
    case "mla": {
      const first = authors[0];
      const firstName = `${first.family}${first.given ? `, ${first.given}` : ""}`;
      if (authors.length === 1) return firstName;
      if (authors.length === 2) return `${firstName}, and ${[authors[1].given, authors[1].family].filter(Boolean).join(" ")}`;
      return `${firstName}, et al`;
    }
    case "chicago": {
      const shown = authors.length > 10 ? authors.slice(0, 7) : authors;
      const names = shown.map((a, i) =>
        i === 0 ? `${a.family}${a.given ? `, ${a.given}` : ""}` : [a.given, a.family].filter(Boolean).join(" "),
      );
      if (authors.length > 10) return `${names.join(", ")}, et al`;
      // The first name is inverted ("Liu, Nelson"), so even two names take a comma
      return names.length === 2 ? `${names[0]}, and ${names[1]}` : joinNames(names, "and", true);
    }
    case "ieee": {
      const names = authors.map((a) => [a.given ? initials(a.given) : "", a.family].filter(Boolean).join(" "));
      return names.length > 6 ? `${names[0]} et al.` : joinNames(names, "and", names.length > 2);
    }
  }
}

// Volume, issue and pages for a journal article in each style
function locator(c: Citation, style: Style): string {
  const pages = c.pages ? dash(c.pages) : "";
  switch (style) {
    case "apa":
      return [c.volume ? `${c.volume}${c.issue ? `(${c.issue})` : ""}` : "", pages].filter(Boolean).join(", ");
    case "harvard":
      return [c.volume ? `${c.volume}${c.issue ? `(${c.issue})` : ""}` : "", pages ? `pp. ${pages}` : ""].filter(Boolean).join(", ");
    case "mla":
    case "ieee":
      return [c.volume ? `vol. ${c.volume}` : "", c.issue ? `no. ${c.issue}` : "", pages ? `pp. ${pages}` : ""].filter(Boolean).join(", ");
    case "chicago":
      return `${c.volume}${c.issue ? ` (${c.issue})` : ""}${pages ? `: ${pages}` : ""}`;
  }
}

/** The full reference, as parts with italics. number is used by IEEE. */
export function reference(c: Citation, style: Style, number = 1): Part[] {
  const authors = authorList(c.authors, style);
  const title = c.title.trim();
  const container = c.container.trim();
  const standalone = c.type === "book" || c.type === "report" || (c.type === "preprint" && style === "apa");
  const loc = c.type === "article" ? locator(c, style) : "";
  const doi = c.doi ? doiUrl(c.doi) : "";
  const parts: Part[] = [];

  switch (style) {
    case "apa": {
      parts.push(tx(`${authors ? end(authors) + " " : ""}(${year(c)}). `));
      if (standalone) {
        parts.push(it(end(title)));
        const where = c.type === "preprint" ? container || "Preprint" : c.publisher;
        if (where) parts.push(tx(` ${end(where)}`));
      } else if (c.type === "conference" || c.type === "chapter") {
        parts.push(tx(`${end(title)} `));
        if (container) parts.push(tx("In "), it(container), tx(c.pages ? ` (pp. ${dash(c.pages)}).` : "."));
      } else {
        parts.push(tx(`${end(title)} `));
        if (container) parts.push(it(container));
        if (c.volume) parts.push(tx(", "), it(c.volume), tx(`${c.issue ? `(${c.issue})` : ""}`));
        if (c.pages) parts.push(tx(`, ${dash(c.pages)}`));
        if (container || c.volume) parts.push(tx("."));
      }
      if (doi) parts.push(tx(` ${doi}`));
      break;
    }
    case "harvard": {
      parts.push(tx(`${authors ? authors + " " : ""}(${year(c)}) `));
      if (standalone || c.type === "preprint") {
        parts.push(it(title), tx(". "));
        const where = c.type === "preprint" ? container || "Preprint" : c.publisher;
        if (where) parts.push(tx(`${end(where)} `));
      } else {
        parts.push(tx(`'${title}', `));
        if (container) parts.push(it(container));
        parts.push(tx(loc ? `, ${loc}. ` : ". "));
      }
      if (doi) parts.push(tx(`Available at: ${doi}.`));
      break;
    }
    case "mla": {
      if (authors) parts.push(tx(`${end(authors)} `));
      if (standalone) {
        parts.push(it(end(title)), tx(" "));
        if (c.publisher) parts.push(tx(`${c.publisher}, `));
        parts.push(tx(`${year(c)}`));
      } else {
        parts.push(tx(`"${end(title)}" `));
        if (container) parts.push(it(container), tx(", "));
        if (loc) parts.push(tx(`${loc.replace(/, pp\..*$/, "")}, `));
        parts.push(tx(`${year(c)}`));
        if (c.pages) parts.push(tx(`, pp. ${dash(c.pages)}`));
      }
      parts.push(tx(doi ? `, ${doi}.` : "."));
      break;
    }
    case "chicago": {
      parts.push(tx(`${authors ? end(authors) + " " : ""}${year(c)}. `));
      if (standalone) {
        parts.push(it(end(title)));
        if (c.publisher) parts.push(tx(` ${end(c.publisher)}`));
      } else {
        parts.push(tx(`"${end(title)}" `));
        if (container && c.type === "preprint") parts.push(tx(container));
        else if (container) parts.push(...(c.type === "article" ? [it(container)] : [tx("In "), it(container)]));
        if (loc.trim()) parts.push(tx(` ${loc.trim()}`));
        parts.push(tx("."));
      }
      if (doi) parts.push(tx(` ${doi}.`));
      break;
    }
    case "ieee": {
      parts.push(tx(`[${number}] ${authors ? authors + ", " : ""}`));
      if (standalone && c.type !== "preprint") {
        parts.push(it(title), tx(". "));
        if (c.publisher) parts.push(tx(`${c.publisher}, `));
        parts.push(tx(`${year(c)}.`));
      } else {
        parts.push(tx(`"${title}," `));
        if (c.type === "conference") parts.push(tx("in "));
        if (container) parts.push(it(container), tx(", "));
        if (loc) parts.push(tx(`${loc}, `));
        parts.push(tx(`${year(c)}`));
        parts.push(tx(c.doi ? `, doi: ${c.doi}.` : "."));
      }
      break;
    }
  }
  return parts.map((p) => ({ ...p, text: p.text.replace(/\.\./g, ".").replace(/\s+/g, " ") }));
}

/** Author part of an in-text citation, e.g. "Liu et al." */
function citeName(c: Citation, style: Style) {
  const f = c.authors.map((a) => a.family);
  // No author: a short form of the title, up to a colon or four words
  if (f.length === 0) return c.title.split(":")[0].split(/\s+/).slice(0, 4).join(" ").replace(/[,.;]$/, "");
  if (f.length === 1) return f[0];
  if (f.length === 2) {
    if (style === "apa") return `${f[0]} & ${f[1]}`;
    return `${f[0]} and ${f[1]}`;
  }
  if (f.length === 3 && style === "harvard") return `${f[0]}, ${f[1]} and ${f[2]}`;
  if (f.length === 3 && style === "chicago") return `${f[0]}, ${f[1]}, and ${f[2]}`;
  return `${f[0]} et al.`;
}

/** In-text citation, e.g. (Liu et al., 2023, p. 1). Several pages give "pp. 2, 5". number is used by IEEE. */
export function inText(c: Citation, style: Style, page?: number | number[], number = 1): string {
  const name = citeName(c, style);
  const pages = page === undefined ? [] : Array.isArray(page) ? page : [page];
  const list = pages.join(", ");
  const p = pages.length === 0 ? "" : pages.length === 1 ? `p. ${list}` : `pp. ${list}`;
  switch (style) {
    case "apa":
    case "harvard":
      return `(${name}, ${year(c)}${p ? `, ${p}` : ""})`;
    case "mla":
      return `(${name}${list ? ` ${list}` : ""})`;
    case "chicago":
      return `(${name} ${year(c)}${list ? `, ${list}` : ""})`;
    case "ieee":
      return `[${number}${p ? `, ${p}` : ""}]`;
  }
}

const LIST_HEADING: Record<Style, string> = {
  apa: "References",
  harvard: "Reference list",
  mla: "Works Cited",
  chicago: "References",
  ieee: "References",
};

/**
 * An answer from the app, with its "(file.pdf, page 5)" tags turned into in-text
 * citations in the chosen style and the reference added at the end.
 */
export function answerWithReferences(answer: string, c: Citation, style: Style) {
  const body = splitCitations(answer)
    .map((part) => (part.kind === "text" ? part.text : inText(c, style, part.pages)))
    .join("")
    .replace(/\s+([.,;])/g, "$1")
    .trim();
  const ref = reference(c, style);
  const heading = LIST_HEADING[style];
  return {
    plain: `${body}\n\n${heading}\n${toPlain(ref)}`,
    html: `<p>${escapeHtml(body)}</p><p><b>${heading}</b></p><p>${toHtml(ref)}</p>`,
  };
}

/** Short label for the interface: "Liu et al., 2023" */
export function shortLabel(c: Citation | undefined, fallback: string) {
  if (!c) return fallback;
  if (c.authors.length === 0) {
    // No authors yet: a few words of the title stand in for the name
    const words = c.title.split(/\s+/);
    const name = words.length > 5 ? `${words.slice(0, 5).join(" ")}…` : c.title;
    return `${name || fallback}${c.year ? `, ${c.year}` : ""}`;
  }
  return `${citeName(c, "apa")}, ${year(c)}`;
}

/** Reference list: sorted by author for author-date styles, numbered in order for IEEE. */
export function referenceList(citations: Citation[], style: Style): Part[][] {
  if (style === "ieee") return citations.map((c, i) => reference(c, style, i + 1));
  const key = (c: Citation) => `${c.authors[0]?.family ?? c.title} ${c.year ?? ""}`.toLowerCase();
  return [...citations].sort((a, b) => key(a).localeCompare(key(b))).map((c) => reference(c, style));
}

export function toPlain(parts: Part[]) {
  return parts.map((p) => p.text).join("").trim();
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
export function toHtml(parts: Part[]) {
  return parts.map((p) => (p.italic ? `<i>${escapeHtml(p.text)}</i>` : escapeHtml(p.text))).join("").trim();
}

/** Copies rich text (keeps italics in Word and Google Docs) with a plain-text fallback. */
export async function copyRich(html: string, plain: string) {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" }),
      }),
    ]);
  } catch {
    await navigator.clipboard.writeText(plain);
  }
}

// ---- Export for Zotero and other reference managers ----

const BIB_TYPES: Record<Citation["type"], string> = {
  article: "article",
  preprint: "misc",
  conference: "inproceedings",
  book: "book",
  chapter: "incollection",
  report: "techreport",
};

const RIS_TYPES: Record<Citation["type"], string> = {
  article: "JOUR",
  preprint: "GEN",
  conference: "CONF",
  book: "BOOK",
  chapter: "CHAP",
  report: "RPRT",
};

function bibKey(c: Citation, used: Set<string>) {
  const word = (c.title.toLowerCase().match(/[a-z]{4,}/) ?? ["paper"])[0];
  const base = `${(c.authors[0]?.family ?? "anon").toLowerCase().replace(/[^a-z]/g, "")}${c.year ?? ""}${word}`;
  let key = base;
  for (let i = 2; used.has(key); i++) key = `${base}${i}`;
  used.add(key);
  return key;
}

export function toBibTeX(citations: Citation[]) {
  const used = new Set<string>();
  return citations
    .map((c) => {
      const containerField = c.type === "article" ? "journal" : c.type === "preprint" ? "howpublished" : "booktitle";
      const fields: [string, string | number | null][] = [
        ["author", c.authors.map((a) => `${a.family}${a.given ? `, ${a.given}` : ""}`).join(" and ")],
        ["title", `{${c.title}}`],
        [containerField, c.container],
        ["year", c.year],
        ["volume", c.volume],
        ["number", c.issue],
        ["pages", c.pages ? c.pages.replace(/\s*[-–—]+\s*/g, "--") : ""],
        ["publisher", c.publisher],
        ["doi", c.doi],
      ];
      const body = fields
        .filter(([, v]) => v !== null && v !== "")
        .map(([k, v]) => `  ${k} = {${v}}`)
        .join(",\n");
      return `@${BIB_TYPES[c.type]}{${bibKey(c, used)},\n${body}\n}`;
    })
    .join("\n\n");
}

export function toRIS(citations: Citation[]) {
  return citations
    .map((c) => {
      const [start, finish] = c.pages.split(/\s*[-–—]+\s*/);
      const lines = [
        `TY  - ${RIS_TYPES[c.type]}`,
        ...c.authors.map((a) => `AU  - ${a.family}${a.given ? `, ${a.given}` : ""}`),
        `TI  - ${c.title}`,
        c.container && `T2  - ${c.container}`,
        c.year && `PY  - ${c.year}`,
        c.volume && `VL  - ${c.volume}`,
        c.issue && `IS  - ${c.issue}`,
        start && `SP  - ${start}`,
        finish && `EP  - ${finish}`,
        c.publisher && `PB  - ${c.publisher}`,
        c.doi && `DO  - ${c.doi}`,
        "ER  - ",
      ];
      return lines.filter(Boolean).join("\n");
    })
    .join("\n\n");
}

/** Lets the browser save a text file. */
export function download(filename: string, content: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
