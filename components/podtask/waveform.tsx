import { cn } from "@/lib/utils";

interface WaveformProps {
  variant?: "cyan" | "pink";
  className?: string;
  bars?: number;
}

export function Waveform({
  variant = "cyan",
  className,
  bars = 9,
}: WaveformProps) {
  return (
    <span className={cn("wave", variant === "pink" && "pink", className)}>
      {Array.from({ length: bars }).map((_, i) => (
        <span key={i} />
      ))}
    </span>
  );
}
