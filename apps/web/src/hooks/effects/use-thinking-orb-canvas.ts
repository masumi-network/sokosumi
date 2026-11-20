"use client";

import { type RefObject, useEffect } from "react";
import { MODE_DRAWS, type OrbState, resolvePreset } from "thinking-orbs";

import { usePrefersReducedMotion } from "@/hooks/effects/use-media-query";

export interface UseThinkingOrbCanvasOptions {
  size: number;
  state: OrbState;
  fallbackColor: string;
}

/**
 * Paints a `thinking-orbs` animation onto `canvasRef` in the current
 * `--primary` token colour, or one static frame under reduced motion.
 */
export function useThinkingOrbCanvas(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  { size, state, fallbackColor }: UseThinkingOrbCanvasOptions,
): void {
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const paintSize = size <= 20 ? 20 : 64;
    canvas.width = paintSize * dpr;
    canvas.height = paintSize * dpr;

    const { mode, speed, opts } = resolvePreset(state, paintSize);

    const resolvePrimary = () => {
      const value = getComputedStyle(document.documentElement)
        .getPropertyValue("--primary")
        .trim();
      return value || fallbackColor;
    };

    const paint = (seconds: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, paintSize, paintSize);
      MODE_DRAWS[mode](ctx, paintSize, seconds * speed, false, opts);
      ctx.globalCompositeOperation = "source-in";
      ctx.fillStyle = resolvePrimary();
      ctx.fillRect(0, 0, paintSize, paintSize);
      ctx.globalCompositeOperation = "source-over";
    };

    if (reduceMotion) {
      paint(0);
      return;
    }

    let raf = 0;
    const started = performance.now();
    const tick = (now: number) => {
      paint((now - started) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [canvasRef, fallbackColor, reduceMotion, size, state]);
}
