import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
      <p className="text-[64px] font-semibold leading-none tracking-[-0.04em] text-muted/40">404</p>
      <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.02em]">Sidan hittades inte</h1>
      <p className="mt-1 max-w-sm text-[15px] text-muted">Den kan ha tagits bort, eller så tillhör den ett annat företag.</p>
      <Link href="/" className="btn-primary mt-6">Till översikten</Link>
    </div>
  );
}
