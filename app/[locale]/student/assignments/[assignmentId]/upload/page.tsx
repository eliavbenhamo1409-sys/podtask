import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAssignmentById } from "@/lib/student/student-service-server";
import { UploadAssignmentClient } from "./upload-client";

interface UploadPageProps {
  params: Promise<{ locale: string; assignmentId: string }>;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; assignmentId: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale });
  return { title: t("screens.upload") };
}

export default async function UploadPage({ params }: UploadPageProps) {
  const { locale, assignmentId } = await params;
  setRequestLocale(locale);

  const assignment = await getAssignmentById(assignmentId);
  if (!assignment) notFound();

  return <UploadAssignmentClient assignment={assignment} />;
}
