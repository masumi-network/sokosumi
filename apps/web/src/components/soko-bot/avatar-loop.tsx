"use client";

import { useReducedMotion } from "motion/react";
import { useCallback } from "react";

interface AvatarLoopProps {
  /** The state's still: the poster while the video loads and the picture at rest. */
  poster: string;
  /** The loop (silent MP4); null shows the still only. */
  src: string | null;
  /** Plays while true; at rest it is the still. */
  playing: boolean;
  /** Repeat until `playing` turns false (the hover card), instead of once. */
  loop?: boolean;
  /** The clip ended or failed: the caller rests on the still. */
  onEnded?: () => void;
  /** Names the bot and its state; empty for a decorative face. */
  alt?: string;
  /** Laid on the still and the video alike, so a face crop fits both. */
  className?: string;
}

/**
 * A bot's picture: the still, or its loop while it plays. The loop starts and
 * ends on the still, so resting on the still afterwards is seamless. Nothing
 * plays under reduced motion, and a loop that is not rendered yet is the still.
 */
export function AvatarLoop({
  poster,
  src,
  playing,
  loop = false,
  onEnded,
  alt = "",
  className,
}: AvatarLoopProps) {
  const reducedMotion = useReducedMotion();
  // Muted is set here as well as in markup: server-rendered HTML can reach the
  // browser without it, and autoplay is refused for sound.
  const start = useCallback((video: HTMLVideoElement | null) => {
    if (!video) return;
    video.muted = true;
    video.play()?.catch(() => {});
  }, []);

  if (!playing || !src || reducedMotion) {
    return <img src={poster} alt={alt} className={className} />;
  }
  return (
    <>
      <video
        key={src}
        ref={start}
        src={src}
        poster={poster}
        autoPlay
        muted
        playsInline
        preload="auto"
        loop={loop}
        disablePictureInPicture
        disableRemotePlayback
        aria-hidden
        onEnded={onEnded}
        onError={onEnded}
        className={className}
      />
      {/* The video is hidden from assistive tech; the name stays as it was. */}
      {alt ? <img src={poster} alt={alt} className="sr-only" /> : null}
    </>
  );
}
