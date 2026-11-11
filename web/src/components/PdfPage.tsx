"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Rect } from "@/lib/types";

// source: a passage the answer used · focus: the one being looked at · saved: a quote in the notebook
export type Highlight = { rects: Rect[]; kind: "source" | "focus" | "saved" };

type Props = {
  url: string;
  page: number;
  highlights: Highlight[];
  onSaveSelection?: (text: string) => Promise<void> | void;
};

type PdfJs = typeof import("pdfjs-dist");

// pdf.js is loaded in the browser only, and each PDF is downloaded once
let pdfjsModule: Promise<PdfJs> | null = null;
const documents = new Map<string, Promise<PDFDocumentProxy>>();

function loadPdfJs() {
  pdfjsModule ??= import("pdfjs-dist").then((pdfjs) => {
    // These files are copied to public/pdfjs by scripts/copy-pdf-worker.mjs on npm install
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
    return pdfjs;
  });
  return pdfjsModule;
}

async function loadPdf(url: string) {
  if (!documents.has(url)) {
    documents.set(
      url,
      loadPdfJs().then(
        (pdfjs) =>
          pdfjs.getDocument({
            url,
            wasmUrl: "/pdfjs/wasm/", // decoders for scanned pages
            standardFontDataUrl: "/pdfjs/standard_fonts/",
            cMapUrl: "/pdfjs/cmaps/",
            cMapPacked: true,
            iccUrl: "/pdfjs/iccs/",
          }).promise,
      ),
    );
  }
  return documents.get(url)!;
}

const STYLE: Record<Highlight["kind"], string> = {
  source: "bg-accent/25",
  focus: "bg-accent/70",
  saved: "bg-mint/45",
};

// One page of the original PDF: the rendered page, highlights on top, and an
// invisible text layer so the reader can select text and save it.
export default function PdfPage({ url, page, highlights, onSaveSelection }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const textLayer = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [scale, setScale] = useState(1);
  const [ratio, setRatio] = useState(1.3); // height / width, updated once the page is loaded
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorText, setErrorText] = useState("");
  const [selection, setSelection] = useState<{ text: string; x: number; y: number } | null>(null);
  const [saving, setSaving] = useState(false);

  // Re-render when the panel changes size
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!width || !canvas.current || !textLayer.current) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    let text: { cancel: () => void } | null = null;

    (async () => {
      try {
        const [pdfjs, pdf] = await Promise.all([loadPdfJs(), loadPdf(url)]);
        const pdfPage = await pdf.getPage(Math.min(page, pdf.numPages));
        if (cancelled) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const cssScale = width / base.width;
        const el = canvas.current!;
        const viewport = pdfPage.getViewport({ scale: cssScale * window.devicePixelRatio });
        el.width = viewport.width;
        el.height = viewport.height;
        setRatio(base.height / base.width);
        setScale(cssScale);
        task = pdfPage.render({ canvas: el, viewport });
        await task.promise;
        if (cancelled) return;
        setStatus("ready");

        // The selectable text layer is a bonus: if it fails, the page is still shown
        try {
          const layer = textLayer.current!;
          layer.replaceChildren();
          const textLayerTask = new pdfjs.TextLayer({
            textContentSource: pdfPage.streamTextContent(),
            container: layer,
            viewport: pdfPage.getViewport({ scale: cssScale }),
          });
          text = textLayerTask;
          await textLayerTask.render();
        } catch (error) {
          if (!cancelled && (error as Error)?.name !== "AbortException") console.warn("PDF text layer failed", error);
        }
      } catch (error) {
        const name = (error as Error)?.name;
        if (!cancelled && name !== "RenderingCancelledException" && name !== "AbortException") {
          console.error("Could not render PDF page", error);
          setErrorText(error instanceof Error ? error.message : String(error));
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
      task?.cancel();
      text?.cancel();
    };
  }, [url, page, width]);

  useEffect(() => {
    if (status === "ready") focusRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [status, highlights, page]);

  // When the reader selects text on the page, offer to save it
  const onMouseUp = () => {
    if (!onSaveSelection) return;
    const sel = window.getSelection();
    const text = sel?.toString().replace(/\s+/g, " ").trim() ?? "";
    if (!sel || text.length < 4 || !box.current?.contains(sel.anchorNode)) return;
    const range = sel.getRangeAt(0).getBoundingClientRect();
    const outer = box.current.getBoundingClientRect();
    setSelection({ text, x: range.left + range.width / 2 - outer.left, y: range.top - outer.top });
  };

  const save = async () => {
    if (!selection || !onSaveSelection) return;
    setSaving(true);
    try {
      await onSaveSelection(selection.text);
      window.getSelection()?.removeAllRanges();
      setSelection(null);
    } finally {
      setSaving(false);
    }
  };

  const firstFocus = highlights.findIndex((h) => h.kind === "focus" && h.rects.length > 0);

  return (
    <div
      ref={box}
      onMouseUp={onMouseUp}
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest("[data-selection-menu]")) setSelection(null);
      }}
      className="relative w-full rounded-md bg-white shadow-xl shadow-black/40"
      style={
        {
          aspectRatio: `1 / ${ratio}`,
          "--total-scale-factor": scale,
          "--scale-round-x": "1px",
          "--scale-round-y": "1px",
        } as React.CSSProperties
      }
    >
      <canvas ref={canvas} className="absolute inset-0 block h-full w-full rounded-md" />
      {status === "ready" &&
        highlights.flatMap((h, hi) =>
          h.rects.map((r, ri) => (
            <div
              key={`${hi}-${ri}`}
              ref={hi === firstFocus && ri === 0 ? (el) => void (focusRef.current = el) : undefined}
              className={`pointer-events-none absolute rounded-[2px] mix-blend-multiply ${STYLE[h.kind]}`}
              style={{
                left: `${r.x * 100 - 0.3}%`,
                top: `${r.y * 100 - 0.15}%`,
                width: `${r.w * 100 + 0.6}%`,
                height: `${r.h * 100 + 0.3}%`,
              }}
            />
          )),
        )}
      <div ref={textLayer} className="textLayer" />

      {selection && (
        <div
          data-selection-menu
          className="absolute z-10 -translate-x-1/2 -translate-y-full pb-2"
          style={{ left: selection.x, top: selection.y }}
        >
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium whitespace-nowrap text-text shadow-xl ring-1 ring-line transition hover:bg-raised disabled:opacity-60"
          >
            {saving ? "Saving…" : "★ Save to notebook"}
          </button>
        </div>
      )}

      {status === "loading" && <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-soft">Loading page…</div>}
      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-sm">
          <span className="text-bad">Could not show this page.</span>
          {errorText && <span className="font-mono text-xs break-all text-ink-soft">{errorText}</span>}
          <a href={url} target="_blank" rel="noreferrer" className="text-xs text-ink underline">
            Open the PDF in a new tab
          </a>
        </div>
      )}
    </div>
  );
}
