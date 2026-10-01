"use client";

import { motion, useReducedMotion } from "framer-motion";

const COLORS = ["#38BDF8", "#FDA4AF", "#7DD3FC", "#FB7185", "#0EA5E9"];
const COUNT = 18;

// Deterministic geometry (no Math.random) so server and client agree.
const PIECES = Array.from({ length: COUNT }, (_, i) => {
  const angle = (i / COUNT) * Math.PI * 2 - Math.PI / 2;
  const dist = 96 + (i % 3) * 26;
  return {
    x: Math.round(Math.cos(angle) * dist),
    y: Math.round(Math.sin(angle) * dist),
    size: 6 + (i % 4) * 2,
    color: COLORS[i % COLORS.length],
    delay: (i % 5) * 0.045,
    rotate: 120 + (i % 4) * 60,
  };
});

/**
 * One-shot celebratory burst for the completion screen. Pure framer-motion,
 * no dependency; skipped entirely when the OS asks for reduced motion.
 */
export function ConfettiBurst() {
  const reduce = useReducedMotion();
  if (reduce) return null;
  return (
    <div
      aria-hidden
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      {PIECES.map((p, i) => (
        <motion.span
          key={i}
          initial={{ x: 0, y: 0, opacity: 0, scale: 0.4, rotate: 0 }}
          animate={{
            x: p.x,
            y: p.y,
            opacity: [0, 1, 1, 0],
            scale: [0.4, 1, 1, 0.5],
            rotate: p.rotate,
          }}
          transition={{
            duration: 1.4,
            delay: 0.4 + p.delay,
            ease: [0.2, 0.8, 0.2, 1],
          }}
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: p.size,
            height: p.size * 1.5,
            marginLeft: -p.size / 2,
            marginTop: -p.size / 2,
            borderRadius: 2,
            background: p.color,
          }}
        />
      ))}
    </div>
  );
}
