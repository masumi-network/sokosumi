"use client";

import { useEffect, useRef } from "react";
import { MODE_DRAWS, type OrbState, resolvePreset } from "thinking-orbs";

import { cn } from "@/lib/utils";

/** Brand wisteria: fallback when the CSS variable can't be resolved. */
const FALLBACK_PURPLE = "#6400ff";

function resolvePrimary(): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--primary")
    .trim();
  return value || FALLBACK_PURPLE;
}

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
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

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
  }, [size, state]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{ width: size, height: size }}
      className={cn("shrink-0", className)}
    />
  );
}
