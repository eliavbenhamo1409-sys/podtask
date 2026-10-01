import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { ProcessingClient } from "./processing-client";

interface ProcessingPageProps {
  params: Promise<{ locale: string; submissionId: string }>;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; submissionId: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale });
  return { title: t("screens.processing") };
}

export default async function ProcessingPage({ params }: ProcessingPageProps) {
  const { locale, submissionId } = await params;
  setRequestLocale(locale);
  return <ProcessingClient submissionId={submissionId} />;
}
