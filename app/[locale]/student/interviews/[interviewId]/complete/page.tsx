import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link } from "@/lib/i18n/navigation";
import { StudentAppShell } from "@/components/student/student-app-shell";
import { ArrowIcon, CheckIcon } from "@/components/podtask/icons";
import {
  getInterviewWithAssignment,
  getReportForInterview,
  getStudentProfile,
} from "@/lib/student/student-service-server";
import { formatTime } from "@/lib/utils";
import { ScoreCard } from "./score-card";
import { PrintButton } from "@/components/student/print-button";
import { ConfettiBurst } from "@/components/podtask/confetti-burst";

interface CompletePageProps {
  params: Promise<{ locale: string; interviewId: string }>;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; interviewId: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale });
  return { title: t("screens.complete") };
}

export default async function CompletePage({ params }: CompletePageProps) {
  const { locale, interviewId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const data = await getInterviewWithAssignment(interviewId);
  if (!data) notFound();

  const [profile, report] = await Promise.all([
    getStudentProfile(),
    getReportForInterview(interviewId),
  ]);

  const duration = data.interview.durationSeconds ?? 0;
  const totalQuestions = data.interview.questions?.length ?? 0;
  const completedAt = data.interview.completedAt
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(data.interview.completedAt))
    : t("complete.justNow");

  return (
    <StudentAppShell>
      <div className="report-page">
        <header className="report-head">
          <div className="report-check" aria-hidden>
            <span className="report-confetti">
              <ConfettiBurst />
            </span>
            <span className="report-check-ring" />
            <span className="report-check-ring is-pink" />
            <span className="report-check-disc">
              <CheckIcon size={24} />
            </span>
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 className="report-title">{t("complete.title")}</h1>
            <p className="report-sub">{t("complete.subtitle")}</p>
            <div className="report-meta-wrap">
              <dl className="report-meta">
                <div>
                  <dt>{t("complete.duration")}</dt>
                  <dd>{formatTime(duration)}</dd>
                </div>
                <div>
                  <dt>{t("complete.questions")}</dt>
                  <dd>
                    {totalQuestions > 0 ? totalQuestions : t("complete.questionsUnknown")}
                  </dd>
                </div>
                <div>
                  <dt>{t("complete.submitted")}</dt>
                  <dd>
                    <bdi>{completedAt}</bdi>
                  </dd>
                </div>
                <div>
                  <dt>{t("complete.copyEmailed")}</dt>
                  <dd>
                    <bdi>{profile.email}</bdi>
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </header>

        <div className="report-actions stack-actions no-print">
          <PrintButton
            label={t("complete.print")}
            className="btn btn-secondary row"
          />
          <Link href="/student" className="btn btn-primary">
            {t("complete.backToDashboard")}
            <span className="icon-flip">
              <ArrowIcon />
            </span>
          </Link>
        </div>

        <ScoreCard interviewId={interviewId} initial={report} />
      </div>
    </StudentAppShell>
  );
}
