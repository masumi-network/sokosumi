"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

/** How Cuso moves when a step opens; each step gets its own. */
export type CusoMood = "wave" | "think" | "point" | "cheer";

const MOODS: Record<
  CusoMood,
  { rotate: number[]; y: number[]; x: number[]; repeat: boolean }
> = {
  // A hello: a quick tilt back and forth.
  wave: {
    rotate: [0, -14, 10, -8, 0],
    y: [0, -4, 0, -2, 0],
    x: [0],
    repeat: false,
  },
  // Working it out: a slow sway that keeps going while he writes.
  think: {
    rotate: [0, 6, 0, -6, 0],
    y: [0, -2, 0, -2, 0],
    x: [0],
    repeat: true,
  },
  // Look here: a nudge toward the button.
  point: {
    rotate: [0, 12, 0, 12, 0],
    y: [0],
    x: [0, 6, 0, 6, 0],
    repeat: false,
  },
  // Done: a hop.
  cheer: {
    rotate: [0, -8, 8, 0],
    y: [0, -14, 0, -6, 0],
    x: [0],
    repeat: false,
  },
};

/**
 * The top of each setup step: Cuso says what he did and what the founder
 * decides here, with the one button that approves the step. It stays in
 * view while the founder scrolls, so the decision is never far away.
 */
export function StepHead({
  step,
  title,
  mood,
  busy = false,
  say,
  note,
  action,
}: {
  /** Its place in the seven setup steps, from 1. */
  step: number;
  title: string;
  mood: CusoMood;
  /** Cuso is still working: he keeps thinking. */
  busy?: boolean;
  say: ReactNode;
  /** A short status under the button, such as a change in progress. */
  note?: ReactNode;
  action?: ReactNode;
}) {
  const reduce = useReducedMotion();
  const move = MOODS[busy ? "think" : mood];
  return (
    <div className="ob-head">
      <div className="ob-head-cuso">
        <motion.img
          className="ob-head-mascot"
          src="/mascot.webp"
          alt=""
          width={60}
          height={60}
          animate={
            reduce ? undefined : { rotate: move.rotate, y: move.y, x: move.x }
          }
          transition={{
            duration: busy ? 3 : 1.2,
            delay: 0.2,
            ease: "easeInOut",
            repeat: move.repeat || busy ? Number.POSITIVE_INFINITY : 0,
          }}
        />
        <motion.div
          className="ob-bubble"
          initial={reduce ? false : { opacity: 0, x: -8, scale: 0.98 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          transition={{ duration: 0.35, delay: 0.1, ease: [0.25, 1, 0.5, 1] }}
        >
          <p className="ob-head-step">
            Step {step} of 8 · {title}
          </p>
          <p className="ob-head-say">{say}</p>
        </motion.div>
      </div>
      {action ? (
        <div className="ob-head-action">
          {action}
          {note ? <p className="ob-head-note">{note}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
