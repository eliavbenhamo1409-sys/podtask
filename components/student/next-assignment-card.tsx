"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Link } from "@/lib/i18n/navigation";
import { Badge, Chip } from "@/components/podtask/chip";
import { Eyebrow } from "@/components/podtask/eyebrow";
import { GlowOrb } from "@/components/podtask/glow-orb";
import { Waveform } from "@/components/podtask/waveform";
import {
  ArrowIcon,
  ClockIcon,
  SparkIcon,
} from "@/components/podtask/icons";
import type { StudentAssignment } from "@/lib/student/types";

interface NextAssignmentCardProps {
  assignment: StudentAssignment;
  href: string;
}

export function NextAssignmentCard({
  assignment,
  href,
}: NextAssignmentCardProps) {
  const t = useTranslations();
  const estTime = `${assignment.estimatedInterviewMinutes} ${t("common.minutes")}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay: 0.05 }}
      className="card-hero"
      style={{ padding: 40, position: "relative", marginTop: 40 }}
    >
      <div style={{ position: "absolute", top: 32, insetInlineStart: 32 }}>
        <Badge variant="pink" showDot>
          {t("dashboard.dueTomorrow")}
        </Badge>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 360px",
          gap: 40,
          alignItems: "center",
        }}
      >
        <div>
          <Eyebrow icon={<SparkIcon size={14} />}>{t("dashboard.nextUp")}</Eyebrow>
          <h2 className="title" style={{ fontSize: 34, marginTop: 8 }}>
            {assignment.title}
          </h2>
          <div
            className="row text-muted"
            style={{ gap: 16, marginTop: 8, fontSize: 14, fontWeight: 500 }}
          >
            <span>{assignment.courseName}</span>
            <span>·</span>
            <span className="row" style={{ gap: 8 }}>
              <ClockIcon /> {t("dashboard.interviewLength", { time: estTime })}
            </span>
          </div>
          <p className="subtitle" style={{ marginTop: 16, maxWidth: 480 }}>
            {t("dashboard.previewText")}
          </p>
          <div className="row" style={{ gap: 12, marginTop: 24 }}>
            <Link href={href}>
              <button type="button" className="btn btn-primary btn-lg">
                {t("common.continue")}
                <span className="icon-flip">
                  <ArrowIcon />
                </span>
              </button>
            </Link>
            <Link href={`/student/assignments/${assignment.id}`}>
              <button type="button" className="btn btn-secondary btn-lg">
                {t("dashboard.viewInstructions")}
              </button>
            </Link>
          </div>
        </div>

        <div
          style={{
            position: "relative",
            height: 280,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(circle at 50% 50%, rgba(125,211,252,0.18), transparent 70%)",
              borderRadius: "50%",
            }}
          />
          <GlowOrb
            size={200}
            float
            style={{ animation: "spin 14s linear infinite, float 4s ease-in-out infinite" }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 6,
              insetInlineStart: 0,
              insetInlineEnd: 0,
              textAlign: "center",
            }}
          >
            <Chip variant="cyan" className="text-[11px]">
              <Waveform />
              {t("dashboard.hostWarmingUp")}
            </Chip>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
