"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Renderar en PDF med pdf.js till canvas. Ser likadan ut i alla webbläsare (även iOS, där inbäddade PDF:er
 * bara visar första sidan) och fungerar för PDF:er som kräver inloggning.
 */
export function PdfPreview({ src, className = "", maxPages = 5, label = "PDF-förhandsvisning" }: { src: string; className?: string; maxPages?: number; label?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    const el = host.current;
    if (!el) return;
    setState("loading");

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const res = await fetch(src, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const doc = await pdfjs.getDocument({ data: await res.arrayBuffer() }).promise;
        // Behållaren är dold under laddning, så bredden mäts på föräldern.
        const width = el.parentElement?.clientWidth || el.clientWidth || 600;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const canvases: HTMLCanvasElement[] = [];
        for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: (width / base.width) * dpr });
          const canvas = document.createElement("canvas");
          canvas.width = vp.width;
          canvas.height = vp.height;
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          canvas.className = "block bg-white";
          await page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
          canvases.push(canvas);
        }
        if (cancelled) return;
        el.replaceChildren(...canvases.flatMap((c, i) => (i ? [Object.assign(document.createElement("div"), { className: "h-3 bg-surface-2" }), c] : [c])));
        setState("ready");
        doc.destroy();
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src, maxPages]);

  return (
    <div className={`relative ${className}`} aria-label={label} role="img">
      <div ref={host} className={state === "ready" ? "" : "hidden"} />
      {state === "loading" && <div className="aspect-[1/1.414] w-full animate-pulse rounded-lg bg-surface-2" />}
      {state === "error" && (
        <div className="flex aspect-[1/1.414] w-full flex-col items-center justify-center gap-2 rounded-lg bg-surface-2 p-6 text-center text-[14px] text-muted">
          Förhandsvisningen kunde inte laddas.
          <a href={src} target="_blank" className="text-brand">Öppna PDF:en</a>
        </div>
      )}
    </div>
  );
}
