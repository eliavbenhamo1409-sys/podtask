"use client";

import type { ReactNode } from "react";
import { MotionConfig } from "framer-motion";

/**
 * Honours the OS "reduce motion" preference for every framer-motion element
 * (CSS animations are handled by the matching media query in globals.css).
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
