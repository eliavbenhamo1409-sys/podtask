/**
 * Exam Integrity view model for the lecturer report: classifies stored
 * telemetry rows (technical / monitoring / needs a human look), aggregates
 * the headline numbers and lays events out on the interview's timeline.
 * Pure module (no React, no DOM) so it is unit-tested in
 * `tests/integrity/exam-integrity.test.ts`. Nothing here is a verdict and
 * nothing here touches the knowledge score.
 */
import type { ReportEvent } from "./types";

export type EventClass = "technical" | "monitoring" | "review";

/** Lanes of the timeline, top to bottom. */
export type TimelineLane = "tabs" | "camera" | "technical";

/** Durations from which a monitoring event is worth a human look. */
export const REVIEW_THRESHOLDS_MS = {
  visibility_hidden: 10_000,
  face_missing: 20_000,
  head_away: 10_000,
} as const;

const TECHNICAL_KINDS = new Set([
  "camera_started",
  "camera_reconnected",
  "camera_denied",
  "camera_unavailable",
  "camera_off",
  "camera_exemption",
  "tracking_unavailable",
  "offline",
  "disconnect",
  "reconnect",
  "session_resumed",
  "page_hidden",
  "fullscreen_enter",
  "fullscreen_exit",
]);

const CAMERA_LANE_KINDS = new Set(["face_missing", "multiple_faces", "head_away"]);
const TAB_LANE_KINDS = new Set(["visibility_hidden", "window_blur", "tab_returned", "mic_muted", "silence_nudge", "own_words_prompt"]);

/** Rows that are only bookkeeping for another row (never listed). */
export function isHiddenFromList(kind: string): boolean {
  return kind === "tab_returned";
}

export function laneOf(kind: string): TimelineLane {
  if (CAMERA_LANE_KINDS.has(kind)) return "camera";
  if (TAB_LANE_KINDS.has(kind)) return "tabs";
  return "technical";
}

/** An interval that was opened but never closed (the page died or the row is still live). */
export function isOpenInterval(e: Pick<ReportEvent, "kind" | "endedAt" | "payload">): boolean {
  const intervalKinds = ["visibility_hidden", "face_missing", "multiple_faces", "head_away", "tracking_unavailable"];
  return intervalKinds.includes(e.kind) && !e.endedAt;
}

export function classifyEvent(e: Pick<ReportEvent, "kind" | "durationMs" | "endedAt" | "payload">): EventClass {
  if (TECHNICAL_KINDS.has(e.kind)) return "technical";
  const open = isOpenInterval(e);
  const dur = e.durationMs ?? 0;
  switch (e.kind) {
    case "visibility_hidden":
      return open || dur >= REVIEW_THRESHOLDS_MS.visibility_hidden ? "review" : "monitoring";
    case "face_missing":
      return open || dur >= REVIEW_THRESHOLDS_MS.face_missing ? "review" : "monitoring";
    case "head_away":
      return open || dur >= REVIEW_THRESHOLDS_MS.head_away ? "review" : "monitoring";
    case "multiple_faces":
      return "review";
    default:
      return "monitoring";
  }
}

export interface ExamEventView {
  id: string;
  kind: string;
  cls: EventClass;
  lane: TimelineLane;
  /** ms since the interview started (clamped to >= 0). */
  offsetMs: number;
  durationMs: number | null;
  open: boolean;
  questionId: string | null;
  payload: Record<string, unknown>;
}

export interface ExamSummary {
  tabExits: number;
  tabAwayMs: number;
  blurCount: number;
  noFaceCount: number;
  noFaceMs: number;
  multiFaceCount: number;
  multiFaceMs: number;
  headAwayCount: number;
  headAwayMs: number;
  technicalCount: number;
  trackingUnavailableMs: number;
  reviewCount: number;
  cameraStarted: boolean;
  cameraDenied: boolean;
  cameraUnavailable: boolean;
  cameraOffCount: number;
  exemption: { reason: string; note: string | null } | null;
}

export interface ExamModel {
  summary: ExamSummary;
  items: ExamEventView[];
  /** Total span of the timeline, ms. */
  spanMs: number;
  startedAtMs: number | null;
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

export function buildExamModel(
  events: ReportEvent[],
  interview: { startedAt: string | null; completedAt: string | null },
): ExamModel {
  const summary: ExamSummary = {
    tabExits: 0,
    tabAwayMs: 0,
    blurCount: 0,
    noFaceCount: 0,
    noFaceMs: 0,
    multiFaceCount: 0,
    multiFaceMs: 0,
    headAwayCount: 0,
    headAwayMs: 0,
    technicalCount: 0,
    trackingUnavailableMs: 0,
    reviewCount: 0,
    cameraStarted: false,
    cameraDenied: false,
    cameraUnavailable: false,
    cameraOffCount: 0,
    exemption: null,
  };

  const sorted = [...events].sort((a, b) => (ms(a.startedAt) ?? 0) - (ms(b.startedAt) ?? 0));
  const firstEvent = ms(sorted[0]?.startedAt);
  const startedAt = ms(interview.startedAt) ?? firstEvent;
  let end = ms(interview.completedAt);
  for (const e of sorted) {
    const s = ms(e.startedAt);
    const en = ms(e.endedAt) ?? (s !== null && e.durationMs ? s + e.durationMs : s);
    if (en !== null && (end === null || en > end)) end = en;
  }
  const spanMs = startedAt !== null && end !== null ? Math.max(60_000, end - startedAt) : 60_000;

  const items: ExamEventView[] = [];
  for (const e of sorted) {
    const dur = e.durationMs ?? null;
    switch (e.kind) {
      case "visibility_hidden":
        summary.tabExits += 1;
        summary.tabAwayMs += dur ?? 0;
        break;
      case "window_blur":
        summary.blurCount += 1;
        break;
      case "face_missing":
        summary.noFaceCount += 1;
        summary.noFaceMs += dur ?? 0;
        break;
      case "multiple_faces":
        summary.multiFaceCount += 1;
        summary.multiFaceMs += dur ?? 0;
        break;
      case "head_away":
        summary.headAwayCount += 1;
        summary.headAwayMs += dur ?? 0;
        break;
      case "tracking_unavailable":
        summary.trackingUnavailableMs += dur ?? 0;
        break;
      case "camera_started":
      case "camera_reconnected":
        summary.cameraStarted = true;
        break;
      case "camera_denied":
        summary.cameraDenied = true;
        break;
      case "camera_unavailable":
        summary.cameraUnavailable = true;
        break;
      case "camera_off":
        summary.cameraOffCount += 1;
        break;
      case "camera_exemption": {
        const reason = typeof e.payload.reason === "string" ? e.payload.reason : "other";
        const note = typeof e.payload.note === "string" ? e.payload.note : null;
        summary.exemption = { reason, note };
        break;
      }
      default:
        break;
    }
    const cls = classifyEvent(e);
    if (cls === "technical") summary.technicalCount += 1;
    if (cls === "review") summary.reviewCount += 1;
    if (isHiddenFromList(e.kind)) continue;
    const s = ms(e.startedAt);
    items.push({
      id: e.id,
      kind: e.kind,
      cls,
      lane: laneOf(e.kind),
      offsetMs: s !== null && startedAt !== null ? Math.max(0, s - startedAt) : 0,
      durationMs: dur,
      open: isOpenInterval(e),
      questionId: e.planQuestionId,
      payload: e.payload,
    });
  }
  return { summary, items, spanMs, startedAtMs: startedAt };
}

export function formatOffset(msValue: number): string {
  const total = Math.max(0, Math.round(msValue / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
