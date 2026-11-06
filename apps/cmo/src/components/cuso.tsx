export { AGENT_NAME } from "../lib/agent";

export type Pose = "reading" | "thinking" | "needs-you" | "reporting" | "done";

interface CusoAvatarProps {
  pose: Pose;
  size?: 36 | 48 | 96;
}

/** Cuso's pose on his light circle: the status of the screen. */
export function CusoAvatar({ pose, size = 48 }: CusoAvatarProps) {
  return (
    <span className="cuso-avatar" style={{ width: size, height: size }}>
      <img src={`/cuso/${pose}.png`} alt="" width={size} height={size} />
    </span>
  );
}
