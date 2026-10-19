"use client";

import { useId, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/lib/i18n/navigation";
import { PrintButton } from "@/components/student/print-button";
import {
  ArrowIcon,
  BarChartIcon,
  CheckIcon,
  ClockIcon,
  LeafIcon,
  QuoteIcon,
} from "@/components/podtask/icons";
import type { StudentReport } from "@/lib/student/student-service-supabase";
import type { InterviewTranscript } from "@/lib/student/types";

/**
 * The forest theme's completion screen: a header with the assignment and
 * the actions, the automatic assessment in a side panel (score, criteria),
 * keep / strengthen cards, quotes the grading relied on, and the transcript
 * and recommendations as collapsible rows. Purely presentational: the
 * polling, transcript loading and disclosure state stay in ScoreCard.
 */

/** Header facts the server page already has (forest only). */
export interface ForestReportHead {
  assignmentTitle: string;
  /** mm:ss, or null when the duration was not recorded. */
  durationLabel: string | null;
  questionCount: number;
  dateLabel: string;
  /** A self-practice assignment: there is no lecturer to mention. */
  personal: boolean;
}

export interface ForestMoment {
  quote: string;
  questionNumber: number | null;
}

/** Rubric criteria are scored 0..5 by the grading engine. */
const RUBRIC_MAX = 5;
const MAX_MOMENTS = 2;

const CRITERIA = [
  { key: "conceptual", labelKey: "critConceptual" },
  { key: "reasoning", labelKey: "critReasoning" },
  { key: "communication", labelKey: "critCommunication" },
  { key: "evidence", labelKey: "critEvidence" },
] as const;

const LEVEL_KEYS = {
  low: "complete.levelLow",
  medium: "complete.levelMedium",
  medium_high: "complete.levelMediumHigh",
  high: "complete.levelHigh",
} as const;

const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Up to two verified quotes from the report (`evidence` holds verbatim
 * student words the grading relied on), each tied to the question it was
 * said in when the transcript has the line.
 */
export function pickMoments(
  report: StudentReport,
  transcript: InterviewTranscript | null,
): ForestMoment[] {
  const order = new Map<string, number>();
  transcript?.plan.forEach((q, i) => order.set(q.id, i + 1));
  return report.evidence.slice(0, MAX_MOMENTS).map((quote) => {
    const needle = normalize(quote);
    const line = transcript?.messages.find(
      (m) => m.speaker === "student" && normalize(m.content).includes(needle),
    );
    const n = line?.planQuestionId ? order.get(line.planQuestionId) : undefined;
    return { quote, questionNumber: n ?? null };
  });
}

/** True when the grading engine marked the report for a lecturer's look. */
function needsLecturerReview(report: StudentReport): boolean {
  const rubric = report.rubric as Record<string, unknown> | null;
  return rubric?.requires_human_review === true;
}

/**
 * Splits a feedback line into a lead sentence and the rest, so a two-part
 * item reads as a bold point with a muted explanation. A one-sentence item
 * stays whole.
 */
function splitLead(text: string): { lead: string; rest: string } {
  const m = /^(.+?[.!?])\s+(\S.*)$/s.exec(text.trim());
  if (!m || m[1].length < 12) return { lead: text.trim(), rest: "" };
  return { lead: m[1], rest: m[2] };
}

export function ForestReport({
  head,
  report,
  failed,
  timedOut,
  moments,
  more,
}: {
  head: ForestReportHead;
  /** The ready report, or null while it is being scored. */
  report: StudentReport | null;
  failed: boolean;
  timedOut: boolean;
  moments: ForestMoment[];
  /** Collapsible rows (transcript, recommendations). */
  more: ReactNode;
}) {
  const t = useTranslations("forestReport");
  const tc = useTranslations();
  const panelId = useId();
  const review = report ? !head.personal && needsLecturerReview(report) : false;

  const subtitle = report
    ? review
      ? t("subReadyReview")
      : head.personal
        ? t("subReadyPersonal")
        : t("subReady")
    : failed
      ? t("subSaved")
      : t("subScoring");

  return (
    <div className="fr-page">
      <header className="fr-head">
        <div className="fr-head-text">
          <div className="fr-title-row">
            <span className="fr-check" aria-hidden>
              <CheckIcon size={20} />
            </span>
            <h1 className="fr-title">{t("title")}</h1>
          </div>
          <p className="fr-sub">{subtitle}</p>
          <p className="fr-assignment">
            <bdi>{head.assignmentTitle}</bdi>
          </p>
          <ul className="fr-meta">
            {head.durationLabel && (
              <li>
                <bdi>{t("metaDuration", { time: head.durationLabel })}</bdi>
              </li>
            )}
            {head.questionCount > 0 && (
              <li>{t("metaQuestions", { count: head.questionCount })}</li>
            )}
            <li>
              <bdi>{head.dateLabel}</bdi>
            </li>
          </ul>
        </div>
        <div className="fr-actions no-print">
          <Link href="/student" className="btn btn-primary">
            {tc("complete.backToDashboard")}
            <span className="icon-flip">
              <ArrowIcon />
            </span>
          </Link>
          <PrintButton label={tc("complete.print")} className="btn btn-secondary row" />
        </div>
      </header>

      <aside className="card fr-panel" aria-labelledby={panelId}>
        <div className="fr-card-head">
          <span className="fr-card-icon" aria-hidden>
            <BarChartIcon size={22} />
          </span>
          <h2 className="fr-card-title" id={panelId}>
            {t("panelTitle")}
          </h2>
        </div>
        {report ? (
          <ScorePanel report={report} review={review} />
        ) : (
          <ForestScoring timedOut={timedOut} failed={failed} personal={head.personal} />
        )}
      </aside>

      <div className="fr-main">
        {report ? (
          <>
            {report.summary && (
              <section className="fr-summary">
                <h2 className="fr-summary-label">{t("summary")}</h2>
                <p dir="auto">{report.summary}</p>
              </section>
            )}
            <FeedbackCard
              tone="keep"
              icon={<LeafIcon size={22} />}
              title={t("strengths")}
              items={report.strengths}
            />
            <FeedbackCard
              tone="improve"
              icon={<BarChartIcon size={22} />}
              title={t("improve")}
              items={report.weaknesses}
            />
          </>
        ) : (
          !failed && !timedOut && <p className="card fr-wait">{t("waitNote")}</p>
        )}
      </div>

      <section className="card fr-more">
        {moments.length > 0 && (
          <div className="fr-moments">
            <div className="fr-card-head">
              <span className="fr-card-icon" aria-hidden>
                <QuoteIcon size={22} />
              </span>
              <div>
                <h2 className="fr-card-title">{t("moments")}</h2>
                <p className="fr-card-sub">{t("momentsSub")}</p>
              </div>
            </div>
            <ul className="fr-quotes">
              {moments.map((m, i) => (
                <li key={`${i}-${m.quote.slice(0, 12)}`} className="fr-quote">
                  <q dir="auto">{m.quote}</q>
                  {m.questionNumber !== null && (
                    <span className="fr-quote-meta">
                      {t("momentQuestion", { n: m.questionNumber })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {more}
      </section>
    </div>
  );
}

function ScorePanel({ report, review }: { report: StudentReport; review: boolean }) {
  const t = useTranslations("forestReport");
  const tc = useTranslations();
  const score =
    typeof report.overallScore === "number" ? Math.round(report.overallScore) : null;
  const level = report.overallLevel;

  return (
    <>
      {review && (
        <span className="fr-pending">
          <ClockIcon size={15} />
          {t("pendingReview")}
        </span>
      )}
      <div className="fr-score">
        <span className="fr-score-value" dir="ltr" aria-hidden>
          <span className="fr-score-num">{score ?? "—"}</span>
          <span className="fr-score-of">/ 100</span>
        </span>
        {score !== null && (
          <span className="sr-only">{`${score} ${tc("complete.outOf100")}`}</span>
        )}
        {level && <span className="fr-level">{tc(LEVEL_KEYS[level])}</span>}
      </div>

      {report.rubric && (
        <ul className="fr-criteria">
          {CRITERIA.map(({ key, labelKey }) => {
            const val = report.rubric?.[key];
            const has = typeof val === "number";
            return (
              <li key={key}>
                <div className="fr-crit-row">
                  <span className="fr-crit-name">{t(labelKey)}</span>
                  <span className="fr-crit-val" dir="ltr">
                    <b>{has ? val.toFixed(1) : "—"}</b>
                    {has && <span> / {RUBRIC_MAX}</span>}
                  </span>
                </div>
                <div
                  className="fr-bar"
                  role="meter"
                  aria-valuemin={0}
                  aria-valuemax={RUBRIC_MAX}
                  aria-valuenow={has ? val : undefined}
                  aria-label={t(labelKey)}
                >
                  <span
                    style={{
                      width: has
                        ? `${Math.max(0, Math.min(100, (val / RUBRIC_MAX) * 100))}%`
                        : "0%",
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function FeedbackCard({
  tone,
  icon,
  title,
  items,
}: {
  tone: "keep" | "improve";
  icon: ReactNode;
  title: string;
  items: string[];
}) {
  if (items.length === 0) return null;
  // A bold point with a muted line only when every item has both parts, so
  // one card never mixes the two styles.
  const parts = items.map(splitLead);
  const twoPart = parts.every((p) => p.rest);
  return (
    <section className="card fr-list" data-tone={tone}>
      <div className="fr-card-head">
        <span className="fr-card-icon" aria-hidden>
          {icon}
        </span>
        <h2 className="fr-card-title">{title}</h2>
      </div>
      <ul className="fr-items" data-two-part={twoPart}>
        {items.map((item, i) => (
          <li key={`${i}-${item.slice(0, 12)}`} dir="auto">
            {twoPart ? (
              <>
                <span className="fr-item-lead">{parts[i].lead}</span>
                <span className="fr-item-rest">{parts[i].rest}</span>
              </>
            ) : (
              <span className="fr-item-text">{item}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The panel while the report is being scored: an honest wait state (the
 * grading call is one opaque request, so no staged checkmarks).
 */
function ForestScoring({
  timedOut,
  failed,
  personal,
}: {
  timedOut: boolean;
  failed: boolean;
  personal: boolean;
}) {
  const t = useTranslations("forestReport");
  const tc = useTranslations();
  return (
    <div className="fr-scoring" aria-live="polite">
      <p className="fr-status">
        <span className="fr-dot" data-tone={failed ? "amber" : "grey"} aria-hidden />
        {failed ? t("failedTitle") : t("scoringTitle")}
      </p>
      {!failed && (
        <div className="fr-indeterminate" aria-hidden>
          <span />
        </div>
      )}
      <p className="fr-scoring-body">
        {failed
          ? personal
            ? t("failedPersonal")
            : t("failedBody")
          : timedOut
            ? tc("complete.scoringSlow")
            : t("scoringBody")}
      </p>
      {timedOut && (
        <button
          type="button"
          className="btn btn-secondary fr-refresh"
          onClick={() => window.location.reload()}
        >
          {tc("complete.refresh")}
        </button>
      )}
    </div>
  );
}
