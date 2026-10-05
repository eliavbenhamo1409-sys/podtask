import { cn } from "@/lib/utils";
import type { CSSProperties } from "react";

export type OrbState = "idle" | "listening" | "speaking" | "thinking";

interface GlowOrbProps {
  /** Diameter in px. Omit to size the orb from CSS (`--orb-size` on a class). */
  size?: number;
  className?: string;
  /** Legacy pacing knob: 8 is the default tempo, larger is calmer. */
  spinDuration?: number;
  float?: boolean;
  /** Applied to the root; use it for positioning. */
  style?: CSSProperties;
  state?: OrbState;
  /**
   * Live audio level (0..1, raw analyser RMS). When omitted while speaking,
   * the orb animates a synthetic voice on its own.
   */
  level?: number;
}

/**
 * Aria's orb, the face of the brand: liquid light inside a glass sphere.
 *
 * Layers (bottom to top): breathing aura, ripple rings, the sphere (colour
 * fields drifting inside a circular clip, a voice-reactive inner glow, the
 * glass shell), a thin iridescent halo ring and the "thinking" comet.
 * Everything scales from `--orb-size`; only `rotate`, `scale`, `translate`
 * and `opacity` are animated, so every layer stays on the compositor.
 * Hook-free on purpose: server components render it too.
 */
export function GlowOrb({
  size,
  className,
  spinDuration = 8,
  float = false,
  style,
  state = "idle",
  level,
}: GlowOrbProps) {
  const vars: Record<string, string> = {
    "--orb-tempo": (spinDuration / 8).toFixed(3),
  };
  if (size !== undefined) vars["--orb-size"] = `${size}px`;
  const auto = level === undefined;
  if (!auto) {
    vars["--orb-level"] = Math.max(0, Math.min(1, level * 3.2)).toFixed(3);
  }

  return (
    <div
      aria-hidden
      className={cn("orb", className)}
      data-state={state}
      data-float={float ? "true" : undefined}
      data-auto={auto ? "true" : undefined}
      style={{ ...(vars as CSSProperties), ...style }}
    >
      <span className="orb-aura" />
      <span className="orb-rings">
        <i />
        <i />
        <i />
      </span>
      <span className="orb-core">
        <span className="orb-body">
          <i />
          <i />
          <i />
          <i />
          <i className="orb-streak" />
          <i className="orb-glow" />
        </span>
        <span className="orb-shell" />
      </span>
      <span className="orb-rim" />
      <span className="orb-comet" />
    </div>
  );
}
