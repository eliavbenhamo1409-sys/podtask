import { getTranslations } from "next-intl/server";
import { Badge, Chip } from "@/components/podtask/chip";
import type { ReportEvaluation, ReportFlag, ReportMessage } from "@/lib/lecturer/types";
import { isHostDirective } from "@/lib/realtime/host-directives";

interface AnswerCardsProps {
  questions: { id: string; topic: string; question: string; kind: string | null }[];
  messages: ReportMessage[];
  evaluations: ReportEvaluation[];
  flags: ReportFlag[];
  locale: string;
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

const SCORE_KEYS = [
  "relevance",
  "accuracy",
  "explanation",
  "consistency",
  "process",
  "application",
] as const;

/**
 * One card per planned question: the question, what the student said, the
 * knowledge evaluation (scores, evidence, gaps) and, separately marked, any
 * review items that touch this question. Knowledge and integrity never mix
 * into one number.
 */
export async function AnswerCards({ questions, messages, evaluations, flags }: AnswerCardsProps) {
  const t = await getTranslations();
  const evalByQ = new Map(evaluations.map((e) => [e.questionId, e]));

  return (
    <div style={{ marginTop: 12 }}>
      {questions.map((q, i) => {
        const answers = messages.filter(
          (m) => m.planQuestionId === q.id && m.speaker === "student" && !isHostDirective(m.content),
        );
        const ev = evalByQ.get(q.id);
        const qFlags = flags.filter((f) => f.planQuestionId === q.id);
        const level = ev?.understandingLevel as keyof typeof LEVEL_KEY | null | undefined;
        return (
          <div key={q.id} className="lx-answer">
            <div className="between" style={{ flexWrap: "wrap", gap: 8 }}>
              <div>
                <div className="text-muted" style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em" }}>
                  {t("lecturer.questionN", { n: i + 1 })} · {q.topic}
                </div>
                <div style={{ fontWeight: 800, fontSize: 15, marginTop: 4 }}>{q.question || q.topic}</div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                {level && LEVEL_KEY[level] ? (
                  <Badge variant={LEVEL_BADGE[level]}>{t(LEVEL_KEY[level])}</Badge>
                ) : null}
                {qFlags.length ? <Badge variant="amber">{t("lecturer.flagsN", { n: qFlags.length })}</Badge> : null}
              </div>
            </div>

            {answers.length === 0 ? (
              <p className="text-muted" style={{ fontSize: 14, marginTop: 10 }}>{t("lecturer.noAnswer")}</p>
            ) : (
              <div style={{ marginTop: 10 }}>
                {answers.map((a) => {
                  const latency = typeof a.metadata.latency_ms === "number" ? a.metadata.latency_ms : null;
                  return (
                    <div key={a.id} className="lx-quote">
                      {a.content}
                      {latency !== null && latency >= 15_000 ? (
                        <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                          {t("lecturer.pauseBefore", { seconds: Math.round(latency / 1000) })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}

            {ev ? (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: "grid", gap: 6, maxWidth: 520 }}>
                  {SCORE_KEYS.map((k) => {
                    const v = ev.scores[k];
                    if (typeof v !== "number") return null;
                    return (
                      <div key={k} className="lx-score-row">
                        <span>{t(`lecturer.score_${k}`)}</span>
                        <div className="lx-bar">
                          <i style={{ width: `${Math.round((v / 5) * 100)}%` }} />
                        </div>
                        <span style={{ fontWeight: 700 }}>{v}</span>
                      </div>
                    );
                  })}
                </div>
                {ev.summary ? <p style={{ fontSize: 14, lineHeight: 1.6, margin: "10px 0 0" }}>{ev.summary}</p> : null}
                {ev.evidence.length ? (
                  <div style={{ marginTop: 8 }}>
                    <div className="text-muted" style={{ fontSize: 12, fontWeight: 700 }}>{t("lecturer.evidence")}</div>
                    <ul className="consent-list">
                      {ev.evidence.map((e) => <li key={e}>{e}</li>)}
                    </ul>
                  </div>
                ) : null}
                {ev.gaps.length ? (
                  <div style={{ marginTop: 8 }}>
                    <div className="text-muted" style={{ fontSize: 12, fontWeight: 700 }}>{t("lecturer.gaps")}</div>
                    <ul className="consent-list">
                      {ev.gaps.map((g) => <li key={g}>{g}</li>)}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : answers.length ? (
              <p className="text-muted" style={{ fontSize: 13, marginTop: 10 }}>{t("lecturer.evaluationNone")}</p>
            ) : null}

            {qFlags.length ? (
              <div style={{ marginTop: 12 }}>
                {qFlags.map((f) => (
                  <div key={f.id} className="row" style={{ gap: 8, fontSize: 13, flexWrap: "wrap", marginTop: 6 }}>
                    <Chip variant="pink">{t(`lecturer.cat_${f.category}`)}</Chip>
                    <span className="text-muted">
                      {f.source === "host_tool" ? t("lecturer.flagHost") : t("lecturer.flagServer")}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
