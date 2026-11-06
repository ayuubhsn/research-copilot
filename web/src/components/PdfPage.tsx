"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Rect } from "@/lib/types";

export type Highlight = { rects: Rect[]; strong: boolean };

type Props = {
  url: string;
  page: number;
  highlights: Highlight[];
};

// pdf.js is loaded in the browser only, and each PDF is downloaded once
const documents = new Map<string, Promise<PDFDocumentProxy>>();

async function loadPdf(url: string) {
  if (!documents.has(url)) {
    documents.set(
      url,
      import("pdfjs-dist").then((pdfjs) => {
        // The worker is copied to public/ by the postinstall script in package.json
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        return pdfjs.getDocument({ url }).promise;
      }),
    );
  }
  return documents.get(url)!;
}

// One page of the original PDF, with yellow highlights drawn on top
export default function PdfPage({ url, page, highlights }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const strongRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [ratio, setRatio] = useState(1.3); // height / width, updated once the page is loaded
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  // Re-render when the panel changes size
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!width || !canvas.current) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;

    (async () => {
      try {
        const pdf = await loadPdf(url);
        const pdfPage = await pdf.getPage(Math.min(page, pdf.numPages));
        if (cancelled) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const viewport = pdfPage.getViewport({ scale: (width / base.width) * window.devicePixelRatio });
        const el = canvas.current!;
        el.width = viewport.width;
        el.height = viewport.height;
        setRatio(base.height / base.width);
        task = pdfPage.render({ canvas: el, viewport });
        await task.promise;
        if (!cancelled) setStatus("ready");
      } catch (error) {
        if (!cancelled && (error as Error)?.name !== "RenderingCancelledException") setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [url, page, width]);

  useEffect(() => {
    if (status === "ready") strongRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [status, highlights, page]);

  const firstStrong = highlights.findIndex((h) => h.strong && h.rects.length > 0);

  return (
    <div ref={box} className="relative w-full overflow-hidden rounded-md bg-white shadow-xl shadow-black/40" style={{ aspectRatio: `1 / ${ratio}` }}>
      <canvas ref={canvas} className="block h-full w-full" />
      {status === "ready" &&
        highlights.flatMap((h, hi) =>
          h.rects.map((r, ri) => {
            const isFirst = hi === firstStrong && ri === 0;
            return (
              <div
                key={`${hi}-${ri}`}
                ref={isFirst ? (el) => void (strongRef.current = el) : undefined}
                className={`pointer-events-none absolute rounded-[2px] mix-blend-multiply ${h.strong ? "bg-accent/70" : "bg-accent/25"}`}
                style={{
                  left: `${r.x * 100 - 0.3}%`,
                  top: `${r.y * 100 - 0.15}%`,
                  width: `${r.w * 100 + 0.6}%`,
                  height: `${r.h * 100 + 0.3}%`,
                }}
              />
            );
          }),
        )}
      {status === "loading" && <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-soft">Loading page…</div>}
      {status === "error" && <div className="absolute inset-0 flex items-center justify-center text-sm text-bad">Could not show this page.</div>}
    </div>
  );
}
