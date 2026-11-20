import type { CmoOverview } from "@sokosumi/core-client";

import { AGENT_NAME } from "../../lib/agent";
import { type CusoPose, cusoPose, cusoStatus } from "../../lib/thread";
import { needsYou } from "../../lib/today";
import { type CusoArt, cusoArt } from "../cuso";

/** The drawing each state shows: he points at the owner when needed. */
const ART: Record<CusoPose, CusoArt> = {
  reading: "searching",
  thinking: "thinking",
  reporting: "walking",
  done: "thumbs-up",
  "needs-you": "pointing",
};

/** Cuso's state on every page: his pose and the one line he says. */
export function cusoMood(
  overview: CmoOverview,
  now: Date = new Date(),
): { pose: CusoPose; art: CusoArt; line: string; needs: number } {
  const needs = needsYou(overview).length;
  const pose = needs > 0 ? "needs-you" : cusoPose(overview, now);
  const { production } = overview;
  const line =
    needs === 1
      ? "One thing needs you"
      : needs > 1
        ? `${needs} things need you`
        : production.state === "running"
          ? `${production.ready} of ${production.total} made`
          : cusoStatus(overview);
  return { pose, art: ART[pose], line, needs };
}

interface CusoStatusProps {
  overview: CmoOverview;
  /** The time "just filed" counts from; tests and the preview pin it. */
  now?: Date;
  /** Opens what needs the owner (Today); only used while he is needed. */
  onOpen?: () => void;
}

/**
 * Cuso, large, at the foot of the sidebar on every page: he leans over its
 * edge on his light stage in the pose of his state, and says what he is doing
 * in a bubble. While something needs the owner the bubble is a button that
 * opens Today. The drawing is decoration; the words carry the state.
 */
export function CusoStatus({
  overview,
  now = new Date(),
  onOpen,
}: CusoStatusProps) {
  const { pose, art, line, needs } = cusoMood(overview, now);
  const working = pose === "reading" || pose === "thinking";
  const words = (
    <>
      <b>{AGENT_NAME}</b>
      <span className="cuso-says-line">
        {working ? <span className="ob-box-dot" aria-hidden="true" /> : null}
        {line}
      </span>
      {working ? <span className="ob-scene-bar" aria-hidden="true" /> : null}
    </>
  );
  return (
    <div className="cuso-status" data-pose={pose}>
      {needs > 0 && onOpen ? (
        <button
          type="button"
          className="cuso-says cuso-says-call"
          aria-label={`${AGENT_NAME}: ${line}`}
          onClick={onOpen}
        >
          {words}
        </button>
      ) : (
        <p
          className="cuso-says"
          role="status"
          aria-label={`${AGENT_NAME}: ${line}`}
        >
          {words}
        </p>
      )}
      <span className="cuso-stage" aria-hidden="true">
        <img key={art} src={cusoArt(art)} alt="" width={640} height={640} />
      </span>
    </div>
  );
}
