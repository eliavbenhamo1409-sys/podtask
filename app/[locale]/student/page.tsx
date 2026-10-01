import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { StudentAppShell } from "@/components/student/student-app-shell";
import { WelcomeHeader } from "@/components/student/welcome-header";
import { SelfInitiatedHero } from "@/components/student/self-initiated-hero";
import { AssignmentGrid } from "@/components/student/assignment-grid";
import { getStudentDashboard } from "@/lib/student/student-service-server";
import { nextRouteForAssignment } from "@/lib/student/routing";
import {
  findMockSubmission,
  findMockInterview,
} from "@/lib/student/mock-data";

interface DashboardPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale });
  return { title: t("screens.dashboard") };
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
          <AssignmentGrid
            title={t("dashboard.allAssignments")}
            style={{ marginTop: 48 }}
            items={lecturerAssignments.map((a) => {
              const submission = a.submissionId
                ? findMockSubmission(a.submissionId)
                : undefined;
              const interview = a.interviewId
                ? findMockInterview(a.interviewId)
                : undefined;
              return {
                assignment: a,
                href: nextRouteForAssignment(a, submission, interview),
              };
            })}
          />
        )}
      </div>
    </StudentAppShell>
  );
}
