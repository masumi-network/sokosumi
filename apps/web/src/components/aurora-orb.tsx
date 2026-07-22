"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  type MountHandle,
  mount,
  type OrbExpression,
  toDataURL,
} from "@/lib/aurora-orb";
import { cn } from "@/lib/utils";

export interface OrbEvent {
  expr: OrbExpression;
  nonce: number;
  ms?: number;
}

interface AuroraOrbProps {
  /** Seed string — same seed always renders the identical orb. */
  seed: string;
  /**
   * Draw resolution in px for the static PNG (and animated fallback). The
   * DISPLAY size is controlled by `className` (e.g. `size-8`, `size-20`).
   * Default 64 — fine up to ~64px display; bump for larger static orbs.
   */
  size?: number;
  /** Animate via a live canvas (one rAF loop). Use ONLY for hero orbs. */
  animate?: boolean;
  /** Animation speed multiplier (e.g. 0.5 calm, 1.5 lively). Default 1. */
  speed?: number;
  className?: string;
  /** Accessible label. Defaults to decorative (empty alt). */
  alt?: string;
  /**
   * Eyes expression (animated orbs only). Null/undefined → no eyes. Changing it
   * updates the live orb without remounting; null→set plays a "wake up".
   */
  expression?: OrbExpression | null;
  /**
   * Fire a one-shot transient expression (e.g. a wink on task-done, surprise on
   * a new message) — bump `nonce` to trigger. Animated orbs only.
   */
  event?: OrbEvent | null;
}

/**
 * Deterministic generative "aurora orb" avatar.
 *
 * - `animate` → a live `<canvas>` + rAF loop (hero/profile use only); the
 *   canvas resolution tracks its rendered size for crispness.
 * - default (static) → a cached PNG via `<img>` for lists/small/repeated
 *   avatars (the library's performance rule).
 *
 * Display size comes from `className` (so callers keep their responsive size
 * classes). Both variants are circle-clipped. SSR-safe: a neutral circular
 * placeholder renders until the browser can paint, so the first client render
 * matches the server (no hydration mismatch).
 */
export function AuroraOrb({
  seed,
  size = 64,
  animate = false,
  speed = 1,
  className,
  alt = "",
  expression = null,
  event = null,
}: AuroraOrbProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handleRef = useRef<MountHandle | null>(null);
  const expressionRef = useRef(expression);
  expressionRef.current = expression;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  useEffect(() => {
    if (!animate) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handle = mount(canvas, {
      seed,
      speed: speedRef.current,
      size,
      expression: expressionRef.current,
    });
    handleRef.current = handle;
    return () => {
      handle.stop();
      handleRef.current = null;
    };
  }, [animate, seed, size]);
  useEffect(() => {
    handleRef.current?.setExpression(expression ?? null);
  }, [expression]);
  useEffect(() => {
    handleRef.current?.setSpeed(speed);
  }, [speed]);
  const lastEventNonce = useRef(0);
  useEffect(() => {
    if (event && event.nonce !== lastEventNonce.current) {
      lastEventNonce.current = event.nonce;
      handleRef.current?.pulse(event.expr, event.ms);
    }
  }, [event]);

  const dataUrl = useMemo(
    () => (mounted && !animate ? toDataURL(seed, size, expression) : null),
    [mounted, animate, seed, size, expression],
  );

  const labelled = alt !== "";

  if (animate) {
    return (
      <canvas
        ref={canvasRef}
        className={cn("block shrink-0 rounded-full", className)}
        aria-hidden={labelled ? undefined : true}
        aria-label={labelled ? alt : undefined}
        role={labelled ? "img" : undefined}
      />
    );
  }

  if (!dataUrl) {
    // SSR / pre-paint placeholder — same circular footprint, no layout shift.
    return (
      <span
        aria-hidden
        className={cn("bg-muted block shrink-0 rounded-full", className)}
      />
    );
  }

  return (
    // Data-URL PNG (already DPR-scaled + cached) — next/image adds no value here.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={dataUrl}
      alt={alt}
      className={cn("block shrink-0 rounded-full object-cover", className)}
    />
  );
}

interface PlaceholderOrbProps {
  /** Draw resolution in px. DISPLAY size comes from `className`. Default 64. */
  size?: number;
  /** Animation speed multiplier. Default 1.2 (lively). */
  speed?: number;
  className?: string;
  /** Accessible label. Defaults to decorative (empty alt). */
  alt?: string;
  /**
   * Eyes expression. Null/undefined → no eyes. Changing it updates the live
   * orb without remounting; null→set plays the "wake up" (e.g. when the user
   * starts naming their assistant).
   */
  expression?: OrbExpression | null;
  /**
   * Fire a one-shot transient expression — bump `nonce` to trigger.
   */
  event?: OrbEvent | null;
  /**
   * Live rAF loop. Default true (hero / pre-setup). Pass false for lists —
   * draws a single static frame.
   */
  animate?: boolean;
}

/**
 * The pre-setup "placeholder" orb — a seedless mother-of-pearl sphere.
 * Shown wherever the assistant's avatar appears before the user picks their
 * committed orb (sidebar nav, landing hero); once they pick, the surface
 * swaps to their chosen `AuroraOrb`.
 *
 * Default is a live `<canvas>` + rAF loop. Pass `animate={false}` for lists.
 * Display size comes from `className`.
 */
export function PlaceholderOrb({
  size = 64,
  speed = 1.2,
  className,
  alt = "",
  expression = null,
  event = null,
  animate = true,
}: PlaceholderOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handleRef = useRef<MountHandle | null>(null);
  const expressionRef = useRef(expression);
  expressionRef.current = expression;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handle = mount(canvas, {
      placeholder: true,
      animate,
      speed: speedRef.current,
      size,
      expression: expressionRef.current,
    });
    handleRef.current = handle;
    return () => {
      handle.stop();
      handleRef.current = null;
    };
  }, [size, animate]);
  useEffect(() => {
    handleRef.current?.setExpression(expression ?? null);
  }, [expression]);
  useEffect(() => {
    handleRef.current?.setSpeed(speed);
  }, [speed]);
  const lastEventNonce = useRef(0);
  useEffect(() => {
    if (event && event.nonce !== lastEventNonce.current) {
      lastEventNonce.current = event.nonce;
      handleRef.current?.pulse(event.expr, event.ms);
    }
  }, [event]);

  const labelled = alt !== "";
  return (
    <canvas
      ref={canvasRef}
      className={cn("block shrink-0 rounded-full", className)}
      aria-hidden={labelled ? undefined : true}
      aria-label={labelled ? alt : undefined}
      role={labelled ? "img" : undefined}
    />
  );
}

interface AssistantOrbProps {
  /** The committed orb seed, or null for the white placeholder. */
  seed: string | null;
  /** Eyes expression. Null → no eyes. */
  expression?: OrbExpression | null;
  /** Fire a one-shot transient expression — bump `nonce` to trigger. */
  event?: OrbEvent | null;
  size?: number;
  speed?: number;
  className?: string;
  alt?: string;
  /**
   * Live rAF loop. Default true (PA hero / nav). Pass false for list rows —
   * static PNG when seeded, single-frame placeholder when not.
   */
  animate?: boolean;
}

/**
 * The assistant's avatar at any point in its lifecycle: the white
 * `PlaceholderOrb` when no colour has been committed (`seed === null`),
 * otherwise the chosen `AuroraOrb`. One component so every surface renders
 * the same identity + eyes. Defaults to animated; pass `animate={false}` for
 * lists and other repeated small avatars.
 */
export function AssistantOrb({
  seed,
  expression = null,
  event = null,
  size = 64,
  speed = 1.2,
  className,
  alt = "",
  animate = true,
}: AssistantOrbProps) {
  if (seed === null) {
    return (
      <PlaceholderOrb
        size={size}
        speed={speed}
        expression={expression}
        event={event}
        className={className}
        alt={alt}
        animate={animate}
      />
    );
  }
  return (
    <AuroraOrb
      seed={seed}
      animate={animate}
      size={size}
      speed={speed}
      expression={expression}
      event={event}
      className={className}
      alt={alt}
    />
  );
}
