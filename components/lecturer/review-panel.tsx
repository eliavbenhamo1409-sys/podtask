"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/lib/i18n/navigation";
import { saveReview } from "@/lib/lecturer/lecturer-service";
import type { ReviewStatus } from "@/lib/lecturer/types";

interface ReviewPanelProps {
  interviewId: string;
  initial: { status: ReviewStatus; followUpRequested: boolean; note: string | null } | null;
}

const STATUSES: ReviewStatus[] = [
  "unreviewed",
  "reviewed",
  "needs_clarification",
  "closed_no_finding",
];
const KEY: Record<ReviewStatus, string> = {
  unreviewed: "lecturer.reviewUnreviewed",
  reviewed: "lecturer.reviewReviewed",
  needs_clarification: "lecturer.reviewNeedsClarification",
  closed_no_finding: "lecturer.reviewClosed",
};

/** The lecturer's verdict on one interview: status, follow-up, internal note. */
export function ReviewPanel({ interviewId, initial }: ReviewPanelProps) {
  const t = useTranslations();
  const router = useRouter();
  const [status, setStatus] = useState<ReviewStatus>(initial?.status ?? "unreviewed");
  const [followUp, setFollowUp] = useState(initial?.followUpRequested ?? false);
  const [note, setNote] = useState(initial?.note ?? "");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (pending) return;
    setPending(true);
    setError(null);
    setSaved(false);
    const ok = await saveReview(interviewId, { status, followUpRequested: followUp, note });
    setPending(false);
    if (!ok) {
      setError(t("lecturer.errorGeneric"));
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <div className="card" style={{ padding: 24 }}>
      <div style={{ fontWeight: 800, fontSize: 17 }}>{t("lecturer.reviewTitle")}</div>
      <div className="lx-form-grid" style={{ marginTop: 14 }}>
        <label className="lx-field">
          <span>{t("lecturer.reviewStatus")}</span>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as ReviewStatus)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(KEY[s])}
              </option>
            ))}
          </select>
        </label>
        <label className="lx-toggle" style={{ alignSelf: "end" }}>
          <input type="checkbox" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} />
          <span>{t("lecturer.followUp")}</span>
        </label>
        <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
          <span>{t("lecturer.note")}</span>
          <textarea className="input lx-textarea" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      {error ? (
        <div role="alert" style={{ color: "rgb(var(--pink-rose))", fontSize: 13, marginTop: 10 }}>
          {error}
        </div>
      ) : null}
      <div className="row" style={{ gap: 12, marginTop: 14, justifyContent: "flex-end", alignItems: "center" }}>
        {saved ? <span className="text-muted" style={{ fontSize: 13 }}>{t("lecturer.saved")}</span> : null}
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={pending}>
          {t("lecturer.save")}
        </button>
      </div>
    </div>
  );
}
