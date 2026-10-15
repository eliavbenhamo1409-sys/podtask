import { getTranslations } from "next-intl/server";
import { Chip } from "@/components/podtask/chip";
import type { IntegritySettings } from "@/lib/integrity/settings";
import type { ReportEvent } from "@/lib/lecturer/types";
import {
  buildExamModel,
  formatOffset,
  type EventClass,
  type ExamEventView,
  type TimelineLane,
} from "@/lib/lecturer/exam-integrity";

interface ExamIntegrityProps {
  events: ReportEvent[];
  questions: { id: string; topic: string }[];
  /** First host line per planned question, for the timeline's question marks. */
  questionStarts: { id: string; at: string }[];
  interview: { startedAt: string | null; completedAt: string | null };
  integrity: IntegritySettings;
}

const KNOWN_EVENTS = new Set([
  "visibility_hidden",
  "tab_returned",
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
  "camera_exemption",
  "face_missing",
  "multiple_faces",
  "head_away",
  "tracking_unavailable",
  "integrity_warning",
  "silence_nudge",
  "own_words_prompt",
  "mic_muted",
  "disconnect",
  "reconnect",
  "session_resumed",
]);

const LANES: TimelineLane[] = ["tabs", "camera", "technical"];

function seconds(ms: number): number {
  return Math.round(ms / 1000);
}

/**
 * "Exam Integrity": tab exits, camera presence and technical trouble on one
 * timeline, with each item marked as technical / monitoring / worth a human
 * look. The knowledge score lives elsewhere and is never touched by this.
 */
export async function ExamIntegrity({
  events,
  questions,
  questionStarts,
  interview,
  integrity,
}: ExamIntegrityProps) {
  const t = await getTranslations();
  const model = buildExamModel(events, interview);
  const { summary, items, spanMs, startedAtMs } = model;
  const qIndex = new Map(questions.map((q, i) => [q.id, i + 1]));
  const qLabel = (id: string | null) =>
    id && qIndex.has(id) ? t("lecturer.questionN", { n: qIndex.get(id)! }) : null;
  const classLabel = (cls: EventClass) => t(`lecturer.examClass_${cls}`);
  const kindLabel = (kind: string) => t(`lecturer.ev_${KNOWN_EVENTS.has(kind) ? kind : "other"}`);
  const pct = (ms: number) => Math.max(0, Math.min(100, (ms / spanMs) * 100));

  const cameraLine =
    integrity.camera === "off"
      ? t("lecturer.examCameraOff")
      : summary.exemption
        ? t("lecturer.examExemption", { reason: t(`lecturer.exemption_${summary.exemption.reason}`) })
        : summary.cameraStarted
          ? t("lecturer.examCameraStartedOk")
          : summary.cameraDenied
            ? t("lecturer.examCameraDenied")
            : summary.cameraUnavailable
              ? t("lecturer.examCameraUnavailable")
              : t("lecturer.examCameraNotStarted");

  const marks: { id: string; at: number }[] = startedAtMs
    ? questionStarts
        .map((q) => ({ id: q.id, at: Date.parse(q.at) - startedAtMs }))
        .filter((q) => Number.isFinite(q.at) && q.at >= 0)
    : [];

  const detail = (e: ExamEventView): string | null => {
    const p = e.payload;
    switch (e.kind) {
      case "head_away":
        return p.axis === "pitch" ? t("lecturer.examAxisPitch") : t("lecturer.examAxisYaw");
      case "multiple_faces":
        return typeof p.faces === "number" ? t("lecturer.examFacesN", { n: p.faces }) : null;
      case "integrity_warning": {
        const reasons = ["look_away", "glances", "another_person", "face_missing"];
        if (typeof p.reason !== "string" || !reasons.includes(p.reason)) return null;
        const reason = t(`lecturer.warn_${p.reason}`);
        return p.cue === "head" || p.cue === "eyes" ? `${reason} (${t(`lecturer.examCue_${p.cue}`)})` : reason;
      }
      case "tracking_unavailable":
      case "camera_off":
      case "camera_unavailable":
      case "disconnect":
        return typeof p.reason === "string" ? p.reason : null;
      case "camera_exemption":
        return typeof p.reason === "string" ? t(`lecturer.exemption_${p.reason}`) : null;
      case "session_resumed":
        return typeof p.attempt === "number" ? t("lecturer.examAttemptN", { n: p.attempt }) : null;
      default:
        return null;
    }
  };

  return (
    <div className="card" style={{ padding: 20, marginTop: 14 }}>
      <div className="between" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{t("lecturer.examTitle")}</div>
          <div className="text-muted" style={{ fontSize: 12, marginTop: 2, lineHeight: 1.5, maxWidth: 640 }}>
            {t("lecturer.examIntro")}
          </div>
        </div>
        <Chip variant={summary.reviewCount > 0 ? "pink" : "default"}>
          {summary.reviewCount > 0
            ? t("lecturer.examReviewN", { n: summary.reviewCount })
            : t("lecturer.examNothingToReview")}
        </Chip>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <Chip variant={integrity.camera === "required" ? "cyan" : "default"}>
          {integrity.camera === "required"
            ? t("lecturer.examCameraRequired")
            : integrity.camera === "on"
              ? t("lecturer.examCameraOptional")
              : t("lecturer.examCameraOff")}
        </Chip>
        <Chip>{cameraLine}</Chip>
        {!integrity.activityMonitoring ? <Chip>{t("lecturer.activityWasOff")}</Chip> : null}
      </div>
      {summary.exemption?.note ? (
        <div className="lx-quote" style={{ marginTop: 8 }}>{summary.exemption.note}</div>
      ) : null}

      <div className="lx-exam-stats">
        <div className="lx-exam-stat" data-class={summary.tabExits > 0 ? "review" : undefined}>
          <div className="lx-exam-stat-n">{summary.tabExits}</div>
          <div className="lx-exam-stat-l">{t("lecturer.examTabExits")}</div>
          <div className="lx-exam-stat-s">
            {t("lecturer.examTabAway", { seconds: seconds(summary.tabAwayMs) })}
          </div>
        </div>
        <div className="lx-exam-stat" data-class={summary.noFaceCount > 0 ? "monitoring" : undefined}>
          <div className="lx-exam-stat-n">{summary.noFaceCount}</div>
          <div className="lx-exam-stat-l">{t("lecturer.examNoFace")}</div>
          <div className="lx-exam-stat-s">{t("lecturer.totalSeconds", { seconds: seconds(summary.noFaceMs) })}</div>
        </div>
        <div className="lx-exam-stat" data-class={summary.multiFaceCount > 0 ? "review" : undefined}>
          <div className="lx-exam-stat-n">{summary.multiFaceCount}</div>
          <div className="lx-exam-stat-l">{t("lecturer.examMultiFace")}</div>
          <div className="lx-exam-stat-s">{t("lecturer.totalSeconds", { seconds: seconds(summary.multiFaceMs) })}</div>
        </div>
        <div className="lx-exam-stat" data-class={summary.headAwayCount > 0 ? "monitoring" : undefined}>
          <div className="lx-exam-stat-n">{summary.headAwayCount}</div>
          <div className="lx-exam-stat-l">{t("lecturer.examHeadAway")}</div>
          <div className="lx-exam-stat-s">{t("lecturer.totalSeconds", { seconds: seconds(summary.headAwayMs) })}</div>
        </div>
        <div className="lx-exam-stat" data-class={summary.technicalCount > 0 ? "technical" : undefined}>
          <div className="lx-exam-stat-n">{summary.technicalCount}</div>
          <div className="lx-exam-stat-l">{t("lecturer.examTechnical")}</div>
          <div className="lx-exam-stat-s">
            {summary.trackingUnavailableMs > 0
              ? t("lecturer.examTrackingGap", { seconds: seconds(summary.trackingUnavailableMs) })
              : t("lecturer.examBlurN", { n: summary.blurCount })}
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-muted" style={{ fontSize: 13, marginTop: 14, marginBottom: 0 }}>
          {t("lecturer.examNoEvents")}
        </p>
      ) : (
        <>
          <div style={{ fontWeight: 800, fontSize: 13, marginTop: 18 }}>{t("lecturer.examTimelineTitle")}</div>
          <div className="lx-timeline" aria-label={t("lecturer.examTimelineTitle")}>
            <div className="lx-timeline-axis">
              {marks.map((m) => (
                <span key={m.id} className="lx-timeline-q" style={{ left: `${pct(m.at)}%` }}>
                  {qLabel(m.id) ?? m.id}
                </span>
              ))}
              <span className="lx-timeline-q" style={{ left: "100%" }}>
                {formatOffset(spanMs)}
              </span>
            </div>
            {LANES.map((lane) => (
              <div key={lane} className="lx-timeline-lane">
                <span className="lx-timeline-lane-label">{t(`lecturer.examLane_${lane}`)}</span>
                {items
                  .filter((e) => e.lane === lane)
                  .map((e) => {
                    const width = e.durationMs ? Math.max(0.6, (e.durationMs / spanMs) * 100) : 0.6;
                    const title = [
                      kindLabel(e.kind),
                      formatOffset(e.offsetMs),
                      e.durationMs ? t("lecturer.examDur", { seconds: seconds(e.durationMs) }) : null,
                      qLabel(e.questionId),
                      classLabel(e.cls),
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <span
                        key={e.id}
                        className="lx-timeline-mark"
                        data-class={e.cls}
                        data-open={e.open ? "true" : undefined}
                        style={{ left: `${pct(e.offsetMs)}%`, width: `${width}%` }}
                        title={title}
                      />
                    );
                  })}
              </div>
            ))}
            <div className="lx-timeline-legend">
              <span><i style={{ background: "#38bdf8" }} />{t("lecturer.examClass_technical")}</span>
              <span><i style={{ background: "#f59e0b" }} />{t("lecturer.examClass_monitoring")}</span>
              <span><i style={{ background: "#f43f5e" }} />{t("lecturer.examClass_review")}</span>
              <span>{t("lecturer.examOpenLegend")}</span>
            </div>
          </div>

          <div style={{ fontWeight: 800, fontSize: 13, marginTop: 18 }}>{t("lecturer.examListTitle")}</div>
          <div style={{ marginTop: 6 }}>
            {items.map((e) => {
              const d = detail(e);
              return (
                <div key={e.id} className="lx-exam-row">
                  <span className="lx-exam-row-class" data-class={e.cls} aria-hidden />
                  <span className="lx-exam-time">{formatOffset(e.offsetMs)}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong>{kindLabel(e.kind)}</strong>
                    {e.durationMs ? ` · ${t("lecturer.examDur", { seconds: seconds(e.durationMs) })}` : ""}
                    {e.open ? ` · ${t("lecturer.examOpenEnded")}` : ""}
                    {d ? ` · ${d}` : ""}
                    {qLabel(e.questionId) ? (
                      <>
                        {" "}
                        <Chip>{qLabel(e.questionId)}</Chip>
                      </>
                    ) : null}
                  </span>
                  <Chip variant={e.cls === "review" ? "pink" : e.cls === "technical" ? "cyan" : "default"}>
                    {classLabel(e.cls)}
                  </Chip>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="text-muted" style={{ fontSize: 12, marginTop: 14, lineHeight: 1.55 }}>
        <div>{t("lecturer.examHumanCheck")}</div>
        <div style={{ marginTop: 4 }}>{t("lecturer.examLimits")}</div>
        <div style={{ marginTop: 4, fontWeight: 700 }}>{t("lecturer.examScoreSeparate")}</div>
      </div>
    </div>
  );
}
