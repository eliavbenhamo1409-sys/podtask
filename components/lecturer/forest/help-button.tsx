"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { QuestionIcon } from "@/components/podtask/icons";

/** "Help" in the forest lecturer top bar: a short how-it-works note. */
export function ForestHelpButton() {
  const t = useTranslations("forestLecturer");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="lxf-help" ref={rootRef}>
      <button
        type="button"
        className="lxf-help-btn"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <QuestionIcon size={22} strokeWidth={1.6} aria-hidden />
        <span className="lxf-help-label">{t("help")}</span>
      </button>
      {open ? (
        <div className="lxf-help-panel" id={panelId} role="dialog" aria-label={t("helpTitle")}>
          <div className="lxf-help-title">{t("helpTitle")}</div>
          <ol className="lxf-help-steps">
            <li>{t("helpStep1")}</li>
            <li>{t("helpStep2")}</li>
            <li>{t("helpStep3")}</li>
            <li>{t("helpStep4")}</li>
          </ol>
        </div>
      ) : null}
    </div>
  );
}
