import { setRequestLocale, getTranslations } from "next-intl/server";
import { StudentAppShell } from "@/components/student/student-app-shell";
import { AssignmentCard } from "@/components/student/assignment-card";
import { Chip } from "@/components/podtask/chip";
import { Eyebrow } from "@/components/podtask/eyebrow";
import { getStudentAssignments } from "@/lib/student/student-service-server";
import { nextRouteForAssignment } from "@/lib/student/routing";
import {
  findMockSubmission,
  findMockInterview,
} from "@/lib/student/mock-data";

interface AssignmentsPageProps {
  params: Promise<{ locale: string }>;
}

export default async function AssignmentsPage({ params }: AssignmentsPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  const assignments = await getStudentAssignments();

  return (
    <StudentAppShell>
      <div className="page">
        <Eyebrow showDot>{t("screens.dashboard")}</Eyebrow>
        <h1 className="display">{t("dashboard.allAssignments")}</h1>
        <p className="subtitle" style={{ maxWidth: 580 }}>
          {t("dashboard.subtitle")}
        </p>

        <div className="row" style={{ gap: 8, marginTop: 24, flexWrap: "wrap" }}>
          <Chip variant="cyan" asButton>
            {t("dashboard.filterAll")} · {assignments.length}
          </Chip>
          <Chip asButton>{t("dashboard.filterInProgress")}</Chip>
          <Chip asButton>{t("dashboard.filterCompleted")}</Chip>
        </div>

        <div
          style={{
            marginTop: 32,
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 20,
          }}
        >
          {assignments.map((a, i) => {
            const submission = a.submissionId
              ? findMockSubmission(a.submissionId)
              : undefined;
            const interview = a.interviewId
              ? findMockInterview(a.interviewId)
              : undefined;
            const href = nextRouteForAssignment(a, submission, interview);
            return (
              <AssignmentCard key={a.id} assignment={a} href={href} index={i} />
            );
          })}
        </div>
      </div>
    </StudentAppShell>
  );
}
