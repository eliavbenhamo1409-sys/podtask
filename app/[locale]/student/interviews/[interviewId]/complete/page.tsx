import { setRequestLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/lib/i18n/navigation";
import { StudentAppShell } from "@/components/student/student-app-shell";
import { Eyebrow } from "@/components/podtask/eyebrow";
import {
  ArrowIcon,
  CheckIcon,
  DownloadIcon,
} from "@/components/podtask/icons";
import {
  getInterviewWithAssignment,
  getReportForInterview,
  getStudentProfile,
} from "@/lib/student/student-service-server";
import { formatTime } from "@/lib/utils";
import { ScoreCard } from "./score-card";

interface CompletePageProps {
  params: Promise<{ locale: string; interviewId: string }>;
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
  const totalQuestions = data.interview.questions?.length || 10;

  return (
    <StudentAppShell>
      <div className="page-narrow" style={{ paddingTop: 60 }}>
        <div
          className="card-hero"
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
          <h1 className="display" style={{ fontSize: 42, marginTop: 16 }}>
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
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 24,
              }}
            >
              <div>
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
              <div>
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
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    marginTop: 4,
                    letterSpacing: "-0.02em",
                  }}
                >
                  {totalQuestions} / {totalQuestions}
                </div>
              </div>
              <div>
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
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    marginTop: 4,
                    letterSpacing: "-0.02em",
                  }}
                >
                  {t("complete.justNow")}
                </div>
              </div>
            </div>
          </div>

          <ScoreCard interviewId={interviewId} initial={report} />

          <div
            className="row"
            style={{ gap: 12, marginTop: 40, justifyContent: "center" }}
          >
            <button
              type="button"
              className="btn btn-secondary btn-lg row"
              style={{ gap: 8 }}
            >
              <DownloadIcon /> {t("complete.downloadConfirmation")}
            </button>
            <Link href="/student" style={{ textDecoration: "none" }}>
              <button type="button" className="btn btn-primary btn-lg">
                {t("complete.backToDashboard")}
                <span className="icon-flip">
                  <ArrowIcon />
                </span>
              </button>
            </Link>
          </div>

          <div
            className="text-muted"
            style={{ fontSize: 12, marginTop: 32 }}
          >
            {t("complete.copyEmailed")} {profile.email}
          </div>
        </div>
      </div>
    </StudentAppShell>
  );
}
