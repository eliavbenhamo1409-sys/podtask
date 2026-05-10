import { setRequestLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { StudentAppShell } from "@/components/student/student-app-shell";
import { AssignmentDetailsCard } from "@/components/student/assignment-details-card";
import { WhatHappensNextCard } from "@/components/student/what-happens-next-card";
import { Link } from "@/lib/i18n/navigation";
import { BackIcon } from "@/components/podtask/icons";
import { getAssignmentById } from "@/lib/student/student-service-server";

interface AssignmentDetailsPageProps {
  params: Promise<{ locale: string; assignmentId: string }>;
}

export default async function AssignmentDetailsPage({
  params,
}: AssignmentDetailsPageProps) {
  const { locale, assignmentId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const assignment = await getAssignmentById(assignmentId);
  if (!assignment) notFound();

  const uploadHref = `/student/assignments/${assignment.id}/upload`;

  return (
    <StudentAppShell>
      <div className="page">
        <Link href="/student" style={{ textDecoration: "none" }}>
          <button
            type="button"
            className="btn btn-ghost row"
            style={{ padding: "8px 0", marginBottom: 8, gap: 8 }}
          >
            <span className="icon-flip">
              <BackIcon />
            </span>
            {t("common.back")}
          </button>
        </Link>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.2fr 1fr",
            gap: 32,
            alignItems: "start",
          }}
        >
          <AssignmentDetailsCard assignment={assignment} />
          <WhatHappensNextCard uploadHref={uploadHref} />
        </div>
      </div>
    </StudentAppShell>
  );
}
