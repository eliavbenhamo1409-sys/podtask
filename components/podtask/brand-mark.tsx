"use client";

import Image from "next/image";
import { useTheme } from "@/components/providers/theme-provider";
import { cn } from "@/lib/utils";

interface BrandMarkProps {
  size?: number;
  className?: string;
}

export function BrandMark({ size = 40, className }: BrandMarkProps) {
  const { theme } = useTheme();
  if (theme === "forest") return <Wordmark size={size} className={className} />;
  return (
    <Image
      src="/podtask-logo.png"
      alt="Podtask"
      width={size}
      height={size}
      priority
      className={className}
      style={{ width: size, height: size, objectFit: "contain" }}
    />
  );
}

/** Typeset logo: "Podtask" with a small sound-wave mark (forest theme).
 *  `size` keeps the same meaning as the square raster logo, so every call
 *  site scales sensibly: 56 in the top bar reads as ~28px type. */
function Wordmark({ size, className }: { size: number; className?: string }) {
  const fontSize = Math.max(20, Math.round(size * 0.5));
  return (
    <span
      className={cn("wordmark", className)}
      style={{ "--wm-size": `${fontSize}px` } as React.CSSProperties}
      dir="ltr"
      role="img"
      aria-label="Podtask"
    >
      <span className="wordmark-text" aria-hidden>
        Podtask
      </span>
      <svg className="wordmark-wave" viewBox="0 0 26 28" aria-hidden>
        {[
          [1, 9],
          [5.5, 16],
          [10, 26],
          [14.5, 13],
          [19, 21],
          [23.5, 10],
        ].map(([x, h]) => (
          <rect key={x} x={x} y={(28 - h) / 2} width="2.4" height={h} rx="1.2" />
        ))}
      </svg>
    </span>
  );
}
