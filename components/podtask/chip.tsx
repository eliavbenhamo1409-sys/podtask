import type { ReactNode, ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type ChipVariant = "default" | "cyan" | "pink" | "active";

interface ChipProps {
  variant?: ChipVariant;
  children: ReactNode;
  className?: string;
  asButton?: boolean;
  onClick?: () => void;
  ariaPressed?: boolean;
}

const variantClass: Record<ChipVariant, string> = {
  default: "",
  cyan: "chip-cyan",
  pink: "chip-pink",
  active: "chip-active",
};

export function Chip({
  variant = "default",
  children,
  className,
  asButton,
  onClick,
  ariaPressed,
}: ChipProps) {
  if (asButton) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={ariaPressed}
        className={cn("chip", variantClass[variant], className)}
      >
        {children}
      </button>
    );
  }
  return (
    <span className={cn("chip", variantClass[variant], className)}>
      {children}
    </span>
  );
}

type BadgeVariant = "cyan" | "pink" | "mint" | "amber" | "neutral";

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  showDot?: boolean;
  className?: string;
}

const badgeClass: Record<BadgeVariant, string> = {
  cyan: "badge-cyan",
  pink: "badge-pink",
  mint: "badge-mint",
  amber: "badge-amber",
  neutral: "badge-neutral",
};

export function Badge({
  variant = "neutral",
  children,
  showDot,
  className,
}: BadgeProps) {
  return (
    <span className={cn("badge", badgeClass[variant], className)}>
      {showDot && <span className="dot" />}
      {children}
    </span>
  );
}
