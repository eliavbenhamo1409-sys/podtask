import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link } from "@/lib/i18n/navigation";
import { LecturerShell } from "@/components/lecturer/lecturer-shell";
import { Badge, Chip } from "@/components/podtask/chip";
import { Eyebrow } from "@/components/podtask/eyebrow";
import { BackIcon } from "@/components/podtask/icons";
import { ReviewPanel } from "@/components/lecturer/review-panel";
import { IntegritySignals } from "@/components/lecturer/integrity-signals";
import { AnswerCards } from "@/components/lecturer/answer-cards";
import { TranscriptView } from "@/components/lecturer/transcript-view";
import {
  getLecturerInterviewReport,
  getLecturerProfile,
} from "@/lib/lecturer/lecturer-service-server";
import { formatTime } from "@/lib/utils";

interface PageProps {
  params: Promise<{ locale: string; interviewId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale });
  return { title: t("lecturer.reportTitle") };
}

const LEVEL_KEY = {
  low: "complete.levelLow",
  medium: "complete.levelMedium",
  medium_high: "complete.levelMediumHigh",
  high: "complete.levelHigh",
} as const;

const LEVEL_BADGE = {
  low: "pink",
  medium: "amber",
  medium_high: "cyan",
  high: "mint",
} as const;

export default async function LecturerInterviewPage({ params }: PageProps) {
  const { locale, interviewId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  const [profile, data] = await Promise.all([
    getLecturerProfile(),
    getLecturerInterviewReport(interviewId),
  ]);
  if (!data) notFound();
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const report = data.report;

  return (
    <LecturerShell initial={profile?.avatarInitial}>
      <div className="page">
        <Link href={`/lecturer/assignments/${data.assignment.id}`} className="btn btn-ghost row" style={{ padding: "8px 0", gap: 8 }}>
          <span className="icon-flip">
            <BackIcon />
          </span>
          {t("lecturer.backToAssignment")}
        </Link>

        <div className="between" style={{ flexWrap: "wrap", gap: 16, marginTop: 16, alignItems: "flex-end" }}>
          <div>
            <Eyebrow showDot>
              {data.assignment.courseName} · {data.assignment.title}
            </Eyebrow>
            <h1 className="display" style={{ marginTop: 10 }}>
              {data.student.fullName}
            </h1>
            <div className="text-muted" style={{ fontSize: 14, marginTop: 4 }}>
              <bdi>{data.student.email}</bdi>
              {data.student.isGuest ? (
                <>
                  {" "}
                  <Chip>{t("lecturer.guest")}</Chip>
                </>
              ) : null}
            </div>
          </div>
          {report?.overallScore !== null && report?.overallScore !== undefined ? (
            <div className="lx-stat" style={{ minWidth: 180 }}>
              <div className="lx-stat-value">
                {report.overallScore}
                <span className="text-muted" style={{ fontSize: 14, fontWeight: 600 }}> / 100</span>
              </div>
              <div className="lx-stat-label">
                {report.overallLevel ? t(LEVEL_KEY[report.overallLevel]) : t("lecturer.score")}
              </div>
            </div>
          ) : null}
        </div>

        {/* Interview details */}
        <div className="card" style={{ padding: 24, marginTop: 24 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{t("lecturer.details")}</div>
          <dl className="report-meta" style={{ marginTop: 12 }}>
            <div>
              <dt>{t("lecturer.started")}</dt>
              <dd><bdi>{data.interview.startedAt ? dateFmt.format(new Date(data.interview.startedAt)) : "–"}</bdi></dd>
            </div>
            <div>
              <dt>{t("lecturer.completedAt")}</dt>
              <dd><bdi>{data.interview.completedAt ? dateFmt.format(new Date(data.interview.completedAt)) : "–"}</bdi></dd>
            </div>
            <div>
              <dt>{t("lecturer.durationLabel")}</dt>
              <dd>{data.interview.durationSeconds ? formatTime(data.interview.durationSeconds) : "–"}</dd>
            </div>
            <div>
              <dt>{t("lecturer.attempts")}</dt>
              <dd>{data.interview.attempts}</dd>
            </div>
            <div>
              <dt>{t("lecturer.consent")}</dt>
              <dd>
                {data.consent ? (
                  <bdi>{dateFmt.format(new Date(data.consent.acceptedAt))}</bdi>
                ) : (
                  t("lecturer.consentNone")
                )}
              </dd>
            </div>
          </dl>
        </div>

        {/* Score + rubric */}
        <div className="card" style={{ padding: 24, marginTop: 20 }}>
          <div className="between" style={{ flexWrap: "wrap", gap: 10 }}>
            <div style={{ fontWeight: 800, fontSize: 15 }}>{t("lecturer.score")}</div>
            {report?.overallLevel ? (
              <Badge variant={LEVEL_BADGE[report.overallLevel]}>{t(LEVEL_KEY[report.overallLevel])}</Badge>
            ) : null}
          </div>
          {!report ? (
            <p className="text-muted" style={{ marginTop: 10 }}>{t("lecturer.noReport")}</p>
          ) : (
            <>
              {report.summary ? <p style={{ lineHeight: 1.7, marginTop: 12 }}>{report.summary}</p> : null}
              {report.rubric ? (
                <div style={{ display: "grid", gap: 8, marginTop: 14, maxWidth: 520 }}>
                  {(["conceptual", "reasoning", "communication", "evidence"] as const).map((k) => {
                    const v = report.rubric?.[k];
                    if (typeof v !== "number") return null;
                    return (
                      <div key={k} className="lx-score-row">
                        <span>{t(`complete.rubric${k.charAt(0).toUpperCase()}${k.slice(1)}`)}</span>
                        <div className="lx-bar">
                          <i style={{ width: `${Math.round((v / 5) * 100)}%` }} />
                        </div>
                        <span style={{ fontWeight: 700 }}>{v}</span>
                      </div>
                    );
                  })}
                </div>
              ) : null}
              {report.strengths.length || report.weaknesses.length ? (
                <div className="grid-split-even" style={{ marginTop: 16, gap: 16 }}>
                  {report.strengths.length ? (
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 13 }}>{t("complete.strengthsTitle")}</div>
                      <ul className="consent-list">
                        {report.strengths.map((s) => <li key={s}>{s}</li>)}
                      </ul>
                    </div>
                  ) : null}
                  {report.weaknesses.length ? (
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 13 }}>{t("complete.weaknessesTitle")}</div>
                      <ul className="consent-list">
                        {report.weaknesses.map((s) => <li key={s}>{s}</li>)}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* Per-question answers + knowledge evaluation */}
        <h2 className="title" style={{ marginTop: 32 }}>{t("lecturer.answersTitle")}</h2>
        <AnswerCards
          questions={data.questions}
          messages={data.messages}
          evaluations={data.evaluations}
          flags={data.flags}
          locale={locale}
        />

        {/* Integrity signals */}
        <h2 className="title" style={{ marginTop: 32 }}>{t("lecturer.signalsTitle")}</h2>
        <IntegritySignals
          flags={data.flags}
          events={data.events}
          questions={data.questions}
          messages={data.messages}
          interview={{ startedAt: data.interview.startedAt, completedAt: data.interview.completedAt }}
          summary={data.interview.integritySummary}
          integrity={data.assignment.integrity}
          isGuest={data.student.isGuest}
          locale={locale}
        />

        {/* Transcript */}
        <h2 className="title" style={{ marginTop: 32 }}>{t("lecturer.transcriptTitle")}</h2>
        <TranscriptView questions={data.questions} messages={data.messages} language={data.interview.language} />

        {/* Review */}
        <div style={{ marginTop: 32 }}>
          <ReviewPanel interviewId={data.interview.id} initial={data.review} />
        </div>
      </div>
    </LecturerShell>
  );
}
