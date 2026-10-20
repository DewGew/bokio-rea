// Kopierar pdf.js-workern till public/ så att PDF-förhandsvisningen kan ladda den från samma domän.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const src = require.resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs");
mkdirSync("public", { recursive: true });
copyFileSync(src, path.join("public", "pdf.worker.min.mjs"));
