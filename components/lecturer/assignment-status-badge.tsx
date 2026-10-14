import { useTranslations } from "next-intl";
import { Badge } from "@/components/podtask/chip";
import type { AssignmentStatus } from "@/lib/lecturer/types";

const VARIANT: Record<AssignmentStatus, "mint" | "neutral" | "amber" | "pink"> = {
  published: "mint",
  draft: "neutral",
  closed: "amber",
  archived: "neutral",
};

const KEY: Record<AssignmentStatus, string> = {
  published: "lecturer.statusPublished",
  draft: "lecturer.statusDraft",
  closed: "lecturer.statusClosed",
  archived: "lecturer.statusArchived",
};

export function AssignmentStatusBadge({ status }: { status: AssignmentStatus }) {
  const t = useTranslations();
  return (
    <Badge variant={VARIANT[status]} showDot={status === "published"}>
      {t(KEY[status])}
    </Badge>
  );
}
