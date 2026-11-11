// pdf.js needs some files served as static files: the worker that renders pages,
// fonts for PDFs that don't embed them, and decoders for scanned images (JBIG2, JPEG 2000)
import { cpSync, rmSync } from "node:fs";

const from = "node_modules/pdfjs-dist";
const to = "public/pdfjs";

rmSync(to, { recursive: true, force: true });
cpSync(`${from}/build/pdf.worker.min.mjs`, `${to}/pdf.worker.min.mjs`);
for (const folder of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  cpSync(`${from}/${folder}`, `${to}/${folder}`, { recursive: true });
}
