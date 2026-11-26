import type { CusoPose } from "../lib/thread";

/** How Cuso looks on an avatar; same poses as `cusoPose`. */
export type Pose = CusoPose;

/** Cuso's drawings in `public/cuso/`, from the brand guide's 2D poses (`scripts/cuso-poses.py`). */
export type CusoArt =
  | "walking"
  | "friendly"
  | "pointing"
  | "thinking"
  | "correct"
  | "researching";

/** The drawing each status pose shows. */
const POSE_ART: Record<Pose, CusoArt> = {
  reading: "researching",
  thinking: "thinking",
  "needs-you": "pointing",
  reporting: "friendly",
  done: "correct",
};

export function cusoArt(art: CusoArt): string {
  return `/cuso/${art}.svg`;
}

/** Cuso's profile picture, his face on Iris (the brand guide's `cmo-xyz-pfp-face-iris`), always round. */
export function CusoFace({ size }: { size: 26 | 36 | 48 }) {
  return (
    <img
      className="cuso-face"
      src="/cuso/face-128.webp"
      srcSet="/cuso/face-64.webp 64w, /cuso/face-128.webp 128w, /cuso/face-256.webp 256w"
      sizes={`${size}px`}
      alt=""
      width={size}
      height={size}
    />
  );
}

interface CusoAvatarProps {
  pose: Pose;
  size?: 36 | 48 | 96 | 176;
}

/** Cuso's pose on his light circle: the status of the screen. */
export function CusoAvatar({ pose, size = 48 }: CusoAvatarProps) {
  return (
    <span className="cuso-avatar" style={{ width: size, height: size }}>
      <img src={cusoArt(POSE_ART[pose])} alt="" width={size} height={size} />
    </span>
  );
}
