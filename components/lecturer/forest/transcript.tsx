import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { MonitorIcon } from "@/components/podtask/icons";
import { buildExamModel } from "@/lib/lecturer/exam-integrity";
import type { ReportEvent, ReportMessage } from "@/lib/lecturer/types";
import { isHostDirective } from "@/lib/realtime/host-directives";
import { isRtlInterviewLanguage, normalizeInterviewLanguage } from "@/lib/student/interview-language";
import { clock } from "./util";

interface ForestTranscriptProps {
  questions: { id: string; topic: string }[];
  messages: ReportMessage[];
  events: ReportEvent[];
  interview: { startedAt: string | null; completedAt: string | null; language: string };
  studentName: string;
}

/** Markers the room saves as system lines (see the student report). */
function noteKey(content: string): string | null {
  if (/^skipped_question:\d+$/.test(content)) return "forestLecturer.noteSkipped";
  if (/^replaced_question:\d+$/.test(content)) return "forestLecturer.noteReplaced";
  if (/^discarded_utterance:[a-z_]+$/.test(content)) return "forestLecturer.noteDiscarded";
  return null;
}

type Row =
  | { type: "message"; at: number; m: ReportMessage }
  | { type: "event"; at: number; id: string; kind: string; cls: string; durationMs: number | null };

/**
 * The conversation in time order, each line with its offset from the start,
 * and the room's monitoring events as quiet rows where they happened.
 */
export async function ForestTranscript({ questions, messages, events, interview, studentName }: ForestTranscriptProps) {
  const t = await getTranslations();
  const dir = isRtlInterviewLanguage(normalizeInterviewLanguage(interview.language)) ? "rtl" : "ltr";
  const startMs = Date.parse(interview.startedAt ?? "") || Date.parse(messages[0]?.createdAt ?? "") || 0;
  const model = buildExamModel(events, interview);

  const rows: Row[] = [
    ...messages.map((m) => ({ type: "message" as const, at: Date.parse(m.createdAt) || startMs, m })),
    // Technical bookkeeping (camera started, reconnects) stays in the integrity tab.
    ...model.items
      .filter((e) => e.cls !== "technical")
      .map((e) => ({
        type: "event" as const,
        at: (model.startedAtMs ?? startMs) + e.offsetMs,
        id: e.id,
        kind: e.kind,
        cls: e.cls,
        durationMs: e.durationMs,
      })),
  ].sort((a, b) => a.at - b.at);

  if (messages.length === 0) {
    return <p className="lxf-empty-row lxf-empty-row-muted">{t("complete.transcriptEmpty")}</p>;
  }

  const qTitle = (id: string) => {
    const i = questions.findIndex((q) => q.id === id);
    return i >= 0 ? `${t("lecturer.questionN", { n: i + 1 })} · ${questions[i].topic}` : t("lecturer.transcriptOther");
  };

  const out: ReactNode[] = [];
  let currentQ: string | null | undefined;
  for (const row of rows) {
    const time = clock(row.at - startMs);
    if (row.type === "event") {
      const kindKey = `lecturer.ev_${row.kind}`;
      out.push(
        <div key={`e-${row.id}`} className="lxf-tr-event" data-class={row.cls}>
          <MonitorIcon size={17} strokeWidth={1.6} aria-hidden />
          <time>{time}</time>
          <span className="lxf-tr-event-text">
            {t.has(kindKey) ? t(kindKey) : t("lecturer.ev_other")}
            {row.durationMs ? ` · ${t("lecturer.examDur", { seconds: Math.round(row.durationMs / 1000) })}` : ""}
          </span>
          {row.cls === "review" ? <span className="lxf-tr-event-tag">{t("lecturer.examClass_review")}</span> : null}
        </div>,
      );
      continue;
    }
    const m = row.m;
    if (m.planQuestionId !== currentQ && (m.planQuestionId || currentQ === undefined)) {
      currentQ = m.planQuestionId;
      out.push(
        <div key={`q-${m.id}`} className="lxf-tr-q">
          {m.planQuestionId ? qTitle(m.planQuestionId) : t("lecturer.transcriptIntro")}
        </div>,
      );
    }
    if (m.speaker === "system") {
      const key = noteKey(m.content);
      out.push(
        <div key={m.id} className="lxf-tr-note">
          <time>{time}</time>
          <span>{key ? t(key) : `${t("lecturer.systemLine")}: ${m.content}`}</span>
        </div>,
      );
      continue;
    }
    const host = m.speaker === "ai_host";
    const directive = isHostDirective(m.content);
    if (directive) {
      out.push(
        <div key={m.id} className="lxf-tr-note">
          <time>{time}</time>
          <span>{t("forestLecturer.roomNote")}</span>
        </div>,
      );
      continue;
    }
    out.push(
      <div key={m.id} className="lxf-tr-row" data-speaker={host ? "host" : "student"}>
        <div className="lxf-tr-who">
          <time>{time}</time>
          <span className="lxf-tr-name">{host ? t("forestLecturer.hostName") : studentName}</span>
        </div>
        <p className="lxf-tr-text" dir={dir}>
          {m.content}
        </p>
      </div>,
    );
  }

  return <div className="lxf-tr">{out}</div>;
}
