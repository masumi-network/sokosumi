import { AGENT_NAME } from "../../lib/agent";
import { CusoClip } from "../cuso-clip";

export type Scene =
  | "research"
  | "brand"
  | "planning"
  | "subscribe"
  | "launch"
  | "hero";

const ALT: Record<Scene, string> = {
  research: `${AGENT_NAME} reading a site with a magnifier`,
  brand: `${AGENT_NAME} holding up a brand board`,
  planning: `${AGENT_NAME} filling in a calendar`,
  subscribe: `${AGENT_NAME} holding up a star card, thumbs up`,
  launch: `${AGENT_NAME} holding up a phone, thumbs up`,
  hero: `${AGENT_NAME} calling out with a megaphone`,
};

interface CusoSceneProps {
  scene: Scene;
  /** What he is doing right now; set while he works, so the wait shows. */
  now?: string | null;
  /** The sidebar's size: as wide as its column, shorter. */
  compact?: boolean;
  /** The label on Iris: he needs the owner. */
  calling?: boolean;
}

/**
 * A step's lead, framed like the hire hero: Cuso's scene loops on its pink
 * panel. While he works, what he is doing pops out as a label and a bar runs
 * along the bottom.
 */
export function CusoScene({
  scene,
  now = null,
  compact = false,
  calling = false,
}: CusoSceneProps) {
  return (
    <div
      className={[
        "ob-scene",
        now && !calling ? "ob-scene-busy" : "",
        compact ? "ob-scene-compact" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <CusoClip
        className="ob-stage-art"
        src={`/cuso/${scene}.jpg`}
        alt={ALT[scene]}
        width={640}
        height={960}
        replayAfterMs={0}
      />
      {now ? (
        // A new label pops in again.
        <span
          key={now}
          className={
            calling
              ? "ob-tilt ob-scene-now ob-scene-call"
              : "ob-tilt ob-scene-now"
          }
          aria-hidden="true"
        >
          {calling ? null : <span className="ob-box-dot" />}
          {now}
        </span>
      ) : null}
      {now && !calling ? (
        <span className="ob-scene-bar" aria-hidden="true" />
      ) : null}
    </div>
  );
}
