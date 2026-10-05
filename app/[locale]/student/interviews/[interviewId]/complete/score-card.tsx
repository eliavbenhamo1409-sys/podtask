"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Badge } from "@/components/podtask/chip";
import { Eyebrow } from "@/components/podtask/eyebrow";
import { GlowOrb } from "@/components/podtask/glow-orb";
import { Steps } from "@/components/podtask/steps";
import { SparkIcon } from "@/components/podtask/icons";
import {
  getInterviewTranscript,
  getReportForInterview,
} from "@/lib/student/student-service";
import type { InterviewTranscript } from "@/lib/student/types";

type ReportShape = Awaited<ReturnType<typeof getReportForInterview>>;

interface ScoreCardProps {
  interviewId: string;
  initial: ReportShape | null;
}

const POLL_INTERVAL_MS = 1500;
const MAX_POLL_MS = 180_000;

// The scoring call is a single opaque request (~30-60 s), so the progress
// shown while waiting is time-based: it walks through the real stages of
// the pipeline and parks on the last one until the report lands.
const SCORING_STEP_KEYS = [
  "complete.scoringStep1",
  "complete.scoringStep2",
  "complete.scoringStep3",
  "complete.scoringStep4",
] as const;
const SCORING_LABEL_KEYS = [
  "complete.scoringLabel1",
  "complete.scoringLabel2",
  "complete.scoringLabel3",
  "complete.scoringLabel4",
] as const;
const SCORING_STEP_MS = 2600;

function ScoringProgress({ timedOut }: { timedOut: boolean }) {
  const t = useTranslations();
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = window.setInterval(
      () => setStep((s) => Math.min(s + 1, SCORING_STEP_KEYS.length - 1)),
      SCORING_STEP_MS,
    );
    return () => window.clearInterval(id);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="card"
      style={{
        marginTop: 32,
        padding: "32px 32px 28px",
        textAlign: "center",
        background: "rgba(246,251,255,0.7)",
        borderRadius: 24,
        boxShadow: "none",
      }}
    >
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
        <GlowOrb size={88} state="thinking" float />
      </div>
      <div style={{ fontSize: 18, fontWeight: 800 }}>{t("complete.scoring")}</div>
      <div style={{ minHeight: 24, marginTop: 8 }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className="text-muted"
            style={{ fontSize: 14, fontWeight: 600 }}
            aria-live="polite"
          >
            {t(SCORING_STEP_KEYS[step])}
          </motion.div>
        </AnimatePresence>
      </div>
      <Steps
        current={step}
        items={SCORING_LABEL_KEYS.map((k) => t(k))}
        className="mt-6"
      />
      <div
        className="text-muted"
        style={{ fontSize: 12, marginTop: 18, lineHeight: 1.6 }}
      >
        {timedOut ? t("complete.scoringSlow") : t("complete.scoringHint")}
      </div>
      {timedOut && (
        <button
          type="button"
          className="btn btn-secondary"
          style={{ marginTop: 14 }}
          onClick={() => window.location.reload()}
        >
          {t("complete.refresh")}
        </button>
      )}
    </motion.div>
  );
}

const LEVEL_KEYS = {
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

/** Rubric criteria are scored 0..5 by generate-report. */
const RUBRIC_MAX = 5;

/** Counts from 0 to `value` once on mount; static when motion is reduced. */
function CountUp({ value }: { value: number }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (reduce) return;
    let raf = 0;
    const start = performance.now();
    const duration = 1100;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(value * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, reduce]);
  return <>{reduce ? value : shown}</>;
}

const RUBRIC_KEYS: Array<{ key: keyof NonNullable<NonNullable<ReportShape>["rubric"]>; labelKey: string }> = [
  { key: "conceptual", labelKey: "complete.rubricConceptual" },
  { key: "reasoning", labelKey: "complete.rubricReasoning" },
  { key: "communication", labelKey: "complete.rubricCommunication" },
  { key: "evidence", labelKey: "complete.rubricEvidence" },
];

export function ScoreCard({ interviewId, initial }: ScoreCardProps) {
  const t = useTranslations();
  const locale = useLocale();
  const [report, setReport] = useState<ReportShape>(initial);
  const [transcript, setTranscript] = useState<InterviewTranscript | null>(
    null,
  );
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (report && report.status === "ready") return;
    let cancelled = false;
    const start = Date.now();
    const tick = async () => {
      while (!cancelled) {
        try {
          const next = await getReportForInterview(interviewId);
          if (cancelled) return;
          if (next) setReport(next);
          if (next && next.status === "ready") return;
        } catch {
          // Swallow transient errors; we'll retry on the next tick.
        }
        if (Date.now() - start > MAX_POLL_MS) {
          if (!cancelled) setTimedOut(true);
          return;
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [interviewId, report]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const tx = await getInterviewTranscript(interviewId);
        if (!cancelled) setTranscript(tx);
      } catch {
        if (!cancelled) setTranscript({ messages: [], plan: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [interviewId]);

  if (!report || report.status !== "ready") {
    return <ScoringProgress timedOut={timedOut} />;
  }

  const level = report.overallLevel ?? "medium";
  const levelKey = LEVEL_KEYS[level as keyof typeof LEVEL_KEYS] ?? LEVEL_KEYS.medium;
  const score = typeof report.overallScore === "number"
    ? Math.round(report.overallScore)
    : null;

  return (
    <AnimatePresence>
      <motion.div
        key={report.id}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        style={{ marginTop: 32 }}
      >
        <div
          className="card-hero card-pad"
          style={{ padding: "32px 36px", borderRadius: 28, textAlign: "start" }}
        >
          <div className="between" style={{ alignItems: "flex-start" }}>
            <Eyebrow icon={<SparkIcon size={14} />}>
              {t("complete.scoreLabel")}
            </Eyebrow>
            <Badge variant={LEVEL_BADGE[level as keyof typeof LEVEL_BADGE] ?? "neutral"} showDot>
              {t(levelKey)}
            </Badge>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 14,
              marginTop: 18,
            }}
            aria-label={score !== null ? `${score} ${t("complete.outOf100")}` : undefined}
          >
            <div
              aria-hidden
              style={{
                fontSize: 72,
                fontWeight: 800,
                letterSpacing: "-0.04em",
                lineHeight: 1,
                background: "linear-gradient(135deg, #38BDF8, #0EA5E9)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {score !== null ? <CountUp value={score} /> : "—"}
            </div>
            <div
              className="text-muted"
              style={{ fontSize: 14, fontWeight: 600 }}
            >
              {t("complete.outOf100")}
            </div>
          </div>

          {report.summary && (
            <div style={{ marginTop: 24 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: "0.2em",
                  color: "rgb(var(--ink-2))",
                  marginBottom: 8,
                }}
              >
                {t("complete.summaryTitle")}
              </div>
              <p
                style={{
                  fontSize: 15,
                  lineHeight: 1.7,
                  color: "rgb(var(--ink))",
                }}
              >
                {report.summary}
              </p>
            </div>
          )}

          {report.rubric && (
            <div
              className="grid-stats-4"
              style={{
                marginTop: 24,
                padding: "16px 20px",
                background: "rgba(246,251,255,0.7)",
                borderRadius: 16,
              }}
            >
              {RUBRIC_KEYS.map(({ key, labelKey }) => {
                const val = report.rubric?.[key];
                return (
                  <div key={key}>
                    <div
                      className="text-muted"
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.18em",
                      }}
                    >
                      {t(labelKey)}
                    </div>
                    <div
                      style={{
                        fontSize: 22,
                        fontWeight: 800,
                        marginTop: 4,
                        letterSpacing: "-0.02em",
                      }}
                    >
                      {typeof val === "number" ? val.toFixed(1) : "—"}
                      {typeof val === "number" && (
                        <span
                          className="text-muted"
                          style={{ fontSize: 12, fontWeight: 600, marginInlineStart: 4 }}
                        >
                          / {RUBRIC_MAX}
                        </span>
                      )}
                    </div>
                    <div
                      className="meter"
                      role="meter"
                      aria-valuemin={0}
                      aria-valuemax={RUBRIC_MAX}
                      aria-valuenow={typeof val === "number" ? val : undefined}
                      aria-label={t(labelKey)}
                    >
                      <span
                        style={{
                          width:
                            typeof val === "number"
                              ? `${Math.max(0, Math.min(100, (val / RUBRIC_MAX) * 100))}%`
                              : "0%",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="grid-feedback" style={{ marginTop: 28 }}>
            <FeedbackColumn
              titleKey="complete.strengthsTitle"
              tone="cyan"
              items={report.strengths}
              t={t}
            />
            <FeedbackColumn
              titleKey="complete.weaknessesTitle"
              tone="pink"
              items={report.weaknesses}
              t={t}
            />
            <FeedbackColumn
              titleKey="complete.recommendationsTitle"
              tone="neutral"
              items={report.recommendations}
              t={t}
            />
          </div>
        </div>

        {transcript ? (
          <TranscriptSection
            transcript={transcript}
            t={t}
            locale={locale}
          />
        ) : null}
      </motion.div>
    </AnimatePresence>
  );
}

interface TranscriptGroup {
  planQuestionId: string | null;
  topic: string;
  question: string;
  index: number | null;
  messages: { speaker: "ai_host" | "student" | "system"; content: string }[];
}

function groupTranscript(transcript: InterviewTranscript): TranscriptGroup[] {
  const planIndex = new Map<string, { index: number; topic: string; question: string }>();
  transcript.plan.forEach((q, i) => {
    planIndex.set(q.id, { index: i, topic: q.topic, question: q.question });
  });

  const groups = new Map<string, TranscriptGroup>();
  const order: string[] = [];

  for (const m of transcript.messages) {
    const key = m.planQuestionId ?? "__unanchored__";
    if (!groups.has(key)) {
      const meta = m.planQuestionId ? planIndex.get(m.planQuestionId) : null;
      groups.set(key, {
        planQuestionId: m.planQuestionId,
        topic: meta?.topic ?? "",
        question: meta?.question ?? "",
        index: meta?.index ?? null,
        messages: [],
      });
      order.push(key);
    }
    groups.get(key)!.messages.push({ speaker: m.speaker, content: m.content });
  }

  // Reorder so groups that match a plan question come first in plan order,
  // then any unanchored / unknown-id groups in arrival order.
  const anchored = order
    .filter((k) => groups.get(k)?.index !== null)
    .sort(
      (a, b) =>
        (groups.get(a)!.index as number) - (groups.get(b)!.index as number),
    );
  const unanchored = order.filter((k) => groups.get(k)?.index === null);
  return [...anchored, ...unanchored].map((k) => groups.get(k)!);
}

function TranscriptSection({
  transcript,
  t,
  locale,
}: {
  transcript: InterviewTranscript;
  t: ReturnType<typeof useTranslations>;
  locale: string;
}) {
  const groups = groupTranscript(transcript).filter((g) => g.messages.length > 0);
  const dir = locale === "he" ? "rtl" : "ltr";

  return (
    <div
      className="card"
      style={{
        marginTop: 28,
        padding: "28px 32px",
        borderRadius: 24,
        background: "rgba(255,255,255,0.94)",
      }}
      dir={dir}
    >
      <Eyebrow icon={<SparkIcon size={14} />}>
        {t("complete.transcriptTitle")}
      </Eyebrow>

      {groups.length === 0 ? (
        <div
          className="text-muted"
          style={{ marginTop: 18, fontSize: 14, lineHeight: 1.7 }}
        >
          {t("complete.transcriptEmpty")}
        </div>
      ) : (
        <div
          style={{
            marginTop: 22,
            display: "flex",
            flexDirection: "column",
            gap: 28,
          }}
        >
          {groups.map((g, gi) => (
            <TranscriptGroupBlock
              key={`${g.planQuestionId ?? "x"}-${gi}`}
              group={g}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TranscriptGroupBlock({
  group,
  t,
}: {
  group: TranscriptGroup;
  t: ReturnType<typeof useTranslations>;
}) {
  const heading =
    group.index !== null
      ? [t("complete.transcriptQuestion", { n: group.index + 1 }), group.topic || group.question || ""]
          .filter(Boolean)
          .join(" · ")
      : t("complete.transcriptTitle");

  return (
    <div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: "0.04em",
          color: "rgb(var(--ink))",
          marginBottom: 10,
        }}
      >
        {heading}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {group.messages.map((m, i) => (
          <TranscriptBubble key={i} speaker={m.speaker} text={m.content} t={t} />
        ))}
      </div>
    </div>
  );
}

function TranscriptBubble({
  speaker,
  text,
  t,
}: {
  speaker: "ai_host" | "student" | "system";
  text: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const isHost = speaker === "ai_host";
  const isStudent = speaker === "student";
  const labelKey = isHost
    ? "complete.transcriptHost"
    : isStudent
      ? "complete.transcriptYou"
      : null;
  const accent = isHost
    ? "#0EA5E9"
    : isStudent
      ? "#F472B6"
      : "rgb(var(--ink-2))";
  const accentSoft = isHost
    ? "rgba(14,165,233,0.10)"
    : isStudent
      ? "rgba(244,114,182,0.12)"
      : "rgba(148,163,184,0.10)";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        columnGap: 12,
        alignItems: "start",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: accent,
          padding: "3px 9px",
          borderRadius: 999,
          background: accentSoft,
          alignSelf: "start",
          marginTop: 2,
          whiteSpace: "nowrap",
        }}
      >
        {labelKey ? t(labelKey) : speaker}
      </div>
      <div
        style={{
          fontSize: 15,
          lineHeight: 1.65,
          fontWeight: 500,
          color: "rgb(var(--ink))",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {text}
      </div>
    </div>
  );
}

function FeedbackColumn({
  titleKey,
  tone,
  items,
  t,
}: {
  titleKey: string;
  tone: "cyan" | "pink" | "neutral";
  items: string[];
  t: ReturnType<typeof useTranslations>;
}) {
  const accent =
    tone === "cyan"
      ? "rgb(var(--cyan))"
      : tone === "pink"
        ? "rgb(var(--pink-deep))"
        : "rgb(var(--ink-2))";
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: "0.2em",
          color: accent,
          marginBottom: 10,
        }}
      >
        {t(titleKey)}
      </div>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {items.length === 0 ? (
          <li
            className="text-muted"
            style={{ fontSize: 13, lineHeight: 1.6 }}
          >
            —
          </li>
        ) : (
          items.map((item, i) => (
            <li
              key={`${i}-${item.slice(0, 12)}`}
              style={{
                fontSize: 13,
                lineHeight: 1.6,
                paddingInlineStart: 14,
                position: "relative",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  insetInlineStart: 0,
                  top: 9,
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: accent,
                }}
              />
              {item}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
