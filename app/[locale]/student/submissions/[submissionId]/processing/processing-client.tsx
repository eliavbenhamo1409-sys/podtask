"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "@/lib/i18n/navigation";
import { StudentAppShell } from "@/components/student/student-app-shell";
import { Steps } from "@/components/podtask/steps";
import { GlowOrb } from "@/components/podtask/glow-orb";
import { AlertIcon, CheckIcon, FileTextIcon } from "@/components/podtask/icons";
import { JourneySteps } from "@/components/student/journey-steps";
import { useTheme } from "@/components/providers/theme-provider";
import { formatBytes } from "@/lib/utils";
import {
  observeSubmissionProcessing,
  prepareSubmission,
} from "@/lib/student/student-service";
import {
  processingStepFor,
  type SubmissionStatus,
} from "@/lib/student/status";

interface ProcessingClientProps {
  submissionId: string;
}

const MESSAGE_KEYS = [
  "processing.step1",
  "processing.step2",
  "processing.step3",
  "processing.step4",
] as const;

// Keep these coordinates static to avoid SSR/client floating-point drift
// (which can cause hydration attribute mismatches in inline styles).
const ORBIT_DOTS = [
  { top: "50%", insetInlineStart: "95%", durationSec: 2.0, delaySec: 0.0 },
  { top: "88.9711%", insetInlineStart: "72.5%", durationSec: 2.3, delaySec: 0.2 },
  { top: "88.9711%", insetInlineStart: "27.5%", durationSec: 2.6, delaySec: 0.4 },
  { top: "50%", insetInlineStart: "5%", durationSec: 2.9, delaySec: 0.6 },
  { top: "11.0289%", insetInlineStart: "27.5%", durationSec: 3.2, delaySec: 0.8 },
  { top: "11.0289%", insetInlineStart: "72.5%", durationSec: 3.5, delaySec: 1.0 },
] as const;

export function ProcessingClient({ submissionId }: ProcessingClientProps) {
  const t = useTranslations();
  const router = useRouter();
  const [status, setStatus] = useState<SubmissionStatus>("uploaded");
  const [step, setStep] = useState(0);
  const [errored, setErrored] = useState(false);
  const { theme } = useTheme();
  // Name and size of the uploaded file, shown by the forest layout only.
  const [doc, setDoc] = useState<{ name: string; size: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let messageTimer: ReturnType<typeof setInterval> | null = null;

    const stop = observeSubmissionProcessing(submissionId, (sub) => {
      if (cancelled) return;
      setStatus(sub.status);
      setDoc((prev) =>
        prev?.name === sub.originalFilename && prev.size === sub.fileSizeBytes
          ? prev
          : { name: sub.originalFilename, size: sub.fileSizeBytes },
      );
      if (sub.status === "failed") {
        setErrored(true);
        return;
      }
    });

    messageTimer = setInterval(() => {
      setStep((s) => Math.min(s + 1, MESSAGE_KEYS.length));
    }, 1700);

    return () => {
      cancelled = true;
      stop();
      if (messageTimer) clearInterval(messageTimer);
    };
  }, [submissionId]);

  useEffect(() => {
    if (status === "interview_ready") {
      const timer = setTimeout(async () => {
        await prepareSubmission(submissionId);
        router.push(`/student/submissions/${submissionId}/lobby`);
      }, 900);
      return () => clearTimeout(timer);
    }
  }, [status, submissionId, router]);

  const stepIdx = processingStepFor(status);
  const stepLabels = [
    t("processing.stepsRead"),
    t("processing.stepsOutline"),
    t("processing.stepsQuestions"),
    t("processing.stepsStudio"),
  ];

  if (theme === "forest") {
    return (
      <ForestProcessing
        status={status}
        stepIdx={stepIdx}
        errored={errored}
        doc={doc}
      />
    );
  }

  if (errored) {
    return (
      <StudentAppShell blobsVariant="studio">
        <div
          className="page-narrow"
          style={{ paddingTop: 60 }}
        >
          <div
            className="card-hero card-pad-lg"
            style={{ padding: "56px 48px", textAlign: "center" }}
          >
            <h1 className="title" style={{ fontSize: 28 }}>
              {t("processing.errorTitle")}
            </h1>
            <p className="subtitle">{t("processing.errorBody")}</p>
            <button
              type="button"
              className="btn btn-primary btn-lg"
              style={{ marginTop: 24 }}
              onClick={() => location.reload()}
            >
              {t("processing.tryAgain")}
            </button>
          </div>
        </div>
      </StudentAppShell>
    );
  }

  return (
    <StudentAppShell blobsVariant="studio">
      <div className="page-narrow" style={{ paddingTop: 60 }}>
        <div
          className="card-hero card-pad-lg"
          style={{ padding: "56px 48px", textAlign: "center" }}
        >
          <h1 className="title" style={{ fontSize: 32 }}>
            {t("processing.title")}
          </h1>
          <p className="subtitle">{t("processing.subtitle")}</p>

          <div
            style={{
              position: "relative",
              width: 280,
              height: 280,
              margin: "48px auto",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: "50%",
                border: "1px solid rgba(125,211,252,0.4)",
                animation: "pulse-ring 2.4s ease-out infinite",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: "50%",
                border: "1px solid rgba(253,164,175,0.4)",
                animation: "pulse-ring 2.4s ease-out infinite 1.2s",
              }}
            />
            <GlowOrb
              size={200}
              state="thinking"
              float
              style={{ position: "absolute", top: 40, insetInlineStart: 40 }}
            />
            {ORBIT_DOTS.map((dot, i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background: "rgb(var(--pink-soft))",
                  boxShadow: "0 0 10px rgb(var(--pink-soft))",
                  top: dot.top,
                  insetInlineStart: dot.insetInlineStart,
                  animation:
                    `float ${dot.durationSec}s ease-in-out infinite ${dot.delaySec}s`,
                }}
              />
            ))}
          </div>

          <div style={{ minHeight: 32 }} aria-live="polite">
            <AnimatePresence mode="wait">
              {status !== "interview_ready" ? (
                <motion.div
                  key={Math.min(step, MESSAGE_KEYS.length - 1)}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  style={{
                    fontSize: 17,
                    fontWeight: 600,
                    color: "rgb(var(--ink-2))",
                  }}
                >
                  {t(MESSAGE_KEYS[Math.min(step, MESSAGE_KEYS.length - 1)])}
                </motion.div>
              ) : (
                <motion.div
                  key="ready"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="row"
                  style={{
                    gap: 8,
                    justifyContent: "center",
                    fontSize: 17,
                    fontWeight: 700,
                    color: "rgb(var(--cyan))",
                  }}
                >
                  <CheckIcon /> {t("processing.ready")}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div style={{ marginTop: 40 }}>
            <Steps current={Math.min(stepIdx, 3)} items={stepLabels} />
          </div>
        </div>
      </div>
    </StudentAppShell>
  );
}

const FOREST_ROWS = ["s1", "s2", "s3", "s4"] as const;
const FOREST_NEXT = [1, 2, 3] as const;

/**
 * Forest theme: a calm checklist driven by the real submission status (no
 * orb, no timed messages), next to what follows once the questions exist.
 */
function ForestProcessing({
  status,
  stepIdx,
  errored,
  doc,
}: {
  status: SubmissionStatus;
  stepIdx: number;
  errored: boolean;
  doc: { name: string; size: number } | null;
}) {
  const tf = useTranslations("forestJourney.processing");
  const ready = status === "interview_ready";
  // 0..2 = that row is in progress; 3+ (interview_ready or later) = all done.
  const allDone = ready || stepIdx >= 3;
  const rowState = (i: number) =>
    allDone || i < stepIdx ? "done" : i === stepIdx ? "active" : "pending";
  const activeKey = allDone ? null : FOREST_ROWS[Math.max(0, stepIdx)];

  return (
    <StudentAppShell blobsVariant="studio">
      <div className="page jr-page jr-processing">
        <div className="jr-proc-head">
          <div>
            <h1 className="display">{errored ? tf("errorTitle") : tf("title")}</h1>
            <p className="subtitle">{errored ? tf("errorBody") : tf("subtitle")}</p>
          </div>
          <JourneySteps stage="prepare" className="jr-stepper" />
        </div>

        <div className={`jr-proc-grid${errored ? " solo" : ""}`}>
          <section className="card jr-card jr-proc-card" aria-labelledby="jr-proc-title">
            <h2 id="jr-proc-title" className="jr-h2">
              {tf("listTitle")}
            </h2>
            <div className="jr-checklist">
              {doc && (
                <div className="jr-proc-doc">
                  <FileTextIcon size={26} aria-hidden />
                  <div>
                    <div className="jr-proc-doc-name">
                      <bdi>{doc.name}</bdi>
                    </div>
                    {doc.size > 0 && (
                      <div className="jr-proc-doc-sub">
                        <bdi>{formatBytes(doc.size)}</bdi>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {errored ? (
                <div className="jr-proc-error" role="alert">
                  <AlertIcon size={20} aria-hidden />
                  <span>{tf("errorRow")}</span>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => location.reload()}
                  >
                    {tf("tryAgain")}
                  </button>
                </div>
              ) : (
                <ol className="jr-check-rows">
                  {FOREST_ROWS.map((key, i) => {
                    const state = rowState(i);
                    return (
                      <li key={key} className={`jr-check jr-check-${state}`}>
                        <span className="jr-check-mark" aria-hidden>
                          {state === "done" && <CheckIcon size={13} />}
                        </span>
                        <span className="jr-check-label">{tf(key)}</span>
                        <span className="sr-only">
                          {tf(
                            state === "done"
                              ? "stateDone"
                              : state === "active"
                                ? "stateActive"
                                : "statePending",
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
            {!errored && (
              <div className={`jr-proc-foot${ready ? " ready" : ""}`} aria-live="polite">
                {ready ? (
                  <>
                    <CheckIcon size={18} aria-hidden /> {tf("ready")}
                  </>
                ) : (
                  <>
                    {activeKey && <span className="sr-only">{tf(activeKey)}. </span>}
                    {tf("note")}
                  </>
                )}
              </div>
            )}
          </section>

          {!errored && (
            <aside className="card jr-card jr-proc-next" aria-labelledby="jr-proc-next-title">
              <h2 id="jr-proc-next-title" className="jr-h2">
                {tf("nextTitle")}
              </h2>
              <p className="jr-muted">{tf("nextSubtitle")}</p>
              <ol className="jr-numbered">
                {FOREST_NEXT.map((n) => (
                  <li key={n}>
                    <span className="jr-num" aria-hidden>
                      {n}
                    </span>
                    <div>
                      <div className="jr-num-title">{tf(`n${n}Title`)}</div>
                      <p>{tf(`n${n}Body`)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </aside>
          )}
        </div>
      </div>
    </StudentAppShell>
  );
}
