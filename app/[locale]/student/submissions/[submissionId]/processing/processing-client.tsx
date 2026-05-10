"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "@/lib/i18n/navigation";
import { StudentAppShell } from "@/components/student/student-app-shell";
import { Steps } from "@/components/podtask/steps";
import { Eyebrow } from "@/components/podtask/eyebrow";
import { GlowOrb } from "@/components/podtask/glow-orb";
import { CheckIcon, SparkIcon } from "@/components/podtask/icons";
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

  useEffect(() => {
    let cancelled = false;
    let messageTimer: ReturnType<typeof setInterval> | null = null;

    const stop = observeSubmissionProcessing(submissionId, (sub) => {
      if (cancelled) return;
      setStatus(sub.status);
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

  if (errored) {
    return (
      <StudentAppShell blobsVariant="studio">
        <div
          className="page-narrow"
          style={{ paddingTop: 60 }}
        >
          <div
            className="card-hero"
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
          className="card-hero"
          style={{ padding: "56px 48px", textAlign: "center" }}
        >
          <Eyebrow icon={<SparkIcon size={14} />}>
            {t("processing.eyebrow")}
          </Eyebrow>
          <h1 className="title" style={{ fontSize: 32, marginTop: 16 }}>
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
              float
              style={{
                position: "absolute",
                top: "50%",
                insetInlineStart: "50%",
                transform: "translate(-50%,-50%)",
                animation:
                  "spin 10s linear infinite, float 4s ease-in-out infinite",
              }}
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

          <div style={{ minHeight: 32 }}>
            <AnimatePresence mode="wait">
              {step < MESSAGE_KEYS.length ? (
                <motion.div
                  key={step}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  style={{
                    fontSize: 17,
                    fontWeight: 600,
                    color: "rgb(var(--ink-2))",
                  }}
                >
                  {t(MESSAGE_KEYS[step])}
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
