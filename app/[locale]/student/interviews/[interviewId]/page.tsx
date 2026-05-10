import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import {
  getInterviewWithAssignment,
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

  await startInterview(interviewId);

  return (
    <InterviewRoomClient
      interviewId={interviewId}
      assignmentTitle={data.assignment.title}
      questions={data.interview.questions}
      locale={locale}
    />
  );
}
