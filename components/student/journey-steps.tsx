"use client";

import { useTranslations } from "next-intl";
import { Steps } from "@/components/podtask/steps";
import { cn } from "@/lib/utils";

export type JourneyStage = "upload" | "prepare" | "talk" | "feedback";
const STAGES: JourneyStage[] = ["upload", "prepare", "talk", "feedback"];

/**
 * The student's four-stage path (upload → prepare → talk → feedback) as a
 * stepper. Used by the forest theme on the upload, processing, lobby,
 * consent, mic-test and report screens so the student always sees where
 * they are in one consistent vocabulary.
 */
export function JourneySteps({ stage, className }: { stage: JourneyStage; className?: string }) {
  const t = useTranslations("journey");
  return (
    <nav aria-label={t("label")} className={cn("journey-steps", className)}>
      <Steps current={STAGES.indexOf(stage)} items={STAGES.map((s) => t(s))} />
    </nav>
  );
}
