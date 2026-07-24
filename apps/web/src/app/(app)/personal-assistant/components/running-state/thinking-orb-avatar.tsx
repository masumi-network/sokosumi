"use client";

import { useTranslations } from "next-intl";
import { useContext, useEffect, useRef, useState } from "react";
import { MODE_DRAWS, type OrbState, resolvePreset } from "thinking-orbs";

import { draw, drawEyes, type OrbExpression, params } from "@/lib/aurora-orb";
import { cn } from "@/lib/utils";

import {
  AssistantMotionContext,
  AssistantSeedContext,
} from "./assistant-context";

/** Internal paint size — the thinking-orbs 64px preset is its chat-avatar
 * tuning; we render at 64 and let CSS scale down to the avatar slot. */
const PAINT_SIZE = 64;
/** Seconds for the solid body to dissolve into dots after mount. */
const DISSOLVE_SECONDS = 0.6;

/**
 * Tracks the app theme the same way thinking-orbs does: the Tailwind/shadcn
 * `dark` class on an ancestor of <html>, falling back to the OS scheme.
 * Needed because the dots-phase eyes sit over the page background, where
 * the palette's (light-body-tuned) ink would vanish in dark mode.
 */
function useDarkTheme(): boolean {
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

/**
 * The assistant's avatar dissolved into a thinking-orbs activity state:
 * on mount the solid aurora body melts into dots filled with the body's
 * own radial gradient (one material, sampled into particles) while the
 * eyes stay on top — so the creature visibly *becomes* its thinking state
 * instead of a spinner appearing next to it. Replaces the old ping-ring +
 * pulsing-dots treatments across the personal assistant chat.
 *
 * Renders a live canvas (one rAF loop) — use for the single active
 * indicator/streaming avatar, not for every message row.
 */
export function ThinkingOrbAvatar({
  state,
  expression,
  accent = false,
  className,
}: {
  /** thinking-orbs activity: working | searching | solving | listening | composing | shaping */
  state: OrbState;
  /** Eyes while in this state — defaults to the personality's resting eyes. */
  expression?: OrbExpression;
  accent?: boolean;
  className?: string;
}) {
  const tCommon = useTranslations("App.Hermes.Common");
  const seed = useContext(AssistantSeedContext);
  const motion = useContext(AssistantMotionContext);
  const dark = useDarkTheme();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const effectiveExpression = expression ?? motion.restExpression;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const S = PAINT_SIZE;
    canvas.width = S * dpr;
    canvas.height = S * dpr;

    // Offscreen layers: A = solid aurora body, B = the dot painter.
    const layerA = document.createElement("canvas");
    const layerB = document.createElement("canvas");
    layerA.width = layerB.width = S * dpr;
    layerA.height = layerB.height = S * dpr;
    const actx = layerA.getContext("2d");
    const bctx = layerB.getContext("2d");
    if (!actx || !bctx) return;

    const { mode, speed, opts } = resolvePreset(state, 64);
    const orbParams = params(seed);
    const { paint } = orbParams;
    // Same light point as the solid body's gradient in draw().
    const cx = S / 2;
    const cy = S / 2;
    const R = S * 0.46;
    const bx = cx - R * 0.24;
    const by = cy - R * 0.4;

    const easeInOut = (x: number) => x * x * (3 - 2 * x);

    let raf = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const seconds = (now - started) / 1000;
      // 0 = solid avatar (first frame), 1 = fully dissolved into dots.
      const phase = easeInOut(Math.min(1, seconds / DISSOLVE_SECONDS));

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, S, S);

      // Solid body fades out entirely — the dots and eyes carry the
      // identity from there (deliberately no residual ghost disc).
      if (phase < 1) {
        actx.setTransform(dpr, 0, 0, dpr, 0, 0);
        draw(actx, S, orbParams, seconds);
        ctx.globalAlpha = 1 - phase;
        ctx.drawImage(layerA, 0, 0, S, S);
      }

      bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      bctx.clearRect(0, 0, S, S);
      MODE_DRAWS[mode](
        bctx,
        S,
        seconds * speed * motion.activeSpeed,
        dark,
        opts,
      );
      // Refill every dot with the body's own gradient — one material.
      const material = bctx.createRadialGradient(bx, by, 0, bx, by, R * 1.7);
      material.addColorStop(0, paint.stops[0]);
      material.addColorStop(0.55, paint.stops[1]);
      material.addColorStop(1, dark ? paint.stops[1] : paint.stops[2]);
      bctx.globalCompositeOperation = "source-in";
      bctx.fillStyle = material;
      bctx.fillRect(0, 0, S, S);
      bctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = phase;
      ctx.drawImage(layerB, 0, 0, S, S);
      ctx.globalAlpha = 1;

      // Eyes ride on top through the whole dissolve. Over the solid body
      // the palette ink is correct; once the dots take over on a dark
      // page background it flips to light ink.
      const blinkPhase = (seconds % 3.6) / 0.16;
      const blink =
        blinkPhase < 1 ? Math.abs(Math.sin(blinkPhase * Math.PI)) : 0;
      drawEyes(
        ctx,
        S,
        effectiveExpression,
        {
          blink: 1 - blink,
          open: 1 - blink * 0.96,
          lift: 0,
          gazeX: Math.sin(seconds * 0.6) * 0.16,
          gazeY: Math.cos(seconds * 0.43) * 0.1,
        },
        undefined,
        dark && phase > 0.5 ? "rgba(240,238,248,0.95)" : paint.ink,
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state, seed, dark, effectiveExpression, motion.activeSpeed]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={tCommon("hermesAvatarAlt")}
      style={{ width: 32, height: 32 }}
      className={cn(
        "size-8 rounded-full",
        accent ? "ring-border/80 ring-1" : "",
        className,
      )}
    />
  );
}
