/**
 * Hook-free presentational pieces of the live interview room, split out of
 * `interview-client.tsx` so the room component is only the stateful part.
 * Styling lives under "Interview room" in `styles/globals.css`; everything
 * here just maps props to data-attributes and CSS variables.
 */
import type { CSSProperties, ReactNode, Ref } from "react";
import { GlowOrb, type OrbState } from "@/components/podtask/glow-orb";
import {
  AlertIcon,
  CheckIcon,
  ChevronIcon,
  InfoIcon,
} from "@/components/podtask/icons";

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// Per-bar gain: a bell envelope with a little irregularity. Kept as a
// literal so the server and client markup are byte-identical.
const BAR_PROFILE = [
  0.22, 0.34, 0.3, 0.52, 0.44, 0.7, 0.58, 0.86, 0.72, 0.95, 1, 0.9, 0.76,
  0.88, 0.6, 0.72, 0.46, 0.54, 0.32, 0.36, 0.22,
];

/**
 * A waveform driven by one scalar audio level. Without `level` (mock
 * driver) the bars simply dance while `active`.
 */
export function VoiceBars({
  level,
  active,
  variant = "cyan",
  className,
}: {
  level?: number;
  active: boolean;
  variant?: "cyan" | "pink";
  className?: string;
}) {
  const auto = level === undefined;
  const style = auto
    ? undefined
    : ({
        "--lvl": (active ? clamp01(level * 4) : 0).toFixed(3),
      } as CSSProperties);
  return (
    <span
      aria-hidden
      className={["vbars", variant === "pink" ? "pink" : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      data-auto={auto ? "true" : undefined}
      data-active={active ? "true" : undefined}
      style={style}
    >
      {BAR_PROFILE.map((k, i) => (
        <span key={i} style={{ "--k": k, "--i": i } as CSSProperties}>
          <i />
        </span>
      ))}
    </span>
  );
}

/** The host's stage: the orb, her name, a voice line and the captions. */
export function HostStage({
  eyebrow,
  chip,
  name,
  role,
  orbState,
  level,
  children,
}: {
  eyebrow: ReactNode;
  chip: ReactNode;
  name: string;
  role: string;
  orbState: OrbState;
  /** Live host audio level; omit in the mock driver. */
  level?: number;
  /** Captions area, rendered under the voice line. */
  children?: ReactNode;
}) {
  return (
    <section className="room-stage fade-up" data-state={orbState}>
      <div className="room-stage-top">
        {eyebrow}
        {chip}
      </div>
      <div className="room-stage-orb">
        <GlowOrb className="room-orb" state={orbState} level={level} float />
      </div>
      <div className="room-stage-id">
        <div className="room-stage-name">{name}</div>
        <div className="room-stage-role text-muted">{role}</div>
        <div className="room-stage-voice">
          <VoiceBars level={level} active={orbState === "speaking"} />
        </div>
      </div>
      {children}
    </section>
  );
}

export type TileCameraStatus =
  | "idle"
  | "starting"
  | "on"
  | "denied"
  | "unavailable"
  | "off";

/**
 * The student's own tile: avatar that rings with their voice, mic meter,
 * and (when the assignment uses the camera) a small mirrored self-view with
 * a quiet "camera on" dot. The video never leaves the browser. A warning
 * sign appears on the self-view only on reasonable suspicion (see
 * `lib/integrity/live-warning.ts`).
 */
export function StudentTile({
  eyebrow,
  chip,
  initial,
  name,
  status,
  level,
  speaking,
  muted,
  cameraStatus,
  cameraLabel,
  trackingLabel,
  trackingTone = "muted",
  warning,
  debugLine,
  videoRef,
  overlay,
}: {
  eyebrow: ReactNode;
  chip: ReactNode;
  initial: string;
  name: string;
  status: string;
  /** Live mic level; omit in the mock driver. */
  level?: number;
  speaking: boolean;
  muted: boolean;
  /** Omit when the camera is not part of this interview. */
  cameraStatus?: TileCameraStatus;
  cameraLabel?: string;
  /** Short line under the self-view: "presence detection active" / "not available". */
  trackingLabel?: string;
  trackingTone?: "ok" | "muted" | "warn";
  /** Warning text shown on the self-view; null / omitted = no sign. */
  warning?: string | null;
  /** Raw detector readings under the self-view (tuning only). */
  debugLine?: string;
  videoRef?: (el: HTMLVideoElement | null) => void;
  /** Extra labels drawn on the self-view (forest theme only). */
  overlay?: ReactNode;
}) {
  const showWarning = cameraStatus === "on" && !!warning;
  const ring = muted
    ? 0
    : level === undefined
      ? speaking
        ? 0.6
        : 0
      : clamp01(level * 4);
  return (
    <section
      className="room-tile room-student fade-up"
      data-active={speaking && !muted ? "true" : undefined}
      data-muted={muted ? "true" : undefined}
      style={
        { "--lvl": ring.toFixed(3), animationDelay: "0.08s" } as CSSProperties
      }
    >
      <div className="room-tile-top">
        {eyebrow}
        {chip}
      </div>
      <div className="room-student-body">
        {cameraStatus !== undefined ? (
          <div
            className="room-cam-wrap"
            data-on={cameraStatus === "on" ? "true" : undefined}
            data-warn={showWarning ? "true" : undefined}
            aria-label={cameraStatus === "on" ? cameraLabel : undefined}
          >
            <video
              ref={videoRef}
              className="room-cam"
              autoPlay
              muted
              playsInline
            />
            {cameraStatus !== "on" ? (
              <div className="room-cam-fallback room-avatar" aria-hidden>
                <span>{initial}</span>
              </div>
            ) : (
              <span className="room-cam-dot" title={cameraLabel} aria-hidden />
            )}
            {overlay}
            {showWarning ? (
              <div key={warning} className="room-cam-warn" role="status">
                <AlertIcon size={14} aria-hidden />
                <span>{warning}</span>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="room-avatar">
            <span>{initial}</span>
          </div>
        )}
        {cameraStatus !== undefined && trackingLabel ? (
          <div className="room-cam-tracking" data-tone={trackingTone} role="status">
            <span className="room-cam-tracking-dot" aria-hidden />
            {trackingLabel}
          </div>
        ) : null}
        {cameraStatus !== undefined && debugLine ? (
          <div className="room-cam-debug" dir="ltr">
            {debugLine}
          </div>
        ) : null}
        <div className="room-student-name">{name}</div>
        <div className="room-student-status text-muted">{status}</div>
      </div>
      <VoiceBars
        className="room-student-bars"
        variant="pink"
        level={level}
        active={!muted && (level === undefined ? speaking : true)}
      />
    </section>
  );
}

/** "Question 2 / 5" as a segmented rail plus the topic on the table. */
export function QuestionProgress({
  title,
  current,
  total,
  allDone,
  topicLabel,
  topic,
  hint,
}: {
  title: string;
  /** 1-based. */
  current: number;
  total: number;
  allDone: boolean;
  topicLabel: string;
  topic?: string;
  hint?: ReactNode;
}) {
  return (
    <section
      className="room-tile fade-up"
      style={{ animationDelay: "0.16s" }}
    >
      <div className="room-progress-title">{title}</div>
      <div
        className="room-progress"
        role="progressbar"
        aria-label={title}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={current}
      >
        {Array.from({ length: total }, (_, i) => (
          <i
            key={i}
            className={
              allDone || i < current - 1
                ? "done"
                : i === current - 1
                  ? "current"
                  : undefined
            }
          />
        ))}
      </div>
      {topic ? (
        <div className="room-topic">
          <div className="room-topic-label">{topicLabel}</div>
          <div className="room-topic-text">{topic}</div>
        </div>
      ) : null}
      {hint ? <div className="room-hint">{hint}</div> : null}
    </section>
  );
}

/** One host turn in the live captions panel. */
export function TranscriptBubble({
  text,
  isLive,
  hostLabel,
}: {
  text: string;
  isLive: boolean;
  hostLabel: string;
}) {
  return (
    <div className="room-line" data-live={isLive ? "true" : undefined}>
      <span className="room-line-dot" aria-hidden />
      <div className="room-line-text">
        <span className="sr-only">{hostLabel}: </span>
        {text || "…"}
      </div>
    </div>
  );
}

/* ---- Forest theme pieces ----
   Only the forest room renders these. They are stateless: the camera
   <video>, the audio element and every handler stay in the shared tree. */

export type ForestTone = "on" | "busy" | "off" | "rec" | "warn";

/** One host line from the live captions, as the forest room lists it. */
export interface ForestLine {
  id: string;
  text: string;
}

// Big-text step by length, so a long host turn still fits its column.
function textSize(text: string): "l" | "m" | "s" | "xs" {
  const n = text.length;
  if (n <= 90) return "l";
  if (n <= 170) return "m";
  if (n <= 280) return "s";
  return "xs";
}

/**
 * The question column: Aria's state, the question number, what she is
 * saying now (or the question on the table) in large type, the student's
 * mic line and, in live sessions, her earlier lines.
 */
export function ForestStage({
  status,
  statusTone,
  extraChip,
  questionLabel,
  text,
  textDir,
  textMuted,
  hint,
  listenLabel,
  listenTone,
  bars,
  transcript,
  transcriptRef,
}: {
  status: string;
  statusTone: ForestTone;
  extraChip?: ReactNode;
  questionLabel: string;
  text: string;
  textDir?: "rtl" | "ltr" | "auto";
  /** Placeholder copy (nothing said yet) is drawn smaller and muted. */
  textMuted?: boolean;
  hint: string;
  listenLabel: string;
  listenTone: ForestTone;
  bars: ReactNode;
  /** Live sessions only: the collapsible list of earlier host lines. */
  transcript?: {
    title: string;
    open: boolean;
    onToggle: () => void;
    lines: ForestLine[];
    empty: string;
    hostName: string;
    hostInitial: string;
    label: string;
  };
  /** The auto-scrolled list element (live captions). */
  transcriptRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div className="fr-stage">
      <div className="fr-stage-top">
        <span className="fr-status" data-tone={statusTone}>
          <span className="fr-dot" aria-hidden />
          {status}
        </span>
        {extraChip}
      </div>
      <div className="fr-qnum">{questionLabel}</div>
      <div className="fr-question-wrap">
        <p
          className="fr-question"
          data-size={textSize(text)}
          data-muted={textMuted ? "true" : undefined}
          dir={textDir}
        >
          {text}
        </p>
      </div>
      <p className="fr-hint">{hint}</p>
      <div className="fr-listen" data-tone={listenTone}>
        <span className="fr-listen-label">{listenLabel}</span>
        {bars}
      </div>
      {transcript ? (
        <div className="fr-transcript" data-open={transcript.open ? "true" : undefined}>
          <button
            type="button"
            className="fr-transcript-toggle"
            aria-expanded={transcript.open}
            aria-controls="fr-transcript-list"
            onClick={transcript.onToggle}
          >
            <span>{transcript.title}</span>
            <ChevronIcon size={18} aria-hidden />
          </button>
          <div
            id="fr-transcript-list"
            ref={transcriptRef}
            className="fr-transcript-scroll"
            hidden={!transcript.open}
            dir={textDir}
            aria-label={transcript.label}
          >
            {transcript.lines.length === 0 ? (
              <div className="fr-transcript-empty">{transcript.empty}</div>
            ) : (
              transcript.lines.map((line) => (
                <div key={line.id} className="fr-line">
                  <span className="fr-line-avatar" aria-hidden>
                    {transcript.hostInitial}
                  </span>
                  <div className="fr-line-body">
                    <div className="fr-line-name">{transcript.hostName}</div>
                    <div className="fr-line-text">{line.text}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Numbered progress: a check for done questions, numbers only otherwise. */
export function ForestProgress({
  heading,
  countLabel,
  current,
  total,
  allDone,
}: {
  heading: string;
  countLabel: string;
  /** 1-based. */
  current: number;
  total: number;
  allDone: boolean;
}) {
  const stateOf = (i: number) =>
    allDone || i < current - 1 ? "done" : i === current - 1 ? "current" : "todo";
  return (
    <section className="fr-progress">
      <div className="fr-progress-head">
        <span className="fr-progress-title">{heading}</span>
        <span className="fr-progress-count">{countLabel}</span>
      </div>
      <div
        className="fr-steps"
        role="progressbar"
        aria-label={countLabel}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={current}
      >
        {Array.from({ length: total }, (_, i) => {
          const state = stateOf(i);
          return (
            <span key={i} className="fr-step-wrap" aria-hidden>
              {i > 0 ? (
                <span
                  className="fr-conn"
                  data-done={stateOf(i - 1) === "done" ? "true" : undefined}
                />
              ) : null}
              <span className="fr-step" data-state={state}>
                {state === "done" ? <CheckIcon size={16} /> : i + 1}
              </span>
            </span>
          );
        })}
      </div>
    </section>
  );
}

/** The exam-monitoring notice as a quiet row (forest side column). */
export function ForestIntegrity({
  title,
  body,
  count,
  countWarn,
  sync,
  syncLabel,
}: {
  title: string;
  body: string;
  count?: string;
  countWarn?: boolean;
  sync: string;
  syncLabel: string;
}) {
  return (
    <section className="fr-integrity">
      <InfoIcon size={22} aria-hidden className="fr-integrity-icon" />
      <div className="fr-integrity-main">
        <div className="fr-integrity-title">
          <span>{title}</span>
          <span className="fr-sync" data-sync={sync} aria-hidden />
          <span className="sr-only">{syncLabel}</span>
        </div>
        <div className="fr-integrity-body">{body}</div>
        {count ? (
          <div className="fr-integrity-count" data-warn={countWarn ? "true" : undefined}>
            {count}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** Spinner shown in the wrap-up overlay while the session closes. */
export function Spinner({ forest }: { forest?: boolean } = {}) {
  if (forest) return <span aria-hidden className="fr-spinner" />;
  return (
    <span
      aria-hidden
      style={{
        width: 28,
        height: 28,
        borderRadius: "50%",
        border: "3px solid rgba(56,189,248,0.25)",
        borderTopColor: "#38BDF8",
        display: "inline-block",
        animation: "spin 0.9s linear infinite",
      }}
    />
  );
}
