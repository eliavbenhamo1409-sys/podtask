import { setRequestLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { redirect, Link } from "@/lib/i18n/navigation";
import {
  getInterviewWithAssignment,
  getStudentProfile,
  startInterview,
} from "@/lib/student/student-service-server";
import { StudentAppShell } from "@/components/student/student-app-shell";
import { InterviewRoomClient } from "./interview-client";

interface InterviewPageProps {
  params: Promise<{ locale: string; interviewId: string }>;
}

export default async function InterviewPage({ params }: InterviewPageProps) {
  const { locale, interviewId } = await params;
  setRequestLocale(locale);

  const data = await getInterviewWithAssignment(interviewId);
  if (!data) notFound();

  // The server moves the interview to in_progress (or resumes it) and hands
  // back the outline without question text, the integrity settings and the
  // resume point. Every refusal has a home.
  const [started, profile] = await Promise.all([
    startInterview(interviewId),
    getStudentProfile(),
  ]);
  const submissionId = data.interview.submissionId;

  if (!started.ok) {
    if (started.error === "consent_required") {
      redirect({ href: `/student/submissions/${submissionId}/consent`, locale });
    }
    if (started.error === "interview_completed") {
      redirect({ href: `/student/interviews/${interviewId}/complete`, locale });
    }
    if (started.error === "not_found") notFound();
    const t = await getTranslations();
    return (
      <StudentAppShell>
        <div className="page-narrow" style={{ paddingTop: 48 }}>
          <div className="card" style={{ padding: 32, textAlign: "center" }}>
            <h1 className="title" style={{ marginTop: 0 }}>
              {t("interview.unavailableTitle")}
            </h1>
            <p className="subtitle">
              {started.error === "assignment_closed"
                ? t("interview.unavailableClosed")
                : t("interview.unavailableBody")}
            </p>
            <Link href="/student" className="btn btn-primary" style={{ marginTop: 16 }}>
              {t("complete.backToDashboard")}
            </Link>
          </div>
        </div>
      </StudentAppShell>
    );
  }

  const firstName = profile.fullName.split(/[\s/]+/)[0] ?? "";

  return (
    <InterviewRoomClient
      interviewId={interviewId}
      submissionId={submissionId}
      assignmentTitle={data.assignment.title}
      questions={started.questions.length > 0 ? started.questions : data.interview.questions}
      locale={locale}
      interviewLanguage={data.interview.language}
      studentName={firstName}
      studentInitial={profile.avatarInitial}
      integrity={started.settings}
      resume={started.resume}
      attempt={started.attempt}
    />
  );
}
