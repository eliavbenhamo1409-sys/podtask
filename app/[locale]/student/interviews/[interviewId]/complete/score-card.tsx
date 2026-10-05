"use client";

import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Badge } from "@/components/podtask/chip";
import { Eyebrow } from "@/components/podtask/eyebrow";
import { GlowOrb } from "@/components/podtask/glow-orb";
import { Steps } from "@/components/podtask/steps";
import {
  ArrowIcon,
  CheckIcon,
  ChevronIcon,
  MicIcon,
  SparkIcon,
} from "@/components/podtask/icons";
import {
  getInterviewTranscript,
  getReportForInterview,
} from "@/lib/student/student-service";
import { isHostDirective } from "@/lib/realtime/host-directives";
import type { InterviewTranscript } from "@/lib/student/types";

type ReportShape = Awaited<ReturnType<typeof getReportForInterview>>;
type ReadyReport = NonNullable<ReportShape>;
type Translate = ReturnType<typeof useTranslations>;

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
      className="card report-scoring"
    >
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
        <GlowOrb size={72} state="thinking" float />
      </div>
      <div style={{ fontSize: 18, fontWeight: 800 }}>{t("complete.scoring")}</div>
      <div style={{ minHeight: 24, marginTop: 6 }}>
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
        className="mx-auto mt-5 max-w-2xl"
      />
      <div
        className="text-muted"
        style={{ fontSize: 12, marginTop: 14, lineHeight: 1.6 }}
      >
        {timedOut ? t("complete.scoringSlow") : t("complete.scoringHint")}
      </div>
      {timedOut && (
        <button
          type="button"
          className="btn btn-secondary"
          style={{ marginTop: 12 }}
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

const RUBRIC_KEYS: Array<{ key: keyof NonNullable<ReadyReport["rubric"]>; labelKey: string }> = [
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

  const ready = report && report.status === "ready" ? report : null;
  const groups = transcript ? groupTranscript(transcript) : null;
  const dir = locale === "he" ? "rtl" : "ltr";

  const bars: DisclosureItem[] = [];
  if (ready && (ready.summary || ready.recommendations.length > 0)) {
    bars.push({
      id: "insights",
      icon: <SparkIcon size={16} />,
      title: t("complete.summaryAndRecsTitle"),
      teaser: ready.summary ?? undefined,
      meta:
        ready.recommendations.length > 0
          ? t("complete.recsMeta", { count: ready.recommendations.length })
          : undefined,
      content: (
        <div className="report-insights">
          {ready.summary && (
            <div>
              <div className="report-label">{t("complete.summaryTitle")}</div>
              <p dir="auto">{ready.summary}</p>
            </div>
          )}
          {ready.recommendations.length > 0 && (
            <div>
              <div className="report-label">
                {t("complete.recommendationsTitle")}
              </div>
              <Bullets items={ready.recommendations} />
            </div>
          )}
        </div>
      ),
    });
  }
  bars.push({
    id: "transcript",
    icon: <MicIcon size={16} />,
    title: t("complete.transcriptTitle"),
    meta:
      groups && groups.length > 0
        ? t("complete.transcriptMeta", {
            questions: groups.filter((g) => g.index !== null).length,
            messages: groups.reduce(
              (n, g) => n + g.entries.filter((e) => e.speaker !== "system").length,
              0,
            ),
          })
        : undefined,
    content: (
      <div dir={dir}>
        {groups === null ? (
          <div className="text-muted" style={{ fontSize: 14 }}>
            {t("common.loading")}
          </div>
        ) : groups.length === 0 ? (
          <div className="text-muted" style={{ fontSize: 14, lineHeight: 1.7 }}>
            {t("complete.transcriptEmpty")}
          </div>
        ) : (
          <div className="transcript">
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
    ),
  });

  return (
    <>
      {ready ? <ReportCard report={ready} t={t} /> : <ScoringProgress timedOut={timedOut} />}
      <DisclosureGroup items={bars} />
    </>
  );
}

function ReportCard({ report, t }: { report: ReadyReport; t: Translate }) {
  const level = report.overallLevel ?? "medium";
  const levelKey = LEVEL_KEYS[level as keyof typeof LEVEL_KEYS] ?? LEVEL_KEYS.medium;
  const score = typeof report.overallScore === "number"
    ? Math.round(report.overallScore)
    : null;

  return (
    <motion.section
      key={report.id}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="card-hero report-card"
    >
      <div className="report-score">
        <div className="report-score-top">
          <ScoreRing score={score} t={t} />
          <div className="report-score-meta">
            <Eyebrow icon={<SparkIcon size={14} />}>
              {t("complete.scoreLabel")}
            </Eyebrow>
            <Badge variant={LEVEL_BADGE[level as keyof typeof LEVEL_BADGE] ?? "neutral"} showDot>
              {t(levelKey)}
            </Badge>
          </div>
        </div>

        {report.rubric && (
          <div>
            <div className="report-label">{t("complete.rubricTitle")}</div>
            <div className="report-rubric">
              {RUBRIC_KEYS.map(({ key, labelKey }) => {
                const val = report.rubric?.[key];
                return (
                  <div key={key}>
                    <div className="report-rubric-row">
                      <span className="report-rubric-name">{t(labelKey)}</span>
                      <span className="report-rubric-val">
                        {typeof val === "number" ? val.toFixed(1) : "—"}
                        {typeof val === "number" && <small>/ {RUBRIC_MAX}</small>}
                      </span>
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
          </div>
        )}
      </div>

      <FeedbackList
        tone="keep"
        icon={<CheckIcon size={14} />}
        title={t("complete.strengthsTitle")}
        items={report.strengths}
      />
      <FeedbackList
        tone="improve"
        icon={
          <ArrowIcon size={14} style={{ transform: "rotate(-90deg)" }} />
        }
        title={t("complete.weaknessesTitle")}
        items={report.weaknesses}
      />
    </motion.section>
  );
}

const RING_R = 50;
const RING_C = 2 * Math.PI * RING_R;

/** The overall score as a ring that fills to score / 100. */
function ScoreRing({ score, t }: { score: number | null; t: Translate }) {
  const reduce = useReducedMotion();
  const fraction = score === null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  return (
    <div className="report-ring">
      <svg viewBox="0 0 112 112" aria-hidden>
        <defs>
          <linearGradient id="report-ring-fill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#7DD3FC" />
            <stop offset="100%" stopColor="#0EA5E9" />
          </linearGradient>
        </defs>
        <circle
          cx="56"
          cy="56"
          r={RING_R}
          fill="none"
          stroke="rgba(125,211,252,0.22)"
          strokeWidth="8"
        />
        <motion.circle
          cx="56"
          cy="56"
          r={RING_R}
          fill="none"
          stroke="url(#report-ring-fill)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={RING_C}
          initial={{ strokeDashoffset: reduce ? RING_C * (1 - fraction) : RING_C }}
          animate={{ strokeDashoffset: RING_C * (1 - fraction) }}
          transition={{ duration: 1.1, ease: [0.2, 0.8, 0.2, 1] }}
        />
      </svg>
      <div className="report-ring-value">
        <span className="report-ring-num" aria-hidden>
          {score !== null ? <CountUp value={score} /> : "—"}
        </span>
        <span className="report-ring-of" aria-hidden>
          {t("complete.outOf100")}
        </span>
        {score !== null && (
          <span className="sr-only">{`${score} ${t("complete.outOf100")}`}</span>
        )}
      </div>
    </div>
  );
}

function FeedbackList({
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
  return (
    <div className="report-list" data-tone={tone}>
      <div className="report-list-head">
        <span className="report-list-icon" aria-hidden>
          {icon}
        </span>
        <h2 className="report-list-title">{title}</h2>
        {items.length > 0 && (
          <span className="report-count" aria-hidden>
            {items.length}
          </span>
        )}
      </div>
      <Bullets items={items} />
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="report-bullets">
      {items.length === 0 ? (
        <li className="is-empty">—</li>
      ) : (
        items.map((item, i) => (
          <li key={`${i}-${item.slice(0, 12)}`} dir="auto">
            {item}
          </li>
        ))
      )}
    </ul>
  );
}

interface DisclosureItem {
  id: string;
  icon: ReactNode;
  title: string;
  teaser?: string;
  meta?: string;
  content: ReactNode;
}

/**
 * A row of bars, each expanding its own panel below the row (one column on
 * narrow screens). In the DOM every bar is followed by its own panel, so
 * reading and focus order match an accordion; the row is built with grid
 * placement. Closed panels stay in the DOM (inert) so printing shows
 * everything; a panel that opens below the fold is scrolled into view.
 */
function DisclosureGroup({ items }: { items: DisclosureItem[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const reduce = useReducedMotion();
  const bodies = useRef(new Map<string, HTMLDivElement>());
  const revealTimer = useRef<number | undefined>(undefined);
  const baseId = useId();

  useEffect(() => () => window.clearTimeout(revealTimer.current), []);

  // Measures the panel body, which keeps its full size while the panel row
  // is still collapsed or growing.
  const reveal = (id: string) => {
    const el = bodies.current.get(id);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.bottom <= window.innerHeight) return;
    const fits = rect.height <= window.innerHeight - 180;
    el.scrollIntoView({
      block: fits ? "end" : "start",
      behavior: reduce ? "auto" : "smooth",
    });
  };

  const toggle = (id: string) => {
    const next = !open[id];
    setOpen((o) => ({ ...o, [id]: next }));
    window.clearTimeout(revealTimer.current);
    if (next) {
      // Wait until the page has grown (the panel's transition, or one frame
      // when motion is reduced) so the scroll is not clamped.
      revealTimer.current = window.setTimeout(() => reveal(id), reduce ? 50 : 360);
    }
  };

  return (
    <div
      className="report-bars"
      style={{ "--bars": items.length } as CSSProperties}
    >
      {items.map((item) => {
        const isOpen = !!open[item.id];
        const barId = `${baseId}-${item.id}-bar`;
        const panelId = `${baseId}-${item.id}-panel`;
        return (
          <Fragment key={item.id}>
            <h2 className="disclosure-heading">
              <button
                type="button"
                id={barId}
                className="disclosure-bar"
                data-open={isOpen}
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggle(item.id)}
              >
                <span className="disclosure-icon" aria-hidden>
                  {item.icon}
                </span>
                <span className="disclosure-title">{item.title}</span>
                {item.teaser && (
                  <span className="disclosure-teaser" dir="auto" aria-hidden>
                    {item.teaser}
                  </span>
                )}
                {item.meta && <span className="disclosure-meta">{item.meta}</span>}
                <span
                  className="disclosure-chevron"
                  aria-hidden
                  style={item.meta || item.teaser ? undefined : { marginInlineStart: "auto" }}
                >
                  <ChevronIcon />
                </span>
              </button>
            </h2>
            <div
              id={panelId}
              role="region"
              aria-labelledby={barId}
              className="disclosure-panel"
              data-open={isOpen}
              inert={!isOpen}
            >
              <div className="disclosure-inner">
                <div
                  className="disclosure-body"
                  ref={(el) => {
                    if (el) bodies.current.set(item.id, el);
                    else bodies.current.delete(item.id);
                  }}
                >
                  {item.content}
                </div>
              </div>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

type TranscriptSpeaker = "ai_host" | "student" | "system";

interface TranscriptGroup {
  planQuestionId: string | null;
  topic: string;
  question: string;
  index: number | null;
  entries: { speaker: TranscriptSpeaker; content: string }[];
}

/** "skipped_question:N" / "replaced_question:N" markers saved by the room. */
function noteKeyFor(content: string): string | null {
  if (/^skipped_question:\d+$/.test(content)) return "complete.transcriptSkipped";
  if (/^replaced_question:\d+$/.test(content)) return "complete.transcriptReplaced";
  return null;
}

function groupTranscript(transcript: InterviewTranscript): TranscriptGroup[] {
  const planIndex = new Map<string, { index: number; topic: string; question: string }>();
  transcript.plan.forEach((q, i) => {
    planIndex.set(q.id, { index: i, topic: q.topic, question: q.question });
  });

  const groups = new Map<string, TranscriptGroup>();
  const order: string[] = [];

  for (const m of transcript.messages) {
    // Skip / swap directives are steering text for the host, not speech, and
    // system rows are only shown when they are a known marker.
    if (m.speaker === "system" ? !noteKeyFor(m.content) : isHostDirective(m.content)) {
      continue;
    }
    const key = m.planQuestionId ?? "__unanchored__";
    if (!groups.has(key)) {
      const meta = m.planQuestionId ? planIndex.get(m.planQuestionId) : null;
      groups.set(key, {
        planQuestionId: m.planQuestionId,
        topic: meta?.topic ?? "",
        question: meta?.question ?? "",
        index: meta?.index ?? null,
        entries: [],
      });
      order.push(key);
    }
    groups.get(key)!.entries.push({ speaker: m.speaker, content: m.content });
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
  return [...anchored, ...unanchored]
    .map((k) => groups.get(k)!)
    .filter((g) => g.entries.length > 0);
}

function TranscriptGroupBlock({
  group,
  t,
}: {
  group: TranscriptGroup;
  t: Translate;
}) {
  const heading =
    group.index !== null
      ? [t("complete.transcriptQuestion", { n: group.index + 1 }), group.topic || group.question || ""]
          .filter(Boolean)
          .join(" · ")
      : t("complete.transcriptTitle");

  return (
    <div className="transcript-group">
      <h3 className="transcript-group-title">{heading}</h3>
      {group.entries.map((e, i) => {
        if (e.speaker === "system") {
          const noteKey = noteKeyFor(e.content);
          return noteKey ? (
            <div key={i} className="transcript-note">
              {t(noteKey)}
            </div>
          ) : null;
        }
        return (
          <div key={i} className="transcript-msg" data-speaker={e.speaker}>
            <span className="transcript-who">
              {t(e.speaker === "ai_host" ? "complete.transcriptHost" : "complete.transcriptYou")}
            </span>
            <div dir="auto">{e.content}</div>
          </div>
        );
      })}
    </div>
  );
}
