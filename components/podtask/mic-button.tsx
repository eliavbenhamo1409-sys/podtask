"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface MicButtonProps {
  recording?: boolean;
  size?: number;
  onClick?: () => void;
  children: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}

export function MicButton({
  recording = false,
  size = 88,
  onClick,
  children,
  ariaLabel,
  disabled,
  className,
}: MicButtonProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={recording}
      onClick={onClick}
      disabled={disabled}
      className={cn("mic-btn", recording && "recording", className)}
      style={{ width: size, height: size }}
    >
      {children}
    </button>
  );
}
