"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Link } from "@/lib/i18n/navigation";
import { Eyebrow } from "@/components/podtask/eyebrow";
import {
  ArrowIcon,
  CheckIcon,
  MicIcon,
  SparkIcon,
  UploadIcon,
} from "@/components/podtask/icons";

interface Step {
  num: string;
  labelKey: string;
  descKey: string;
  icon: React.ReactNode;
}

interface WhatHappensNextCardProps {
  uploadHref: string;
}

export function WhatHappensNextCard({ uploadHref }: WhatHappensNextCardProps) {
  const t = useTranslations();

  const steps: Step[] = [
    {
      num: "01",
      labelKey: "details.stepUpload",
      descKey: "details.stepUploadDesc",
      icon: <UploadIcon />,
    },
    {
      num: "02",
      labelKey: "details.stepAnalyze",
      descKey: "details.stepAnalyzeDesc",
      icon: <SparkIcon />,
    },
    {
      num: "03",
      labelKey: "details.stepInterview",
      descKey: "details.stepInterviewDesc",
      icon: <MicIcon />,
    },
    {
      num: "04",
      labelKey: "details.stepFinish",
      descKey: "details.stepFinishDesc",
      icon: <CheckIcon />,
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.1 }}
      className="card-hero"
      style={{ padding: 32, position: "sticky", top: 100 }}
    >
      <Eyebrow icon={<SparkIcon size={14} />}>
        {t("details.whatHappensNext")}
      </Eyebrow>
      <h3
        style={{
          fontSize: 22,
          fontWeight: 800,
          letterSpacing: "-0.02em",
          margin: "10px 0 24px",
        }}
      >
        {t("details.fourSteps")}
      </h3>

      <div className="flex-col" style={{ gap: 16 }}>
        {steps.map((s, i) => (
          <div
            key={s.num}
            className="row"
            style={{
              gap: 16,
              padding: "14px 16px",
              borderRadius: 18,
              background:
                i === 0 ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.55)",
              border: "1px solid rgba(230,238,247,0.7)",
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                background:
                  i === 0
                    ? "linear-gradient(135deg, #38BDF8, #0EA5E9)"
                    : "rgba(246,251,255,0.9)",
                color: i === 0 ? "white" : "rgb(var(--cyan))",
                boxShadow:
                  i === 0 ? "0 10px 24px rgba(14,165,233,0.3)" : "none",
              }}
            >
              {s.icon}
            </div>
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.16em",
                  color: i === 0 ? "rgb(var(--cyan))" : "rgb(var(--muted))",
                }}
              >
                {t("details.step")} {s.num}
              </div>
              <div style={{ fontWeight: 800, fontSize: 15, margin: "2px 0 2px" }}>
                {t(s.labelKey)}
              </div>
              <div
                className="text-muted"
                style={{ fontSize: 13, lineHeight: 1.4 }}
              >
                {t(s.descKey)}
              </div>
            </div>
          </div>
        ))}
      </div>

      <Link href={uploadHref}>
        <button
          type="button"
          className="btn btn-primary btn-lg"
          style={{ width: "100%", marginTop: 32 }}
        >
          {t("details.startUpload")}
          <span className="icon-flip">
            <ArrowIcon />
          </span>
        </button>
      </Link>
      <div
        className="text-muted"
        style={{ fontSize: 12, textAlign: "center", marginTop: 16 }}
      >
        {t("details.pauseAnytime")}
      </div>
    </motion.div>
  );
}
