import { cn } from "@/lib/utils";
import type { CSSProperties } from "react";

interface GlowOrbProps {
  size?: number;
  className?: string;
  spinDuration?: number;
  float?: boolean;
  style?: CSSProperties;
}

export function GlowOrb({
  size = 140,
  className,
  spinDuration = 8,
  float = false,
  style,
}: GlowOrbProps) {
  const animation = float
    ? `spin ${spinDuration}s linear infinite, float 4s ease-in-out infinite`
    : `spin ${spinDuration}s linear infinite`;

  return (
    <div
      aria-hidden
      className={cn("glow-orb", className)}
      style={{ width: size, height: size, animation, ...style }}
    />
  );
}
