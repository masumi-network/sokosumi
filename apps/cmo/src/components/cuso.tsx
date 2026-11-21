import type { CusoPose } from "../lib/thread";

/** How Cuso looks on an avatar; same poses as `cusoPose`. */
export type Pose = CusoPose;

/** Cuso's drawings in `public/cuso/`, the landing page's mascot poses. */
export type CusoArt =
  | "walking"
  | "pointing"
  | "thinking"
  | "thumbs-up"
  | "searching";

/** The drawing each status pose shows. */
const POSE_ART: Record<Pose, CusoArt> = {
  reading: "searching",
  thinking: "thinking",
  "needs-you": "pointing",
  reporting: "walking",
  done: "thumbs-up",
};

export function cusoArt(art: CusoArt): string {
  return `/cuso/${art}.png`;
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
