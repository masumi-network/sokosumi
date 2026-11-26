"use client";

import type { AvatarState } from "@sokosumi/soko-bot";
import { useMemo, useRef } from "react";
import { useLiveBotAvatar } from "@/hooks/effects/use-live-bot-avatar";
import { parseAvatarCode, stillSrc } from "@/lib/bot-avatar/load";
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
  const gaze = interactive && size >= GAZE_MIN_SIZE;
  const { ready, failed } = useLiveBotAvatar(canvasRef, {
    code,
    look,
    state,
    size,
    gaze,
  });

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
