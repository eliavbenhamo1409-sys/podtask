import { setRequestLocale } from "next-intl/server";
import { ProcessingClient } from "./processing-client";

interface ProcessingPageProps {
  params: Promise<{ locale: string; submissionId: string }>;
}

export default async function ProcessingPage({ params }: ProcessingPageProps) {
  const { locale, submissionId } = await params;
  setRequestLocale(locale);
  return <ProcessingClient submissionId={submissionId} />;
}
