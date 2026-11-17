"use client";

import type { AvatarState } from "@sokosumi/soko-bot";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  canvasPx,
  loadAvatarModel,
  parseAvatarCode,
  seedOf,
  stillSrc,
} from "@/lib/bot-avatar/load";
import { createLiveAvatar, type LiveAvatar } from "@/lib/bot-avatar/renderer";
import { cn } from "@/lib/utils";

/** Only a large avatar follows the pointer; a 20 px one would just jitter. */
const GAZE_MIN_SIZE = 96;

export interface LiveBotAvatarProps {
  code: string;
  state: AvatarState;
  /** CSS pixels the avatar is drawn at; sets the canvas resolution. */
  size: number;
  /** Server-rendered picture shown until the live one is ready, and when WebGL is missing. */
  imageUrl?: string | null;
  alt?: string;
  className?: string;
  /** Follows the pointer. Ignored below 96 px. */
  interactive?: boolean;
}

/**
 * A Soko Bot avatar as a live 3D head. One shared WebGL context draws every avatar on the page;
 * this one is only drawn while it is on screen. Without WebGL (or after the context is lost)
 * it stays the still picture.
 */
export default function LiveBotAvatar({
  code,
  state,
  size,
  imageUrl,
  alt = "",
  className,
  interactive = false,
}: LiveBotAvatarProps) {
  const look = useMemo(() => parseAvatarCode(code), [code]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<LiveAvatar | null>(null);
  const stateRef = useRef(state);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const gaze = interactive && size >= GAZE_MIN_SIZE;

  useEffect(() => {
    stateRef.current = state;
    handleRef.current?.setState(state);
  }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !look) return;
    let cancelled = false;
    setReady(false);
    const px = canvasPx(size, window.devicePixelRatio || 1);
    canvas.width = canvas.height = px;
    const handle = createLiveAvatar(canvas, {
      seed: seedOf(code),
      state: stateRef.current,
      onFail: () => setFailed(true),
    });
    if (!handle) {
      setFailed(true);
      return;
    }
    handleRef.current = handle;
    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === "undefined") handle.setVisible(true);
    else {
      observer = new IntersectionObserver((entries) => {
        for (const e of entries) handle.setVisible(e.isIntersecting);
      });
      observer.observe(canvas);
    }
    loadAvatarModel(look, code, px)
      .then((model) => {
        if (cancelled) return;
        handle.setModel(model);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      observer?.disconnect();
      handle.destroy();
      handleRef.current = null;
    };
  }, [look, code, size]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!gaze || !canvas) return;
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const axis = (d: number, span: number) =>
        Math.max(-1, Math.min(1, d / (span / 2)));
      handleRef.current?.setLook({
        x: axis(e.clientX - r.left - r.width / 2, window.innerWidth),
        y: axis(e.clientY - r.top - r.height / 2, window.innerHeight),
      });
    };
    window.addEventListener("pointermove", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
      handleRef.current?.setLook(null);
    };
  }, [gaze]);

  const still = imageUrl ?? (look ? stillSrc(look) : null);
  return (
    <span
      className={cn(
        "bg-muted relative block shrink-0 overflow-hidden rounded-full",
        className,
      )}
    >
      {still ? (
        <img
          src={still}
          alt={alt}
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
      {look && !failed ? (
        <canvas
          ref={canvasRef}
          aria-hidden
          data-ready={ready}
          className={cn(
            "absolute inset-0 size-full",
            ready ? "opacity-100" : "opacity-0",
          )}
        />
      ) : null}
    </span>
  );
}
