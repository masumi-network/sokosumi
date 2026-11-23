import type { CusoPose } from "../lib/thread";

/** How Cuso looks on an avatar; same poses as `cusoPose`. */
export type Pose = CusoPose;

/** Cuso's drawings in `public/cuso/`, from the brand guide's 2D poses (`scripts/cuso-poses.py`). */
export type CusoArt =
  | "walking"
  | "friendly"
  | "pointing"
  | "thinking"
  | "done"
  | "researching";

/** The drawing each status pose shows. */
const POSE_ART: Record<Pose, CusoArt> = {
  reading: "researching",
  thinking: "thinking",
  "needs-you": "pointing",
  reporting: "friendly",
  done: "done",
};

export function cusoArt(art: CusoArt): string {
  return `/cuso/${art}.svg`;
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
