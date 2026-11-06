import type { DocumentInfo } from "@/lib/types";

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full border-accent"
      style={{ width: size, height: size, borderWidth: Math.max(2, size / 9) }}
      aria-hidden
    >
      <span className="rounded-full bg-accent" style={{ width: size / 3.6, height: size / 3.6 }} />
    </span>
  );
}

export default function TopBar({ doc, live }: { doc: DocumentInfo | null; live: boolean }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel-2 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2.5 text-sm">
        <Logo />
        <span className="font-semibold tracking-tight">ResearchCopilot</span>
        {doc && (
          <>
            <span className="text-dim">/</span>
            <span className="truncate font-mono text-[13px] text-soft">{doc.file}</span>
            <span className="hidden font-mono text-xs text-muted sm:inline">
              {doc.pageCount} pages · {doc.passages} passages
            </span>
          </>
        )}
      </div>
      <div className="flex items-center gap-3">
        {!live && (
          <span
            className="flex items-center gap-2 rounded-full border border-line px-3 py-1 text-xs text-muted"
            title="Answers are recorded runs of the real pipeline, replayed in the browser"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-warn" />
            Demo mode · recorded answers
          </span>
        )}
        <a
          href="https://github.com/ayuubhsn/research-copilot"
          className="rounded-lg border border-line px-3 py-1.5 text-xs text-soft transition hover:border-accent hover:text-accent"
        >
          Source code
        </a>
      </div>
    </header>
  );
}
