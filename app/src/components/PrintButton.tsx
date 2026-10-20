"use client";

export function PrintButton() {
  return (
    <button className="btn-primary" onClick={() => window.print()}>
      Skriv ut / spara som PDF
    </button>
  );
}
