"use client";

import { useRef } from "react";
import type { OrbState } from "thinking-orbs";

import { useThinkingOrbCanvas } from "@/hooks/effects/use-thinking-orb-canvas";
import { cn } from "@/lib/utils";

/** Brand primary: fallback when the CSS variable can't be resolved. */
const FALLBACK_PRIMARY = "#ff51ff";

/**
 * The chat's thinking animation: a thinking-orbs state painted in the brand
 * primary. Stands in for the assistant's avatar while a turn runs. Decorative
 * (aria-hidden); under prefers-reduced-motion it paints one static frame.
 */
export function ThinkingOrb({
  size = 32,
  state = "solving",
  className,
}: {
  size?: number;
  state?: OrbState;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useThinkingOrbCanvas(canvasRef, {
    size,
    state,
    fallbackColor: FALLBACK_PRIMARY,
  });

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{ width: size, height: size }}
      className={cn("shrink-0", className)}
    />
  );
}
