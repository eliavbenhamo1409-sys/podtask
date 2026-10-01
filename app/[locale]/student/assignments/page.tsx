import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { StudentAppShell } from "@/components/student/student-app-shell";
import { AssignmentGrid } from "@/components/student/assignment-grid";
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

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale });
  return { title: t("dashboard.allAssignments") };
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

        <AssignmentGrid
          style={{ marginTop: 24 }}
          items={assignments.map((a) => {
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
      </div>
    </StudentAppShell>
  );
}
