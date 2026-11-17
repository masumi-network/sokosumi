import { AGENT_NAME } from "../../lib/agent";
import { CusoClip } from "../cuso-clip";

export type Scene = "research" | "brand" | "planning" | "launch";

const ALT: Record<Scene, string> = {
  research: `${AGENT_NAME} reading a site with a magnifier`,
  brand: `${AGENT_NAME} holding up a brand board`,
  planning: `${AGENT_NAME} filling in a calendar`,
  launch: `${AGENT_NAME} holding up a phone, thumbs up`,
};

interface CusoSceneProps {
  scene: Scene;
  /** What he is doing right now; set while he works, so the wait shows. */
  now?: string | null;
}

/**
 * A step's lead, framed like the hire hero: Cuso's scene loops on its pink
 * panel. While he works, what he is doing pops out as a label and a bar runs
 * along the bottom.
 */
export function CusoScene({ scene, now = null }: CusoSceneProps) {
  return (
    <div className={now ? "ob-scene ob-scene-busy" : "ob-scene"}>
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
        <span key={now} className="ob-tilt ob-scene-now" aria-hidden="true">
          <span className="ob-box-dot" />
          {now}
        </span>
      ) : null}
      {now ? <span className="ob-scene-bar" aria-hidden="true" /> : null}
    </div>
  );
}
