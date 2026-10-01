import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import {
  getInterviewWithAssignment,
  getStudentProfile,
  startInterview,
} from "@/lib/student/student-service-server";
import { InterviewRoomClient } from "./interview-client";

interface InterviewPageProps {
  params: Promise<{ locale: string; interviewId: string }>;
}

export default async function InterviewPage({ params }: InterviewPageProps) {
  const { locale, interviewId } = await params;
  setRequestLocale(locale);

  const data = await getInterviewWithAssignment(interviewId);
  if (!data) notFound();

  const [, profile] = await Promise.all([
    startInterview(interviewId),
    getStudentProfile(),
  ]);
  const firstName = profile.fullName.split(/[\s/]+/)[0] ?? "";

  return (
    <InterviewRoomClient
      interviewId={interviewId}
      assignmentTitle={data.assignment.title}
      questions={data.interview.questions}
      locale={locale}
      studentName={firstName}
      studentInitial={profile.avatarInitial}
    />
  );
}
