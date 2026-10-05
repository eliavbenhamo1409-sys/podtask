/**
 * Hook-free presentational pieces of the live interview room, split out of
 * `interview-client.tsx` so the room component is only the stateful part.
 * Styling lives under "Interview room" in `styles/globals.css`; everything
 * here just maps props to data-attributes and CSS variables.
 */
import type { CSSProperties, ReactNode } from "react";
import { GlowOrb, type OrbState } from "@/components/podtask/glow-orb";

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

/** The student's own tile: avatar that rings with their voice, mic meter. */
export function StudentTile({
  eyebrow,
  chip,
  initial,
  name,
  status,
  level,
  speaking,
  muted,
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
}) {
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
        <div className="room-avatar">
          <span>{initial}</span>
        </div>
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

/** Spinner shown in the wrap-up overlay while the session closes. */
export function Spinner() {
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
