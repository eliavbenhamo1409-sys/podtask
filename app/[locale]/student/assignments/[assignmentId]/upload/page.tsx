import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getAssignmentById } from "@/lib/student/student-service-server";
import { UploadAssignmentClient } from "./upload-client";

interface UploadPageProps {
  params: Promise<{ locale: string; assignmentId: string }>;
}

export default async function UploadPage({ params }: UploadPageProps) {
  const { locale, assignmentId } = await params;
  setRequestLocale(locale);

  const assignment = await getAssignmentById(assignmentId);
  if (!assignment) notFound();

  return <UploadAssignmentClient assignment={assignment} />;
}
