import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link } from "@/lib/i18n/navigation";
import { StudentAppShell } from "@/components/student/student-app-shell";
import { Eyebrow } from "@/components/podtask/eyebrow";
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
      <div className="page-narrow" style={{ paddingTop: 60 }}>
        <div
          className="card-hero card-pad-lg"
          style={{ padding: "56px 48px", textAlign: "center" }}
        >
          <div
            style={{
              position: "relative",
              width: 160,
              height: 160,
              margin: "0 auto 32px",
            }}
          >
            <ConfettiBurst />
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: "50%",
                background:
                  "radial-gradient(circle, rgba(125,211,252,0.4), transparent 70%)",
                filter: "blur(12px)",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: -12,
                borderRadius: "50%",
                border: "1px solid rgba(125,211,252,0.4)",
                animation: "pulse-ring 2.4s ease-out infinite",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: -12,
                borderRadius: "50%",
                border: "1px solid rgba(253,164,175,0.4)",
                animation: "pulse-ring 2.4s ease-out infinite 1.2s",
              }}
            />
            <div
              style={{
                position: "relative",
                width: 160,
                height: 160,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #38BDF8, #0EA5E9)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "white",
                boxShadow:
                  "0 24px 60px rgba(14,165,233,0.4), inset 0 4px 0 rgba(255,255,255,0.4)",
              }}
            >
              <CheckIcon size={64} />
            </div>
          </div>

          <Eyebrow showDot>{t("complete.sent")}</Eyebrow>
          <h1 className="display" style={{ marginTop: 16 }}>
            {t("complete.title")}
          </h1>
          <p
            className="subtitle"
            style={{ maxWidth: 480, margin: "0 auto" }}
          >
            {t("complete.subtitle")}
          </p>

          <div
            className="card"
            style={{
              marginTop: 40,
              padding: 24,
              background: "rgba(246,251,255,0.7)",
              boxShadow: "none",
              borderRadius: 24,
              textAlign: "center",
            }}
          >
            <div className="grid-stats-3">
              <div className="stat">
                <div
                  className="text-muted"
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.16em",
                  }}
                >
                  {t("complete.duration")}
                </div>
                <div
                  className="stat-value"
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    marginTop: 4,
                    letterSpacing: "-0.02em",
                  }}
                >
                  {formatTime(duration)}
                </div>
              </div>
              <div className="stat">
                <div
                  className="text-muted"
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.16em",
                  }}
                >
                  {t("complete.questions")}
                </div>
                <div
                  className="stat-value"
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    marginTop: 4,
                    letterSpacing: "-0.02em",
                  }}
                >
                  {totalQuestions > 0 ? totalQuestions : t("complete.questionsUnknown")}
                </div>
              </div>
              <div className="stat">
                <div
                  className="text-muted"
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.16em",
                  }}
                >
                  {t("complete.submitted")}
                </div>
                <div
                  className="stat-value"
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    marginTop: 4,
                    letterSpacing: "-0.02em",
                  }}
                >
                  <bdi>{completedAt}</bdi>
                </div>
              </div>
            </div>
          </div>

          <ScoreCard interviewId={interviewId} initial={report} />

          <div
            className="stack-actions no-print"
            style={{ marginTop: 40, justifyContent: "center" }}
          >
            <PrintButton label={t("complete.print")} />
            <Link href="/student" className="btn btn-primary btn-lg">
                {t("complete.backToDashboard")}
                <span className="icon-flip">
                  <ArrowIcon />
                </span>
              </Link>
          </div>

          <div
            className="text-muted"
            style={{ fontSize: 12, marginTop: 32 }}
          >
            {t("complete.copyEmailed")} <bdi>{profile.email}</bdi>
          </div>
        </div>
      </div>
    </StudentAppShell>
  );
}
