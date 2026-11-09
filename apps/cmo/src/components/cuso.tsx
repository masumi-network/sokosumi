import type { CusoPose } from "../lib/thread";
import { CusoClip } from "./cuso-clip";

/** How Cuso looks on an avatar; same poses as `cusoPose`. */
export type Pose = CusoPose;

/** How long the avatar rests on its still between two plays. */
export const AVATAR_REPLAY_MS = 30_000;

interface CusoAvatarProps {
  pose: Pose;
  size?: 36 | 48 | 96;
  /** False keeps the still (a past chat message). */
  animate?: boolean;
  /** Holds the first play until true (the hire screen waits for its hero). */
  play?: boolean;
}

/**
 * Cuso's pose on his light circle: the status of the screen. The pose plays
 * once, then again every 30 seconds.
 */
export function CusoAvatar({
  pose,
  size = 48,
  animate = true,
  play = true,
}: CusoAvatarProps) {
  const src = `/cuso/${pose}.png`;
  return (
    <span className="cuso-avatar" style={{ width: size, height: size }}>
      {animate ? (
        <CusoClip
          key={pose}
          src={src}
          alt=""
          width={size}
          height={size}
          play={play}
          replayAfterMs={AVATAR_REPLAY_MS}
        />
      ) : (
        <img src={src} alt="" width={size} height={size} />
      )}
    </span>
  );
}
