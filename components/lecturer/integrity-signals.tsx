import { getTranslations } from "next-intl/server";
import { Chip } from "@/components/podtask/chip";
import type { IntegritySettings } from "@/lib/integrity/settings";
import type { ReportEvent, ReportFlag, ReportMessage } from "@/lib/lecturer/types";
import { ExamIntegrity } from "./exam-integrity";

interface IntegritySignalsProps {
  flags: ReportFlag[];
  events: ReportEvent[];
  questions: { id: string; topic: string }[];
  /** For the Exam Integrity timeline: where each question started. */
  messages: ReportMessage[];
  interview: { startedAt: string | null; completedAt: string | null };
  summary: Record<string, unknown> | null;
  integrity: IntegritySettings;
  isGuest: boolean;
  locale: string;
}

const KNOWN_CATEGORIES = new Set([
  "verbatim_document",
  "long_pause_then_fluent",
  "uniform_instant_answers",
  "no_live_session",
  "messages_before_start",
  "implausibly_short",
  "contradiction",
  "generic_answer",
  "cannot_explain_term",
  "cannot_explain_decision",
  "technical_context",
  "other",
]);

/**
 * A flag's display level. "strong" needs a high-confidence item AND at
 * least two independent sources agreeing somewhere in the interview; a
 * low-confidence item is shown as context ("none"), never as a finding.
 */
function levelOf(flag: ReportFlag, sources: number): "none" | "notable" | "strong" {
  if (flag.confidence === "low") return "none";
  if (flag.confidence === "high" && sources >= 2) return "strong";
  return "notable";
}

/** The localized limitation note for a flag, by where it came from. */
function limitationKey(flag: ReportFlag): string {
  if (flag.source === "host_tool") return "lecturer.limit_host";
  if (flag.source === "server_timing") return "lecturer.limit_timing";
  if (flag.source === "server_session") return "lecturer.limit_session";
  const ev = (flag.evidence[0] ?? null) as Record<string, unknown> | null;
  return ev?.document_source === "llm_markdown"
    ? "lecturer.limit_overlap_pdf"
    : "lecturer.limit_overlap_raw";
}

/**
 * Evidence for a human reviewer, never a verdict: review items with their
 * limitations, aggregated browser / camera events, and the server-side
 * session facts. Every client-sourced item is labelled as client telemetry.
 */
export async function IntegritySignals({
  flags,
  events,
  questions,
  messages,
  interview,
  summary,
  integrity,
  isGuest,
}: IntegritySignalsProps) {
  const t = await getTranslations();
  const qIndex = new Map(questions.map((q, i) => [q.id, i + 1]));
  const qLabel = (id: string | null) =>
    id && qIndex.has(id) ? t("lecturer.questionN", { n: qIndex.get(id)! }) : null;
  const sources = new Set(flags.filter((f) => f.confidence !== "low").map((f) => f.source)).size;

  // Aggregate events by kind.
  const byKind = new Map<string, { count: number; totalMs: number; questions: Set<string> }>();
  for (const e of events) {
    const agg = byKind.get(e.kind) ?? { count: 0, totalMs: 0, questions: new Set<string>() };
    agg.count += 1;
    agg.totalMs += e.durationMs ?? 0;
    if (e.planQuestionId) agg.questions.add(e.planQuestionId);
    byKind.set(e.kind, agg);
  }
  const attentionKinds = ["visibility_hidden", "window_blur", "fullscreen_exit", "page_hidden", "offline", "camera_denied", "camera_unavailable", "camera_off", "camera_exemption", "face_missing", "multiple_faces", "head_away", "integrity_warning", "tracking_unavailable", "disconnect"];
  // First host line per planned question = where that question started.
  const questionStarts: { id: string; at: string }[] = [];
  const seenQ = new Set<string>();
  for (const m of messages) {
    if (m.speaker !== "ai_host" || !m.planQuestionId || seenQ.has(m.planQuestionId)) continue;
    seenQ.add(m.planQuestionId);
    questionStarts.push({ id: m.planQuestionId, at: m.createdAt });
  }

  const sessionsMinted = typeof summary?.sessions_minted === "number" ? summary.sessions_minted : null;
  const medianLatency = typeof summary?.median_latency_ms === "number" ? summary.median_latency_ms : null;
  const bargeIns = typeof summary?.barge_ins === "number" ? summary.barge_ins : null;

  return (
    <div style={{ marginTop: 12 }}>
      <p className="text-muted" style={{ fontSize: 14, lineHeight: 1.6, marginTop: 0 }}>
        {t("lecturer.signalsIntro")}
      </p>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {isGuest ? <Chip variant="pink">{t("lecturer.guestNoIdentity")}</Chip> : null}
        {integrity.camera === "off" ? <Chip>{t("lecturer.cameraWasOff")}</Chip> : null}
        {!integrity.activityMonitoring ? <Chip>{t("lecturer.activityWasOff")}</Chip> : null}
        {sessionsMinted !== null ? (
          <Chip variant={sessionsMinted > 0 ? "default" : "pink"}>
            {t("lecturer.sessionsMinted", { n: sessionsMinted })}
          </Chip>
        ) : null}
        {medianLatency !== null ? <Chip>{t("lecturer.medianLatency", { seconds: (medianLatency / 1000).toFixed(1) })}</Chip> : null}
        {bargeIns !== null ? <Chip>{t("lecturer.bargeIns", { n: bargeIns })}</Chip> : null}
      </div>

      {flags.length === 0 && attentionKinds.every((k) => !byKind.has(k)) ? (
        <div className="card" style={{ padding: 20 }}>
          <span className="text-muted">{t("lecturer.noSignals")}</span>
        </div>
      ) : null}

      {flags.length ? (
        <div style={{ display: "grid", gap: 10 }}>
          {flags.map((f) => {
            const level = levelOf(f, sources);
            const category = KNOWN_CATEGORIES.has(f.category) ? f.category : "other";
            const ev = (f.evidence[0] ?? null) as Record<string, unknown> | null;
            return (
              <div key={f.id} className="lx-signal" data-level={level}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 800 }}>{t(`lecturer.cat_${category}`)}</span>
                    {qLabel(f.planQuestionId) ? <Chip>{qLabel(f.planQuestionId)}</Chip> : null}
                    <Chip variant={f.source === "host_tool" ? "cyan" : "default"}>
                      {f.source === "host_tool" ? t("lecturer.flagHost") : t("lecturer.flagServer")}
                    </Chip>
                    <Chip>{t(`lecturer.level_${level}`)}</Chip>
                  </div>
                  <div style={{ fontSize: 14, marginTop: 6, lineHeight: 1.55 }}>
                    {t(`lecturer.catBody_${category}`)}
                  </div>
                  {f.source === "host_tool" && f.description ? (
                    <div style={{ fontSize: 13, marginTop: 4, lineHeight: 1.55 }}>{f.description}</div>
                  ) : null}
                  {f.quote ? <div className="lx-quote">{f.quote}</div> : null}
                  {category === "verbatim_document" && ev && typeof ev.passage === "string" ? (
                    <div className="lx-quote" style={{ borderInlineStartColor: "rgb(var(--pink-soft))" }}>
                      <div className="text-muted" style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>
                        {t("lecturer.matchedPassage")}
                        {typeof ev.longest_run_tokens === "number"
                          ? ` · ${t("lecturer.runTokens", { n: ev.longest_run_tokens })}`
                          : ""}
                      </div>
                      {ev.passage}
                    </div>
                  ) : null}
                  <div className="text-muted" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
                    {t("lecturer.limitationsLabel")}: {t(limitationKey(f))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Exam Integrity: tab exits, camera presence, technical trouble, timeline. */}
      {integrity.camera !== "off" || integrity.activityMonitoring || events.length > 0 ? (
        <ExamIntegrity
          events={events}
          questions={questions}
          questionStarts={questionStarts}
          interview={interview}
          integrity={integrity}
        />
      ) : null}
    </div>
  );
}
