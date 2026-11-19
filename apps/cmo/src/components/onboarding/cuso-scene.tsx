import { AGENT_NAME } from "../../lib/agent";
import { type CusoArt, cusoArt } from "../cuso";

export type Scene =
  | "research"
  | "brand"
  | "planning"
  | "subscribe"
  | "launch"
  | "hero";

const ART: Record<Scene, CusoArt> = {
  research: "searching",
  brand: "pointing",
  planning: "thinking",
  subscribe: "thumbs-up",
  launch: "walking",
  hero: "pointing",
};

const ALT: Record<Scene, string> = {
  research: `${AGENT_NAME} looking through a magnifier`,
  brand: `${AGENT_NAME} pointing`,
  planning: `${AGENT_NAME} thinking`,
  subscribe: `${AGENT_NAME} giving a thumbs up`,
  launch: `${AGENT_NAME} walking`,
  hero: `${AGENT_NAME} pointing at you`,
};

interface CusoSceneProps {
  scene: Scene;
  /** What he is doing right now; set while he works, so the wait shows. */
  now?: string | null;
  /** The label on Iris: he needs the owner. */
  calling?: boolean;
}

/**
 * A step's lead, framed like the hire hero: Cuso's pose on the Iris stage. While he works, what he is doing pops out as a label and a bar runs
 * along the bottom.
 */
export function CusoScene({
  scene,
  now = null,
  calling = false,
}: CusoSceneProps) {
  return (
    <div
      className={["ob-scene", now && !calling ? "ob-scene-busy" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <img
        className="ob-stage-art"
        src={cusoArt(ART[scene])}
        alt={ALT[scene]}
        width={640}
        height={640}
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
          <span className="ob-scene-text">{now}</span>
        </span>
      ) : null}
      {now && !calling ? (
        <span className="ob-scene-bar" aria-hidden="true" />
      ) : null}
    </div>
  );
}
