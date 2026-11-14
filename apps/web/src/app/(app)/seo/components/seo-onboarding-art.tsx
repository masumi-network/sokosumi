"use client";

import { motion, useReducedMotion } from "motion/react";

/** The app's strong ease-out curve: a quick start that settles. */
const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const LINE_SECONDS = 0.9;
const BADGE_SECONDS = 0.3;
/** The scale an entering mark starts from. */
const BADGE_FROM_SCALE = 0.25;

/**
 * A search result above a ranking line that climbs to first place. Decoration only.
 * The line draws once and the badge lands at its end; reduced motion shows the end state.
 */
export function SeoOnboardingArt() {
  const still = useReducedMotion();
  return (
    <svg
      viewBox="0 0 280 240"
      className="h-auto w-full max-w-64"
      aria-hidden
      focusable="false"
    >
      <rect
        x="20"
        y="24"
        width="240"
        height="96"
        rx="12"
        className="fill-card stroke-border"
      />
      <circle cx="42" cy="48" r="7" className="fill-muted" />
      <rect x="56" y="44" width="84" height="8" rx="4" className="fill-muted" />
      <rect
        x="34"
        y="66"
        width="156"
        height="10"
        rx="5"
        className="fill-quaternary"
      />
      <rect
        x="34"
        y="86"
        width="208"
        height="6"
        rx="3"
        className="fill-muted"
      />
      <rect
        x="34"
        y="100"
        width="164"
        height="6"
        rx="3"
        className="fill-muted"
      />
      <rect
        x="20"
        y="136"
        width="240"
        height="88"
        rx="12"
        className="fill-card stroke-border"
      />
      {[164, 188, 212].map((y) => (
        <line
          key={y}
          x1="34"
          x2="246"
          y1={y}
          y2={y}
          className="stroke-border"
          strokeDasharray="2 4"
        />
      ))}
      <motion.polyline
        points="36,212 76,204 112,208 152,186 192,178 226,158"
        fill="none"
        className="stroke-foreground"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={still ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: LINE_SECONDS, ease: EASE_OUT }}
      />
      <motion.g
        initial={still ? false : { opacity: 0, scale: BADGE_FROM_SCALE }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{
          type: "spring",
          duration: BADGE_SECONDS,
          bounce: 0,
          delay: LINE_SECONDS,
        }}
        // Scale around the badge's own centre, not the drawing's corner.
        style={{ transformBox: "fill-box", transformOrigin: "center" }}
      >
        <circle
          cx="230"
          cy="154"
          r="16"
          className="fill-foreground stroke-card"
          strokeWidth="2"
        />
        <text
          x="230"
          y="158"
          textAnchor="middle"
          className="fill-background text-xs font-semibold"
        >
          #1
        </text>
      </motion.g>
    </svg>
  );
}
