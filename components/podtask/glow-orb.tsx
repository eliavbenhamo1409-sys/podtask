import { cn } from "@/lib/utils";
import type { CSSProperties } from "react";

interface GlowOrbProps {
  size?: number;
  className?: string;
  spinDuration?: number;
  float?: boolean;
  style?: CSSProperties;
}

/**
 * The host orb. `spin` and `float` both animate `transform`, so they live on
 * two elements: the orb spins, an optional wrapper floats. `style` is applied
 * to the outermost element (use it for positioning).
 */
export function GlowOrb({
  size = 140,
  className,
  spinDuration = 8,
  float = false,
  style,
}: GlowOrbProps) {
  const orb = (
    <div
      aria-hidden
      className={cn("glow-orb", className)}
      style={{
        width: size,
        height: size,
        animation: `spin ${spinDuration}s linear infinite`,
        ...(float ? undefined : style),
      }}
    />
  );
  if (!float) return orb;
  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        animation: "float 4s ease-in-out infinite",
        ...style,
      }}
    >
      {orb}
    </div>
  );
}
