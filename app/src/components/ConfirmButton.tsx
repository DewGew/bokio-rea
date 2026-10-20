"use client";

import { useFormStatus } from "react-dom";

export function ConfirmButton({ children, message, className = "btn-primary" }: { children: React.ReactNode; message?: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      className={className}
      disabled={pending}
      onClick={(e) => {
        if (message && !confirm(message)) e.preventDefault();
      }}
    >
      {pending ? "Sparar…" : children}
    </button>
  );
}
