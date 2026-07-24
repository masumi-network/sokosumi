"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { OrbState } from "thinking-orbs";

import type { OrbExpression } from "@/lib/aurora-orb";
import {
  DOTTED_IDENTITY_STATE,
  dottedOrbDataURL,
  dottedPaintSize,
  drawDottedOrb,
} from "@/lib/dotted-orb";
import { cn } from "@/lib/utils";

/**
 * Tracks the app theme (Tailwind/shadcn `dark` class on <html>, OS scheme
 * fallback) — the dotted orb sits on the page background, so its gradient
 * depth and eye ink must follow the theme.
 */
export function useDarkTheme(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const resolve = () =>
      setDark(
        root.classList.contains("dark") ||
          (!root.classList.contains("light") && media.matches),
      );
    resolve();
    const observer = new MutationObserver(resolve);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    media.addEventListener("change", resolve);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", resolve);
    };
  }, []);
  return dark;
}

interface DottedOrbProps {
  seed: string;
  /** Paint resolution in px — display size comes from `className`, matching
   * the AuroraOrb convention across the app. */
  size: number;
  /** Eyes expression; null/undefined → no eyes (pure body). */
  expression?: OrbExpression | null;
  /**
   * Live canvas with a slow rotation + blink/gaze (one rAF loop). Reserve
   * for the few "alive" surfaces (sidenav, thinking states); everywhere
   * else the static frame keeps the page cheap.
   */
  animate?: boolean;
  /** Activity painter — defaults to the resting identity globe. */
  state?: OrbState;
  /** Animation speed multiplier (animate only). */
  speed?: number;
  alt?: string;
  className?: string;
}

/**
 * The personal assistant's dotted identity orb — the standard assistant
 * picture everywhere (chat, task comments, sidenav, landing). Same palette
 * material as the classic discs, sampled into thinking-orbs particles, so
 * the resting avatar and the activity states share one visual language.
 */
export function DottedOrb({
  seed,
  size,
  expression = null,
  animate = false,
  state = DOTTED_IDENTITY_STATE,
  speed = 1,
  alt = "",
  className,
}: DottedOrbProps) {
  const dark = useDarkTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Static path: one offscreen render to a data URL (2x for crispness).
  const staticSrc = useMemo(
    () =>
      mounted && !animate
        ? dottedOrbDataURL(seed, size, { dark, expression, state })
        : null,
    [mounted, animate, seed, size, dark, expression, state],
  );

  // Animated path: slow rotation with the shared blink/gaze life.
  useEffect(() => {
    if (!animate) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const paintSize = dottedPaintSize(size);
    canvas.width = paintSize * dpr;
    canvas.height = paintSize * dpr;

    let raf = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const seconds = (now - started) / 1000;
      const blinkPhase = (seconds % 3.6) / 0.16;
      const blink =
        blinkPhase < 1 ? Math.abs(Math.sin(blinkPhase * Math.PI)) : 0;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawDottedOrb(ctx, paintSize, seed, {
        dark,
        expression,
        state,
        t: seconds * speed,
        eyesOpen: 1 - blink * 0.96,
        gazeX: Math.sin(seconds * 0.6) * 0.16,
        gazeY: Math.cos(seconds * 0.43) * 0.1,
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animate, seed, size, dark, expression, state, speed]);

  if (animate) {
    return (
      <canvas
        ref={canvasRef}
        // Same labelled-vs-decorative split the aurora components used:
        // an empty alt means decorative, so hide it from the a11y tree
        // instead of exposing an unnamed image.
        role={alt ? "img" : undefined}
        aria-label={alt || undefined}
        aria-hidden={alt ? undefined : true}
        className={cn("rounded-full", className)}
      />
    );
  }

  return staticSrc ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={staticSrc}
      width={size}
      height={size}
      alt={alt}
      className={cn("rounded-full", className)}
    />
  ) : (
    <span aria-hidden className={cn("inline-block rounded-full", className)} />
  );
}
