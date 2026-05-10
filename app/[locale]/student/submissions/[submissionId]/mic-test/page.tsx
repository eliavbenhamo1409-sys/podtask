import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getSubmissionLobby } from "@/lib/student/student-service-server";
import { MicTestClient } from "./mic-test-client";

interface MicTestPageProps {
  params: Promise<{ locale: string; submissionId: string }>;
}

export default async function MicTestPage({ params }: MicTestPageProps) {
  const { locale, submissionId } = await params;
  setRequestLocale(locale);

  const lobby = await getSubmissionLobby(submissionId);
  if (!lobby) notFound();

  return (
    <MicTestClient
      submissionId={submissionId}
      interviewId={lobby.interview.id}
    />
  );
}
