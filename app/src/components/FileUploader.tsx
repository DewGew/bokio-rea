"use client";

import { upload } from "@vercel/blob/client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Icon } from "./Icon";

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif";

/** Dra-och-släpp-uppladdning av kvitton och underlag (bilder och PDF). */
export function FileUploader({ blob, companyId, onDone = "open" }: { blob: boolean; companyId: number; onDone?: "open" | "refresh" }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function send(files: File[]) {
    if (files.length === 0) return;
    setBusy(true);
    setError("");
    try {
      let res: Response;
      if (blob) {
        const done: { url: string; fileName: string }[] = [];
        for (const [i, f] of files.entries()) {
          setStatus(`Laddar upp ${i + 1} av ${files.length}: ${f.name}`);
          const ext = (f.name.match(/\.[a-z0-9]{1,6}$/i)?.[0] ?? "").toLowerCase();
          const b = await upload(`companies/${companyId}/${crypto.randomUUID()}${ext}`, f, {
            access: "private",
            handleUploadUrl: "/api/blob",
            contentType: f.type,
          });
          done.push({ url: b.url, fileName: f.name });
        }
        setStatus("Sparar…");
        res = await fetch("/api/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: done }) });
      } else {
        setStatus(`Laddar upp ${files.length} fil(er)…`);
        const fd = new FormData();
        files.forEach((f) => fd.append("files", f));
        res = await fetch("/api/uploads", { method: "POST", body: fd });
      }
      const json = (await res.json()) as { ids?: number[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Uppladdningen misslyckades.");
      if (onDone === "open" && json.ids?.length === 1) router.push(`/uploads/${json.ids[0]}`);
      else router.refresh();
      setStatus(`${json.ids?.length ?? 0} fil(er) uppladdade.`);
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          send([...e.dataTransfer.files]);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-10 text-center transition ${drag ? "border-brand bg-brand-soft" : "border-line hover:border-brand/60 hover:bg-surface-2"} ${busy ? "pointer-events-none opacity-60" : ""}`}
      >
        <span className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-brand">
          <Icon name="upload" className="h-6 w-6" />
        </span>
        <span className="text-[17px] font-semibold text-ink">{busy ? status : "Släpp kvitton här"}</span>
        {!busy && <span className="mt-0.5 text-[15px] text-brand">eller välj filer</span>}
        <span className="mt-2 text-[13px] text-muted">Bilder (JPG, PNG, WEBP, HEIC) eller PDF, max 20 MB per fil. Fota direkt med mobilen.</span>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => send([...(e.target.files ?? [])])}
          disabled={busy}
        />
      </label>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      {!busy && status && !error && <p role="status" className="mt-2 text-sm text-brand">{status}</p>}
    </div>
  );
}
