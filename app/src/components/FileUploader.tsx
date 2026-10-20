"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ACCEPT_ALL, uploadFiles, type Uploaded } from "@/lib/upload-client";
import { Icon } from "./Icon";

/**
 * Uppladdning av kvitton och underlag: dra och släpp, välj fil (bild eller PDF) eller ta en bild med kameran.
 * Utan onUploaded öppnas ett ensamt underlag direkt för bokföring.
 */
export function FileUploader({
  blob,
  companyId,
  verificationId,
  onUploaded,
  compact = false,
}: {
  blob: boolean;
  companyId: number;
  verificationId?: number;
  onUploaded?: (files: Uploaded[]) => void;
  compact?: boolean;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function send(files: File[]) {
    if (files.length === 0) return;
    setBusy(true);
    setError("");
    try {
      const done = await uploadFiles(files, { blob, companyId, verificationId, onStatus: setStatus });
      setStatus(done.length === 1 ? `${done[0].fileName} är uppladdad.` : `${done.length} filer är uppladdade.`);
      if (onUploaded) onUploaded(done);
      // Ett ensamt nytt underlag öppnas direkt för bokföring; annars uppdateras sidan.
      if (!onUploaded && !verificationId && done.length === 1) router.push(`/uploads/${done[0].id}`);
      else if (!onUploaded) router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
      if (cameraInput.current) cameraInput.current.value = "";
    }
  }

  const buttons = (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <button type="button" disabled={busy} onClick={() => cameraInput.current?.click()} className="btn-primary">
        <Icon name="camera" className="h-[18px] w-[18px]" />
        Ta bild
      </button>
      <button type="button" disabled={busy} onClick={() => fileInput.current?.click()} className="btn-secondary">
        <Icon name="doc" className="h-[18px] w-[18px]" />
        Välj PDF eller bild
      </button>
      <input ref={fileInput} type="file" multiple accept={ACCEPT_ALL} className="sr-only" tabIndex={-1} onChange={(e) => send([...(e.target.files ?? [])])} />
      {/* capture öppnar kameran direkt på mobilen; på datorn öppnas en filväljare */}
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} onChange={(e) => send([...(e.target.files ?? [])])} />
    </div>
  );

  return (
    <div>
      <div
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
        className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed text-center transition ${compact ? "px-4 py-5" : "px-4 py-9"} ${drag ? "border-brand bg-brand-soft" : "border-line"} ${busy ? "opacity-70" : ""}`}
      >
        {!compact && (
          <span className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-brand">
            <Icon name="upload" className="h-6 w-6" />
          </span>
        )}
        {!compact && <span className="mb-1 text-[17px] font-semibold text-ink">{busy ? status : "Lägg till kvitton och fakturor"}</span>}
        {!compact && !busy && <span className="mb-4 text-[14px] text-muted">Dra och släpp filer här, fota kvittot eller välj en fil.</span>}
        {compact && busy ? <span className="text-[14px] text-muted">{status}</span> : buttons}
        {!compact && busy && <span className="sr-only">{status}</span>}
        <span className={`text-[12px] text-muted ${compact ? "mt-2" : "mt-4"}`}>PDF, JPG, PNG, WEBP eller HEIC · max 20 MB per fil</span>
      </div>
      {error && <p role="alert" className="mt-2 text-[14px] font-medium text-danger">{error}</p>}
      {!busy && status && !error && <p role="status" className="mt-2 text-[14px] text-success">{status}</p>}
    </div>
  );
}
