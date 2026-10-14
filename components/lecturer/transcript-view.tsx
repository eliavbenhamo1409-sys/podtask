import { getTranslations } from "next-intl/server";
import type { ReportMessage } from "@/lib/lecturer/types";
import { isHostDirective } from "@/lib/realtime/host-directives";
import { isRtlInterviewLanguage, normalizeInterviewLanguage } from "@/lib/student/interview-language";

interface TranscriptViewProps {
  questions: { id: string; topic: string }[];
  messages: ReportMessage[];
  language: string;
}

/** The conversation grouped by planned question, with the room's events. */
export async function TranscriptView({ questions, messages, language }: TranscriptViewProps) {
  const t = await getTranslations();
  const dir = isRtlInterviewLanguage(normalizeInterviewLanguage(language)) ? "rtl" : "ltr";
  const groups: { key: string; title: string; rows: ReportMessage[] }[] = [];
  const index = new Map<string, number>();
  const titleFor = (id: string | null) => {
    if (!id) return t("lecturer.transcriptIntro");
    const i = questions.findIndex((q) => q.id === id);
    return i >= 0 ? `${t("lecturer.questionN", { n: i + 1 })} · ${questions[i].topic}` : t("lecturer.transcriptOther");
  };
  for (const m of messages) {
    const key = m.planQuestionId ?? "_intro";
    let g = index.get(key);
    if (g === undefined) {
      g = groups.length;
      index.set(key, g);
      groups.push({ key, title: titleFor(m.planQuestionId), rows: [] });
    }
    groups[g].rows.push(m);
  }

  return (
    <div className="card" style={{ padding: 24, marginTop: 12 }} dir={dir}>
      {groups.length === 0 ? (
        <span className="text-muted">{t("complete.transcriptEmpty")}</span>
      ) : (
        groups.map((g) => (
          <div key={g.key} style={{ marginBottom: 18 }}>
            <div className="text-muted" style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", marginBottom: 8 }}>
              {g.title}
            </div>
            {g.rows.map((m) => {
              if (m.speaker === "system") {
                return (
                  <div key={m.id} className="text-muted" style={{ fontSize: 12, margin: "4px 0" }}>
                    · {t("lecturer.systemLine")}: {m.content}
                  </div>
                );
              }
              const directive = isHostDirective(m.content);
              const host = m.speaker === "ai_host";
              return (
                <div
                  key={m.id}
                  style={{
                    display: "flex",
                    gap: 10,
                    margin: "6px 0",
                    opacity: directive ? 0.6 : 1,
                    fontSize: 14,
                    lineHeight: 1.6,
                  }}
                >
                  <span style={{ fontWeight: 800, flexShrink: 0, color: host ? "rgb(var(--cyan))" : "rgb(var(--pink-deep))" }}>
                    {host ? t("complete.transcriptHost") : t("lecturer.studentLabel")}
                  </span>
                  <span>
                    {directive ? t("lecturer.roomNote") : m.content}
                  </span>
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
