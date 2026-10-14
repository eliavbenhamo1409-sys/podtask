import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { redirect } from "@/lib/i18n/navigation";
import { StudentAppShell } from "@/components/student/student-app-shell";
import { getSubmissionLobby } from "@/lib/student/student-service-server";
import { CONSENT_VERSION, resolveIntegritySettings } from "@/lib/integrity/settings";
import { ConsentClient } from "./consent-client";

interface ConsentPageProps {
  params: Promise<{ locale: string; submissionId: string }>;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; submissionId: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale });
  return { title: t("consent.title") };
}

/**
 * The integrity notice shown once per interview, between the lobby and the
 * mic / camera check. The acknowledgement is recorded server-side
 * (`interview-control`, action "consent"); the room refuses to start without
 * it when the assignment requires one.
 */
export default async function ConsentPage({ params }: ConsentPageProps) {
  const { locale, submissionId } = await params;
  setRequestLocale(locale);
  const lobby = await getSubmissionLobby(submissionId);
  if (!lobby) notFound();

  const settings =
    lobby.assignment.integrity ?? resolveIntegritySettings(null, { personal: false });
  if (!settings.requireConsent) {
    redirect({ href: `/student/submissions/${submissionId}/mic-test`, locale });
  }

  return (
    <StudentAppShell blobsVariant="studio">
      <ConsentClient
        submissionId={submissionId}
        interviewId={lobby.interview.id}
        locale={locale}
        version={settings.consentVersion || CONSENT_VERSION}
        camera={settings.camera}
        activityMonitoring={settings.activityMonitoring}
        overlapCheck={settings.overlapCheck}
        hostName={lobby.assignment.lecturerName}
      />
    </StudentAppShell>
  );
}
