/**
 * Hook-free presentational pieces of the live interview room, split out of
 * `interview-client.tsx` so the room component is only the stateful part.
 */

/** One host turn in the live transcript panel. */
export function TranscriptBubble({
  text,
  isLive,
  hostLabel,
}: {
  text: string;
  isLive: boolean;
  hostLabel: string;
}) {
  const accentColor = "#0EA5E9";
  const bubbleBg = "rgba(14,165,233,0.06)";
  const bubbleBorder = "rgba(14,165,233,0.18)";
  const labelBg = "rgba(14,165,233,0.10)";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        columnGap: 12,
        alignItems: "start",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: accentColor,
          padding: "4px 10px",
          borderRadius: 999,
          background: labelBg,
          whiteSpace: "nowrap",
          alignSelf: "start",
          marginTop: 4,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {hostLabel}
        {isLive ? (
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: accentColor,
              boxShadow: `0 0 6px ${accentColor}`,
              animation: "pulse 1.1s ease-in-out infinite",
            }}
          />
        ) : null}
      </div>
      <div
        style={{
          fontSize: 16,
          lineHeight: 1.6,
          fontWeight: 500,
          color: "rgb(var(--ink))",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          padding: "10px 14px",
          borderRadius: 14,
          background: bubbleBg,
          border: `1px solid ${bubbleBorder}`,
        }}
      >
        {text || "…"}
      </div>
    </div>
  );
}

/** Maps 0..1 audio levels to the extra glow radius (px) of each card. */
export function makeHalo(hostLevel: number, userLevel: number) {
  return {
    host: Math.min(Math.round(hostLevel * 70), 70),
    user: Math.min(Math.round(userLevel * 70), 70),
  };
}

/** Thin horizontal meter for the student's mic level while idle. */
export function LevelBar({
  level,
  variant,
}: {
  level: number;
  variant: "cyan" | "pink";
}) {
  const fill = Math.min(1, Math.max(0, level * 4));
  const color = variant === "pink" ? "#FB7185" : "#38BDF8";
  return (
    <div
      aria-hidden
      style={{
        width: 120,
        height: 4,
        borderRadius: 2,
        background: "rgba(148,163,184,0.18)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${fill * 100}%`,
          height: "100%",
          background: color,
          transition: "width .12s linear",
        }}
      />
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
