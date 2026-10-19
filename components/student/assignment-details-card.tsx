"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Badge, Chip } from "@/components/podtask/chip";
import {
  BulbIcon,
  ClockIcon,
  DocIcon,
  FileTextIcon,
  ListIcon,
  MessageIcon,
  SparkIcon,
} from "@/components/podtask/icons";
import { useTheme } from "@/components/providers/theme-provider";
import type { StudentAssignment } from "@/lib/student/types";

interface AssignmentDetailsCardProps {
  assignment: StudentAssignment;
}

export function AssignmentDetailsCard({
  assignment,
}: AssignmentDetailsCardProps) {
  const t = useTranslations();
  const { theme } = useTheme();
  if (theme === "forest") return <ForestAssignmentDetails assignment={assignment} />;
  const dueLabel = assignment.dueLabelKey
    ? t(`due.${assignment.dueLabelKey}`)
    : "";
  const estTime = `${assignment.estimatedInterviewMinutes} ${t("common.minutes")}`;
  const badge =
    assignment.badgeKind === "done"
      ? { variant: "mint" as const, label: t("status.completed") }
      : assignment.badgeKind === "next"
        ? { variant: "cyan" as const, label: t("status.next") }
        : { variant: "neutral" as const, label: t("status.scheduled") };

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
      className="card card-pad"
      style={{ padding: 40 }}
    >
      <Badge variant={badge.variant} showDot>
        {badge.label}
        {dueLabel ? ` · ${dueLabel}` : ""}
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
        <Chip>{t("details.topicsCount", { count: assignment.topics.length })}</Chip>
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

      {assignment.topics.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.16em",
              color: "rgb(var(--muted))",
              textTransform: "uppercase",
            }}
          >
            {t("details.topics")}
          </div>
          <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            {assignment.topics.map((topic) => (
              <Chip key={topic} variant="cyan">
                {topic}
              </Chip>
            ))}
          </div>
        </div>
      )}

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

/**
 * Forest theme: page header (course, title, lecturer, status) followed by
 * a facts strip, the instructions + topics card and a conversation tip.
 * Same data as the classic card; nothing here is assignment-specific copy
 * that the data does not carry.
 */
function ForestAssignmentDetails({ assignment }: AssignmentDetailsCardProps) {
  const t = useTranslations();
  const tf = useTranslations("forestJourney.details");
  const dueLabel = assignment.dueLabelKey ? t(`due.${assignment.dueLabelKey}`) : "";
  // "submitted*" labels already read as a sentence ("Submitted Apr 28"); only
  // an upcoming due-* label gets the "Due {date}" prefix.
  const isDone =
    assignment.badgeKind === "done" ||
    (assignment.dueLabelKey?.startsWith("submitted") ?? false);
  const status =
    assignment.badgeKind === "done"
      ? { tone: "ok", label: tf("statusDone") }
      : assignment.badgeKind === "next"
        ? { tone: "amber", label: tf("statusNext") }
        : { tone: "muted", label: tf("statusTodo") };
  const hasInstructions = assignment.instructions.trim().length > 0;
  const hasTopics = assignment.topics.length > 0;

  return (
    <div className="jr-detail">
      <header className="jr-head">
        <div className="eyebrow">{assignment.courseName}</div>
        <h1 className="display">{assignment.title}</h1>
        <p className="subtitle">{assignment.lecturerName}</p>
        <div className="jr-status-line">
          <span className={`jr-status jr-status-${status.tone}`}>
            <span className="jr-dot" aria-hidden />
            {status.label}
          </span>
          {dueLabel && (
            <>
              <span className="jr-sep" aria-hidden />
              <span>{isDone ? dueLabel : tf("due", { date: dueLabel })}</span>
            </>
          )}
        </div>
      </header>

      <dl className="card jr-facts">
        <div className="jr-fact">
          <dt>
            <ClockIcon size={22} aria-hidden />
            {tf("factLength")}
          </dt>
          <dd>{tf("factLengthValue", { minutes: assignment.estimatedInterviewMinutes })}</dd>
        </div>
        <div className="jr-fact">
          <dt>
            <FileTextIcon size={22} aria-hidden />
            {tf("factUpload")}
          </dt>
          <dd>
            {tf("factUploadValue")}
            <span className="jr-fact-sub">{tf("factFormats")}</span>
          </dd>
        </div>
        {hasTopics && (
          <div className="jr-fact">
            <dt>
              <ListIcon size={22} aria-hidden />
              {tf("factTopics")}
            </dt>
            <dd>{tf("factTopicsValue", { count: assignment.topics.length })}</dd>
          </div>
        )}
      </dl>

      {(hasInstructions || hasTopics) && (
        <section className="card jr-card">
          {hasInstructions && (
            <div className="jr-card-sec">
              <h2 className="jr-h2">{tf("instructions")}</h2>
              <p className="jr-body" dir="auto">
                {assignment.instructions}
              </p>
            </div>
          )}
          {hasTopics && (
            <div className="jr-card-sec">
              <h2 className="jr-h2">{tf("topicsTitle")}</h2>
              <p className="jr-muted">{tf("topicsHint")}</p>
              <ul className="jr-rows">
                {assignment.topics.map((topic) => (
                  <li key={topic} className="jr-row">
                    <MessageIcon size={20} aria-hidden />
                    <span>{topic}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <aside className="jr-note">
        <BulbIcon size={22} aria-hidden />
        <div>
          <div className="jr-note-title">{tf("tipTitle")}</div>
          <p>{tf("tipBody")}</p>
        </div>
      </aside>
    </div>
  );
}
