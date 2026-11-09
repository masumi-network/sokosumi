"use client";

import {
  type SyntheticEvent,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeToMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** False on the server and under reduced motion, so both render the still. */
function useMotionAllowed(): boolean {
  return useSyncExternalStore(
    subscribeToMotion,
    () => !window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

export interface CusoClipProps {
  /** The still in `public/cuso/`; its MP4 (scripts/animate-cuso.ts) sits beside it. */
  src: string;
  /** Empty for a decorative Cuso. */
  alt: string;
  width: number;
  height: number;
  className?: string;
  /** Plays once this is true and half the clip is on screen. */
  play?: boolean;
  /** Plays again this long after each end; without it the clip plays once. */
  replayAfterMs?: number;
  /**
   * The first play started, or was refused (then the still stays), so
   * whatever waits on the clip never waits forever.
   */
  onStart?: () => void;
  onEnded?: () => void;
}

/**
 * One of Cuso's stills, animated: the clip starts and ends on the still, which
 * is its poster, so it swaps in without a jump and rests on it. Under reduced
 * motion only the still shows.
 */
export function CusoClip({
  src,
  alt,
  width,
  height,
  className,
  play = true,
  replayAfterMs,
  onStart,
  onEnded,
}: CusoClipProps) {
  const motion = useMotionAllowed();
  const video = useRef<HTMLVideoElement>(null);
  const replay = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The latest callbacks, so a new function each render does not replay the clip.
  const started = useRef(onStart);
  const finished = useRef(onEnded);
  useEffect(() => {
    started.current = onStart;
    finished.current = onEnded;
  });

  useEffect(() => {
    const element = video.current;
    if (!motion || !play || !element) return;
    let cancelled = false;
    const start = () => {
      if (!cancelled) started.current?.();
    };
    // A refused autoplay leaves the poster; still finish so hire sequences
    // waiting on onEnded (the avatar after the hero) do not stall.
    const refuse = () => {
      if (cancelled) return;
      started.current?.();
      finished.current?.();
    };
    // Below the fold (the hire hero on a phone) it waits to be seen.
    const view = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        view.disconnect();
        element.play().then(start, refuse);
      },
      { threshold: 0.5 },
    );
    view.observe(element);
    return () => {
      cancelled = true;
      view.disconnect();
    };
  }, [motion, play]);

  useEffect(() => () => clearTimeout(replay.current), []);

  if (!motion) {
    return (
      <img
        className={className}
        src={src}
        alt={alt}
        width={width}
        height={height}
      />
    );
  }

  function ended(event: SyntheticEvent<HTMLVideoElement>) {
    onEnded?.();
    if (replayAfterMs === undefined) return;
    const element = event.currentTarget;
    replay.current = setTimeout(() => {
      element.currentTime = 0;
      element.play().catch(() => {});
    }, replayAfterMs);
  }

  return (
    <video
      ref={video}
      className={className}
      src={src.replace(/\.\w+$/, ".mp4")}
      poster={src}
      width={width}
      height={height}
      muted
      playsInline
      disablePictureInPicture
      onEnded={ended}
      {...(alt ? { role: "img", "aria-label": alt } : { "aria-hidden": true })}
    />
  );
}
