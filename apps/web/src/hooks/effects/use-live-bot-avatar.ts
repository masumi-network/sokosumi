"use client";

import type { AvatarLook, AvatarState } from "@sokosumi/soko-bot";
import { type RefObject, useEffect, useRef, useState } from "react";

import { canvasPx, loadAvatarModel, seedOf } from "@/lib/bot-avatar/load";
import { createLiveAvatar, type LiveAvatar } from "@/lib/bot-avatar/renderer";

export interface UseLiveBotAvatarOptions {
  code: string;
  look: AvatarLook | null;
  state: AvatarState;
  size: number;
  gaze: boolean;
}

export interface UseLiveBotAvatarResult {
  ready: boolean;
  failed: boolean;
}

/**
 * Owns a Soko Bot's shared-WebGL live avatar handle, intersection visibility,
 * async model upload, context-loss teardown, and optional pointer gaze.
 */
export function useLiveBotAvatar(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  { code, look, state, size, gaze }: UseLiveBotAvatarOptions,
): UseLiveBotAvatarResult {
  const handleRef = useRef<LiveAvatar | null>(null);
  const stateRef = useRef(state);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // A lost context unmounts the canvas: leave the shared loop too, so it stops drawing for nobody.
  useEffect(() => {
    if (!failed) return;
    handleRef.current?.destroy();
    handleRef.current = null;
  }, [failed]);

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
  }, [canvasRef, look, code, size]);

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
  }, [canvasRef, gaze]);

  return { ready, failed };
}
