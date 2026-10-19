import { getTranslations } from "next-intl/server";
import { Link } from "@/lib/i18n/navigation";
import { JourneySteps } from "@/components/student/journey-steps";
import {
  ArrowIcon,
  BookIcon,
  CheckIcon,
  ClockIcon,
  FileTextIcon,
  InfoIcon,
  ListIcon,
  MessageIcon,
  QuestionIcon,
  VolumeIcon,
} from "@/components/podtask/icons";
import { SUBMISSION_STATUS } from "@/lib/student/status";
import type {
  StudentAssignment,
  StudentInterview,
  StudentSubmission,
} from "@/lib/student/types";
import { formatBytes } from "@/lib/utils";
import { InterviewLanguagePicker } from "./interview-language-picker";

interface ForestLobbyProps {
  locale: string;
  submission: StudentSubmission;
  assignment: StudentAssignment;
  interview: StudentInterview;
  /** Plan topics, else the assignment's own topics; never demo strings. */
  topics: string[];
  nextHref: string;
}

/** How far `submissions.status` has come, in pipeline order. */
function stageIndex(status: StudentSubmission["status"]): number {
  return SUBMISSION_STATUS.indexOf(status);
}

/**
 * Forest skin of the lobby: the document and its readiness on one side, the
 * conversation language and a few tips on the other, one action bar below.
 * Every check row is derived from the submission status; nothing is assumed.
 */
export async function ForestLobby({
  locale,
  submission,
  assignment,
  interview,
  topics,
  nextHref,
}: ForestLobbyProps) {
  const t = await getTranslations("forestPrep");

  const failed = submission.status === "failed";
  const at = stageIndex(submission.status);
  const checks = [
    { key: "checkText", done: !failed && at >= stageIndex("parsed") },
    { key: "checkTopics", done: !failed && at >= stageIndex("analysis_ready") },
    {
      key: "checkPlan",
      done: !failed && at >= stageIndex("interview_ready") && Boolean(interview.id),
    },
  ] as const;
  const allDone = checks.every((c) => c.done);
  const lead = failed ? "failed" : allDone ? "ready" : "processing";

  const uploaded = submission.submittedAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: "short" }).format(
        new Date(submission.submittedAt),
      )
    : null;
  const questionCount = interview.questions.length;
  const minutes = assignment.estimatedInterviewMinutes;

  const tips = [
    { icon: <VolumeIcon size={22} />, title: "tipQuietTitle", body: "tipQuietBody" },
    { icon: <MessageIcon size={22} />, title: "tipThinkTitle", body: "tipThinkBody" },
    { icon: <BookIcon size={22} />, title: "tipOwnWordsTitle", body: "tipOwnWordsBody" },
    { icon: <QuestionIcon size={22} />, title: "tipStuckTitle", body: "tipStuckBody" },
  ] as const;

  return (
    <div className="page fp-page fp-lobby">
      <header className="fp-head">
        <div className="fp-head-text">
          <h1 className="fp-title">{t("lobbyTitle")}</h1>
          <p className="fp-sub">{t("lobbySubtitle")}</p>
        </div>
        <JourneySteps stage="prepare" className="fp-steps" />
      </header>

      <div className="fp-grid">
        <section className="card fp-card" aria-labelledby="fp-doc-title">
          <h2 className="fp-card-title" id="fp-doc-title">
            {t("docTitle")}
          </h2>
          <p className="fp-card-sub">
            <bdi>{assignment.title}</bdi>
            {assignment.courseName ? (
              <>
                {" · "}
                <bdi>{assignment.courseName}</bdi>
              </>
            ) : null}
          </p>

          <div className="fp-doc">
            <div className="fp-file">
              <span className="fp-row-icon">
                <FileTextIcon size={24} />
              </span>
              <div className="fp-row-text">
                <bdi className="fp-file-name" dir="auto">
                  {submission.originalFilename}
                </bdi>
                <span className="fp-row-sub">
                  {submission.fileSizeBytes > 0 ? (
                    <bdi>{formatBytes(submission.fileSizeBytes)}</bdi>
                  ) : null}
                  {submission.fileSizeBytes > 0 && uploaded ? " · " : null}
                  {uploaded ? t("uploadedOn", { date: uploaded }) : null}
                </span>
              </div>
            </div>

            <ul className="fp-checks">
              <li className={`fp-check fp-check-lead is-${lead}`}>
                <span className="fp-check-mark" aria-hidden="true">
                  {lead === "ready" ? <CheckIcon size={14} /> : null}
                </span>
                <span className="fp-row-text">
                  <strong>
                    {lead === "ready"
                      ? t("docReady")
                      : lead === "failed"
                        ? t("docFailed")
                        : t("docProcessing")}
                  </strong>
                  <span className="fp-row-sub">
                    {lead === "ready"
                      ? t("docReadyBody")
                      : lead === "failed"
                        ? t("docFailedBody")
                        : t("docProcessingBody")}
                  </span>
                </span>
              </li>
              {checks.map((c) => (
                <li key={c.key} className={`fp-check ${c.done ? "is-ready" : "is-pending"}`}>
                  <span className="fp-check-mark" aria-hidden="true">
                    {c.done ? <CheckIcon size={13} /> : null}
                  </span>
                  <span>
                    {t(c.key)}
                    <span className="sr-only">
                      {", "}
                      {c.done
                        ? t("checkStateDone")
                        : failed
                          ? t("checkStateWarn")
                          : t("checkStatePending")}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <hr className="fp-rule" />

          <h2 className="fp-card-title">{t("topicsTitle")}</h2>
          {topics.length > 0 ? (
            <>
              <p className="fp-card-sub">{t("topicsSubtitle")}</p>
              <ul className="fp-list">
                {topics.map((topic) => (
                  <li key={topic} className="fp-list-row">
                    <span className="fp-row-icon">
                      <FileTextIcon size={22} />
                    </span>
                    <bdi className="fp-list-title" dir="auto">
                      {topic}
                    </bdi>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="fp-card-sub">{t("topicsEmpty")}</p>
          )}
          {questionCount > 0 || minutes > 0 ? (
            <div className="fp-meta">
              {questionCount > 0 ? (
                <span className="fp-meta-item">
                  <ListIcon size={20} />
                  {t("questionsCount", { count: questionCount })}
                </span>
              ) : null}
              {questionCount > 0 && minutes > 0 ? (
                <span className="fp-meta-sep" aria-hidden="true">
                  ·
                </span>
              ) : null}
              {minutes > 0 ? (
                <span className="fp-meta-item">
                  <ClockIcon size={19} />
                  {t("minutesApprox", { minutes })}
                </span>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="card fp-card" aria-labelledby="fp-before-title">
          <h2 className="fp-card-title" id="fp-before-title">
            {t("beforeTitle")}
          </h2>
          <p className="fp-card-sub">{t("beforeSubtitle")}</p>

          {interview.id ? (
            <InterviewLanguagePicker interviewId={interview.id} initial={interview.language} />
          ) : null}

          <hr className="fp-rule" />

          <h3 className="fp-section-title">{t("tipsTitle")}</h3>
          <ul className="fp-list">
            {tips.map((tip) => (
              <li key={tip.title} className="fp-list-row">
                <span className="fp-row-icon">{tip.icon}</span>
                <span className="fp-row-text">
                  <span className="fp-list-title">{t(tip.title)}</span>
                  <span className="fp-row-sub">{t(tip.body)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="card fp-actionbar">
        <p className="fp-actionbar-note">
          <InfoIcon size={20} />
          <span>{t("lobbyFooterNote")}</span>
        </p>
        <div className="fp-actionbar-btns">
          <Link href="/student" className="btn btn-secondary">
            {t("toDashboard")}
          </Link>
          <Link href={nextHref} className="btn btn-primary">
            {t("continue")}
            <span className="icon-flip">
              <ArrowIcon size={18} />
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
