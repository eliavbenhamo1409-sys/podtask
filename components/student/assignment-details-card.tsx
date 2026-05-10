"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Badge, Chip } from "@/components/podtask/chip";
import {
  ClockIcon,
  DocIcon,
  SparkIcon,
} from "@/components/podtask/icons";
import type { StudentAssignment } from "@/lib/student/types";

interface AssignmentDetailsCardProps {
  assignment: StudentAssignment;
}

export function AssignmentDetailsCard({
  assignment,
}: AssignmentDetailsCardProps) {
  const t = useTranslations();
  const dueLabel = assignment.dueLabelKey
    ? t(`due.${assignment.dueLabelKey}`)
    : "";
  const estTime = `${assignment.estimatedInterviewMinutes} ${t("common.minutes")}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
      className="card"
      style={{ padding: 40 }}
    >
      <Badge variant="cyan" showDot>
        {t("status.next")} · {dueLabel}
      </Badge>
      <h1 className="title" style={{ fontSize: 34, marginTop: 16 }}>
        {assignment.title}
      </h1>
      <div
        className="text-muted"
        style={{ fontSize: 15, fontWeight: 500, marginTop: 8 }}
      >
        {assignment.courseName} · {assignment.lecturerName}
      </div>

      <div className="row" style={{ gap: 12, marginTop: 24, flexWrap: "wrap" }}>
        <Chip>
          <ClockIcon /> ~{estTime}
        </Chip>
        <Chip>
          <DocIcon /> {t("details.draftRequired")}
        </Chip>
        <Chip>{t("details.topicsCount")}</Chip>
      </div>

      <div
        style={{
          height: 1,
          background: "rgb(var(--line))",
          margin: "28px 0",
        }}
      />

      <h3
        style={{
          fontSize: 16,
          fontWeight: 800,
          letterSpacing: "-0.01em",
          margin: 0,
        }}
      >
        {t("details.instructions")}
      </h3>
      <p className="subtitle" style={{ fontSize: 15, marginTop: 8 }}>
        {assignment.instructions}
      </p>

      <div
        className="card"
        style={{
          padding: 20,
          marginTop: 24,
          background: "rgba(246,251,255,0.7)",
          boxShadow: "none",
          borderRadius: 20,
        }}
      >
        <div className="row" style={{ gap: 12 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              background: "linear-gradient(135deg, #7DD3FC, #38BDF8)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              flexShrink: 0,
            }}
          >
            <SparkIcon size={18} />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14 }}>
              {t("details.lecturerTipTitle")}
            </div>
            <div
              className="text-muted"
              style={{ fontSize: 13, marginTop: 4, lineHeight: 1.55 }}
            >
              {t("details.lecturerTipBody")}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
