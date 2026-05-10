import { setRequestLocale, getTranslations } from "next-intl/server";
import { StudentAppShell } from "@/components/student/student-app-shell";
import { WelcomeHeader } from "@/components/student/welcome-header";
import { SelfInitiatedHero } from "@/components/student/self-initiated-hero";
import { AssignmentCard } from "@/components/student/assignment-card";
import { Chip } from "@/components/podtask/chip";
import { getStudentDashboard } from "@/lib/student/student-service-server";
import { nextRouteForAssignment } from "@/lib/student/routing";
import {
  findMockSubmission,
  findMockInterview,
} from "@/lib/student/mock-data";

interface DashboardPageProps {
  params: Promise<{ locale: string }>;
}

export default async function DashboardPage({ params }: DashboardPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations();
  const dashboard = await getStudentDashboard();
  const firstName = dashboard.profile.fullName.split(/[\s/]+/)[0] ?? "";
  const lecturerAssignments = dashboard.assignments.filter(
    (a) => !a.id.startsWith("self-"),
  );

  return (
    <StudentAppShell studentInitial={dashboard.profile.avatarInitial}>
      <div className="page">
        <WelcomeHeader studentName={firstName} />

        <SelfInitiatedHero />

        {lecturerAssignments.length > 0 && (
          <>
            <div className="between" style={{ marginTop: 48 }}>
              <h2 className="title">{t("dashboard.allAssignments")}</h2>
              <div className="row" style={{ gap: 8 }}>
                <Chip variant="cyan" asButton>
                  {t("dashboard.filterAll")} · {lecturerAssignments.length}
                </Chip>
                <Chip asButton>{t("dashboard.filterInProgress")}</Chip>
                <Chip asButton>{t("dashboard.filterCompleted")}</Chip>
              </div>
            </div>

            <div
              style={{
                marginTop: 24,
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: 20,
              }}
            >
              {lecturerAssignments.map((a, i) => {
                const submission = a.submissionId
                  ? findMockSubmission(a.submissionId)
                  : undefined;
                const interview = a.interviewId
                  ? findMockInterview(a.interviewId)
                  : undefined;
                const href = nextRouteForAssignment(a, submission, interview);
                return (
                  <AssignmentCard
                    key={a.id}
                    assignment={a}
                    href={href}
                    index={i}
                  />
                );
              })}
            </div>
          </>
        )}
      </div>
    </StudentAppShell>
  );
}
