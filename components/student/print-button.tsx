"use client";

import { PrinterIcon } from "@/components/podtask/icons";

/** Opens the browser print dialog; print styles live in globals.css. */
export function PrintButton({
  label,
  className = "btn btn-secondary btn-lg row",
}: {
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={className}
      style={{ gap: 8 }}
      onClick={() => window.print()}
    >
      <PrinterIcon /> {label}
    </button>
  );
}
