import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EyebrowProps {
  children: ReactNode;
  icon?: ReactNode;
  showDot?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function Eyebrow({
  children,
  icon,
  showDot,
  className,
  style,
}: EyebrowProps) {
  return (
    <div className={cn("eyebrow", className)} style={style}>
      {showDot && <span className="dot" />}
      {icon}
      {children}
    </div>
  );
}
