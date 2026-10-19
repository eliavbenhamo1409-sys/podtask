import { getTranslations } from "next-intl/server";
import {
  BulbIcon,
  CheckIcon,
  ClockIcon,
  ListIcon,
  MessageIcon,
  ShieldIcon,
  SparkIcon,
} from "@/components/podtask/icons";
import { ReviewPanel } from "@/components/lecturer/review-panel";
import { IntegritySignals } from "@/components/lecturer/integrity-signals";
import { AnswerCards } from "@/components/lecturer/answer-cards";
import { buildExamModel } from "@/lib/lecturer/exam-integrity";
import type { LecturerInterviewReport } from "@/lib/lecturer/types";
import { isHostDirective } from "@/lib/realtime/host-directives";
import { formatTime } from "@/lib/utils";
import { ForestTabs } from "./tabs";
import { ForestTranscript } from "./transcript";
import { REVIEW_PILL } from "./util";

const LEVEL_KEY = {
  low: "complete.levelLow",
  medium: "complete.levelMedium",
  medium_high: "complete.levelMediumHigh",
  high: "complete.levelHigh",
} as const;

const DIMENSIONS = ["conceptual", "reasoning", "communication", "evidence"] as const;

interface ForestInterviewProps {
  data: LecturerInterviewReport;
  locale: string;
}

/**
 * Forest interview review: who and what on top; the answers, transcript and
 * integrity evidence in tabs; the automatic score and the lecturer's own
 * review in a panel beside them.
 */
export async function ForestInterview({ data, locale }: ForestInterviewProps) {
  const t = await getTranslations();
  const f = (key: string, values?: Record<string, string | number>) => t(`forestLecturer.${key}`, values);
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const report = data.report;
  const pill = REVIEW_PILL[data.review?.status ?? "unreviewed"];
  const exam = buildExamModel(data.events, data.interview);
  const toCheck = data.flags.filter((fl) => fl.confidence !== "low").length + exam.summary.reviewCount;
  const answered = new Set(
    data.messages
      .filter((m) => m.speaker === "student" && m.planQuestionId && !isHostDirective(m.content))
      .map((m) => m.planQuestionId),
  ).size;

  return (
    <div className="lxf-page lxf-page-review">
      <header className="lxf-head">
        <div className="lxf-head-text">
          <div className="lxf-title-row">
            <h1 className="lxf-title">{f("reviewPageTitle", { name: data.student.fullName })}</h1>
            <span className="lxf-pill" data-tone={pill.tone}>
              {pill.tone === "amber" ? (
                <ClockIcon size={15} strokeWidth={2} aria-hidden />
              ) : pill.tone === "ok" ? (
                <CheckIcon size={14} strokeWidth={2.4} aria-hidden />
              ) : null}
              {t(pill.key)}
            </span>
          </div>
          <p className="lxf-sub lxf-sub-strong">{data.assignment.title}</p>
          <ul className="lxf-meta lxf-meta-lg">
            <li>{data.assignment.courseName}</li>
            {data.interview.completedAt ? (
              <li>{f("completedOn", { date: dateFmt.format(new Date(data.interview.completedAt)) })}</li>
            ) : null}
            {data.interview.durationSeconds ? (
              <li>{f("lengthN", { time: formatTime(data.interview.durationSeconds) })}</li>
            ) : null}
            <li>{f("answeredN", { n: answered, total: data.questions.length })}</li>
          </ul>
        </div>
      </header>

      <div className="lxf-review-grid">
        <div className="lxf-review-main">
          {report && (report.summary || report.strengths.length || report.weaknesses.length) ? (
            <section className="lxf-card lxf-summary" aria-labelledby="lxf-summary-title">
              <h2 className="lxf-card-title" id="lxf-summary-title">
                {f("summaryTitle")}
              </h2>
              {report.summary ? <p className="lxf-summary-text">{report.summary}</p> : null}
              {report.strengths.length || report.weaknesses.length || report.recommendations.length ? (
                <div className="lxf-summary-cols">
                  {report.strengths.length ? (
                    <div>
                      <h3 className="lxf-mini-title">
                        <CheckIcon size={15} strokeWidth={2.4} aria-hidden /> {t("complete.strengthsTitle")}
                      </h3>
                      <ul className="lxf-list">
                        {report.strengths.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {report.weaknesses.length ? (
                    <div>
                      <h3 className="lxf-mini-title" data-tone="amber">
                        <BulbIcon size={16} strokeWidth={1.8} aria-hidden /> {t("complete.weaknessesTitle")}
                      </h3>
                      <ul className="lxf-list">
                        {report.weaknesses.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {report.recommendations.length ? (
                    <div>
                      <h3 className="lxf-mini-title">
                        <SparkIcon size={15} strokeWidth={1.8} aria-hidden /> {t("complete.recommendationsTitle")}
                      </h3>
                      <ul className="lxf-list">
                        {report.recommendations.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="lxf-card lxf-tabs-card">
            <ForestTabs
              label={f("tabsLabel")}
              tabs={[
                {
                  id: "answers",
                  label: f("tabAnswers"),
                  icon: <ListIcon size={19} strokeWidth={1.7} />,
                  content: (
                    <AnswerCards
                      questions={data.questions}
                      messages={data.messages}
                      evaluations={data.evaluations}
                      flags={data.flags}
                      locale={locale}
                    />
                  ),
                },
                {
                  id: "transcript",
                  label: f("tabTranscript"),
                  icon: <MessageIcon size={19} strokeWidth={1.7} />,
                  content: (
                    <ForestTranscript
                      questions={data.questions}
                      messages={data.messages}
                      events={data.events}
                      interview={{
                        startedAt: data.interview.startedAt,
                        completedAt: data.interview.completedAt,
                        language: data.interview.language,
                      }}
                      studentName={data.student.fullName}
                    />
                  ),
                },
                {
                  id: "integrity",
                  label: f("tabIntegrity"),
                  icon: <ShieldIcon size={19} strokeWidth={1.7} />,
                  count: toCheck,
                  content: (
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
                  ),
                },
              ]}
            />
          </section>
        </div>

        <aside className="lxf-review-aside">
          <section className="lxf-card lxf-grade" aria-labelledby="lxf-grade-title">
            <h2 className="lxf-card-title" id="lxf-grade-title">
              {f("gradeTitle")}
            </h2>
            {!report ? (
              <p className="lxf-grade-empty">{t("lecturer.noReport")}</p>
            ) : (
              <>
                <div className="lxf-auto">
                  <div className="lxf-auto-label">
                    <SparkIcon size={15} strokeWidth={1.8} aria-hidden />
                    {f("autoScore")}
                  </div>
                  <div className="lxf-auto-row">
                    <span className="lxf-auto-score">
                      {report.overallScore !== null ? (
                        <>
                          <bdi>{report.overallScore}</bdi>
                          <span className="lxf-auto-of">/ 100</span>
                        </>
                      ) : (
                        <span className="lxf-auto-of">–</span>
                      )}
                    </span>
                    {report.overallLevel ? (
                      <span className="lxf-auto-level">{t(LEVEL_KEY[report.overallLevel])}</span>
                    ) : null}
                  </div>
                  <p className="lxf-auto-note">{f("autoScoreNote")}</p>
                </div>
                {report.rubric ? (
                  <div className="lxf-criteria">
                    <h3 className="lxf-mini-title">{f("criteriaTitle")}</h3>
                    <ul>
                      {DIMENSIONS.map((k) => {
                        const v = report.rubric?.[k];
                        if (typeof v !== "number") return null;
                        return (
                          <li key={k}>
                            <span className="lxf-criteria-name">
                              {t(`complete.rubric${k.charAt(0).toUpperCase()}${k.slice(1)}`)}
                            </span>
                            <span className="lxf-criteria-bar" aria-hidden>
                              <i style={{ width: `${Math.round((v / 5) * 100)}%` }} />
                            </span>
                            <span className="lxf-criteria-value">
                              <bdi>{v}</bdi>
                              <span className="lxf-auto-of"> / 5</span>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </>
            )}
            <div className="lxf-grade-review">
              <ReviewPanel interviewId={data.interview.id} initial={data.review} />
            </div>
          </section>

          <section className="lxf-card lxf-details" aria-labelledby="lxf-details-title">
            <h2 className="lxf-card-title lxf-card-title-sm" id="lxf-details-title">
              {t("lecturer.details")}
            </h2>
            <dl className="lxf-dl lxf-dl-rows">
              <div>
                <dt>{t("lecturer.started")}</dt>
                <dd>
                  <bdi>{data.interview.startedAt ? dateFmt.format(new Date(data.interview.startedAt)) : "–"}</bdi>
                </dd>
              </div>
              <div>
                <dt>{t("lecturer.completedAt")}</dt>
                <dd>
                  <bdi>{data.interview.completedAt ? dateFmt.format(new Date(data.interview.completedAt)) : "–"}</bdi>
                </dd>
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
              <div>
                <dt>{f("email")}</dt>
                <dd>
                  <bdi>{data.student.email}</bdi>
                  {data.student.isGuest ? <span className="lxf-tag">{t("lecturer.guest")}</span> : null}
                </dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
