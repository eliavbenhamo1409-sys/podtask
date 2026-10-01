"use client";

import { motion } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/lib/i18n/navigation";
import { Badge } from "@/components/podtask/chip";
import {
  ArrowIcon,
  CalendarIcon,
  CheckIcon,
  ClockIcon,
} from "@/components/podtask/icons";
import type { StudentAssignment } from "@/lib/student/types";

interface AssignmentCardProps {
  assignment: StudentAssignment;
  href: string;
  index?: number;
}

function formatDue(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // UTC keeps server and client output identical (no hydration mismatch).
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(d);
}

export function AssignmentCard({ assignment, href, index = 0 }: AssignmentCardProps) {
  const t = useTranslations();
  const locale = useLocale();
  // Demo rows carry a translated relative label; real rows carry an ISO date.
  const dueLabel = assignment.dueLabelKey
    ? t(`due.${assignment.dueLabelKey}`)
    : formatDue(assignment.dueAt, locale);
  const estTime = `${assignment.estimatedInterviewMinutes} ${t("common.minutes")}`;

  let badge;
  if (assignment.badgeKind === "next") {
    badge = (
      <Badge variant="cyan" showDot>
        {t("status.next")}
      </Badge>
    );
  } else if (assignment.badgeKind === "done") {
    badge = (
      <Badge variant="mint">
        <CheckIcon size={12} />
        {t("status.completed")}
      </Badge>
    );
  } else {
    badge = (
      <Badge variant="neutral">
        <CalendarIcon size={11} />
        {t("status.scheduled")}
      </Badge>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.06 * index }}
    >
      <Link
        href={href}
        style={{ textDecoration: "none", color: "inherit" }}
      >
        <motion.div
          whileHover={{
            y: -3,
            boxShadow:
              "0 30px 80px rgba(15,23,42,0.10), 0 0 30px rgba(125,211,252,0.18)",
          }}
          transition={{ duration: 0.25 }}
          className="card"
          style={{ padding: 28, cursor: "pointer" }}
        >
          <div className="between">
            {badge}
            <span className="icon-flip" style={{ color: "rgb(var(--cyan))" }}>
              <ArrowIcon />
            </span>
          </div>
          <h3
            style={{
              margin: "18px 0 6px",
              fontSize: 19,
              fontWeight: 800,
              letterSpacing: "-0.01em",
              lineHeight: 1.3,
            }}
          >
            {assignment.title}
          </h3>
          <div
            className="text-muted"
            style={{ fontSize: 13, fontWeight: 500 }}
          >
            {assignment.courseName}
          </div>
          <div
            className="row"
            style={{
              gap: 16,
              rowGap: 6,
              marginTop: 24,
              fontSize: 13,
              color: "rgb(var(--ink-2))",
              fontWeight: 600,
              flexWrap: "wrap",
            }}
          >
            <span className="row" style={{ gap: 8 }}>
              <CalendarIcon />
              <bdi>{dueLabel}</bdi>
            </span>
            <span style={{ color: "rgb(var(--line))" }}>·</span>
            <span className="row" style={{ gap: 8 }}>
              <ClockIcon />
              {estTime}
            </span>
          </div>
        </motion.div>
      </Link>
    </motion.div>
  );
}
