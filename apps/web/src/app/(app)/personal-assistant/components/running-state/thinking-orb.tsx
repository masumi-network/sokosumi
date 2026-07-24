"use client";

import { useEffect, useRef } from "react";
import { MODE_DRAWS, type OrbState, resolvePreset } from "thinking-orbs";

import { cn } from "@/lib/utils";

/** Brand wisteria — fallback when the CSS variable can't be resolved. */
const FALLBACK_PURPLE = "#6400ff";

/** Resolve the theme's primary colour for canvas use. Modern canvases accept
 * any CSS color string, so the raw var value works as a fillStyle. */
function resolvePrimary(): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--primary")
    .trim();
  return value || FALLBACK_PURPLE;
}

/**
 * The chat's thinking animation: a thinking-orbs state rendered in the
 * brand primary purple — dots only, no face. Sits inline next to the
 * rotating "Thinking…" phrase, replacing the three pulsing dots.
 *
 * Decorative (aria-hidden): the surrounding text carries the meaning.
 * One rAF loop — only ever one instance on screen (the active indicator).
 */
export function ThinkingOrb({
  size = 20,
  state = "solving",
  className,
}: {
  size?: 64 | 20;
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
    canvas.width = size * dpr;
    canvas.height = size * dpr;

    const { mode, speed, opts } = resolvePreset(state, size);
    const purple = resolvePrimary();

    let raf = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const seconds = (now - started) / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      // Theme-agnostic: the purple fill below replaces the painter's ink
      // either way, so `dark` only affects intermediate alpha ramps.
      MODE_DRAWS[mode](ctx, size, seconds * speed, false, opts);
      ctx.globalCompositeOperation = "source-in";
      ctx.fillStyle = purple;
      ctx.fillRect(0, 0, size, size);
      ctx.globalCompositeOperation = "source-over";
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
