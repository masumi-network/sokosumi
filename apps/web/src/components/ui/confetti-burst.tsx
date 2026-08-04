"use client";

import { motion } from "motion/react";
import type { CSSProperties } from "react";

interface ConfettiParticle {
  x: number;
  y: number;
  c: string;
  s: number;
}

// Deterministic (no hydration jitter) — shared by any "something just
// succeeded" celebration moment (task creation, purchase success, …) so they
// all read as the same brand gesture.
export const CONFETTI_PARTICLES: ConfettiParticle[] = [
  { x: -34, y: -30, c: "#6400FF", s: 6 },
  { x: -14, y: -44, c: "#00a4fa", s: 5 },
  { x: 10, y: -46, c: "#fa008c", s: 6 },
  { x: 30, y: -34, c: "#ffd300", s: 5 },
  { x: -40, y: -8, c: "#0afa14", s: 5 },
  { x: 40, y: -10, c: "#ff6400", s: 6 },
  { x: -22, y: -52, c: "#6400FF", s: 4 },
  { x: 22, y: -52, c: "#00a4fa", s: 4 },
  { x: 0, y: -56, c: "#fa008c", s: 5 },
];

interface ConfettiBurstProps {
  className?: string;
  style?: CSSProperties;
  delay?: number;
}

/** A short deterministic confetti burst. Caller decides whether to render it
 * at all under `useReducedMotion()` — this component has no motion opt-out
 * of its own, matching how `TaskCreatedCelebration` gates its celebration. */
export function ConfettiBurst({
  className,
  style,
  delay = 0.42,
}: ConfettiBurstProps) {
  return (
    <div aria-hidden className={className} style={style}>
      {CONFETTI_PARTICLES.map((p) => (
        <motion.span
          key={`${p.c}-${p.x}-${p.y}`}
          className="absolute rounded-[2px]"
          style={{ width: p.s, height: p.s, backgroundColor: p.c }}
          initial={{ opacity: 0, x: 0, y: 0, scale: 0 }}
          animate={{
            opacity: [0, 1, 1, 0],
            x: p.x,
            y: p.y,
            scale: [0, 1, 1, 0.5],
          }}
          transition={{ duration: 0.8, delay, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}
