import { getTranslations } from "next-intl/server";
import { Chip } from "@/components/podtask/chip";
import type { IntegritySettings } from "@/lib/integrity/settings";
import type { ReportEvent, ReportFlag } from "@/lib/lecturer/types";

interface IntegritySignalsProps {
  flags: ReportFlag[];
  events: ReportEvent[];
  questions: { id: string; topic: string }[];
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

const KNOWN_EVENTS = new Set([
  "visibility_hidden",
  "window_blur",
  "fullscreen_exit",
  "fullscreen_enter",
  "page_hidden",
  "offline",
  "camera_started",
  "camera_denied",
  "camera_unavailable",
  "camera_off",
  "camera_reconnected",
  "face_missing",
  "multiple_faces",
  "silence_nudge",
  "own_words_prompt",
  "mic_muted",
  "disconnect",
  "reconnect",
  "session_resumed",
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

function seconds(ms: number | null): number {
  return Math.round((ms ?? 0) / 1000);
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
  const contextKinds = ["camera_started", "camera_reconnected", "fullscreen_enter", "mic_muted", "silence_nudge", "own_words_prompt", "reconnect", "session_resumed"];
  const attentionKinds = ["visibility_hidden", "window_blur", "fullscreen_exit", "page_hidden", "offline", "camera_denied", "camera_unavailable", "camera_off", "face_missing", "multiple_faces", "disconnect"];

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
                  {f.limitations ? (
                    <div className="text-muted" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
                      {t("lecturer.limitationsLabel")}: {f.limitations}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {attentionKinds.some((k) => byKind.has(k)) || contextKinds.some((k) => byKind.has(k)) ? (
        <div className="card" style={{ padding: 20, marginTop: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>{t("lecturer.eventsTitle")}</div>
          <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>{t("lecturer.eventsNote")}</div>
          <ul className="consent-list" style={{ marginTop: 10 }}>
            {[...attentionKinds, ...contextKinds]
              .filter((k) => byKind.has(k))
              .map((kind) => {
                const agg = byKind.get(kind)!;
                const key = KNOWN_EVENTS.has(kind) ? kind : "other";
                const qs = [...agg.questions].map((id) => qLabel(id)).filter(Boolean).join(", ");
                return (
                  <li key={kind}>
                    <span>
                      <strong>{t(`lecturer.ev_${key}`)}</strong>: {t("lecturer.timesN", { n: agg.count })}
                      {agg.totalMs > 0 ? `, ${t("lecturer.totalSeconds", { seconds: seconds(agg.totalMs) })}` : ""}
                      {qs ? ` (${qs})` : ""}
                    </span>
                  </li>
                );
              })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
