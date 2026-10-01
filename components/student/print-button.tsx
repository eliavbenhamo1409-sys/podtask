"use client";

import { PrinterIcon } from "@/components/podtask/icons";

/** Opens the browser print dialog; print styles live in globals.css. */
export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="btn btn-secondary btn-lg row"
      style={{ gap: 8 }}
      onClick={() => window.print()}
    >
      <PrinterIcon /> {label}
    </button>
  );
}
