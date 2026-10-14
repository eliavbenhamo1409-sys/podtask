"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/lib/i18n/navigation";
import { setAssignmentStatus } from "@/lib/lecturer/lecturer-service";
import type { AssignmentStatus } from "@/lib/lecturer/types";

export function AssignmentStatusControl({
  assignmentId,
  status,
}: {
  assignmentId: string;
  status: AssignmentStatus;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function change(next: "published" | "closed") {
    if (pending) return;
    setPending(true);
    const ok = await setAssignmentStatus(assignmentId, next);
    setPending(false);
    if (ok) router.refresh();
  }

  if (status === "published") {
    return (
      <button type="button" className="btn btn-secondary" onClick={() => void change("closed")} disabled={pending}>
        {t("lecturer.close")}
      </button>
    );
  }
  if (status === "draft" || status === "closed") {
    return (
      <button type="button" className="btn btn-primary" onClick={() => void change("published")} disabled={pending}>
        {status === "draft" ? t("lecturer.publish") : t("lecturer.reopen")}
      </button>
    );
  }
  return null;
}
