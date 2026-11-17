import type { CmoOverview } from "@sokosumi/core-client";

import { AGENT_NAME } from "../../lib/agent";
import { type CusoPose, cusoPose, cusoStatus } from "../../lib/thread";
import { CusoScene, type Scene } from "../onboarding/cuso-scene";

/** One line: how far the month is while it is made, else Cuso's state. */
function cusoLine(overview: CmoOverview): string {
  const { production } = overview;
  return production.state === "running"
    ? `${production.ready} of ${production.total} made`
    : cusoStatus(overview);
}

/** The scene each state plays: he calls out through the megaphone when needed. */
const SCENES: Record<CusoPose, Scene> = {
  reading: "research",
  thinking: "planning",
  reporting: "brand",
  done: "launch",
  "needs-you": "hero",
};

interface CusoStatusProps {
  overview: CmoOverview;
  /** The time "just filed" counts from; tests and the preview pin it. */
  now?: Date;
  /** Opens what needs the owner (the chat); only used while he is needed. */
  onOpen?: () => void;
}

/**
 * Cuso at the bottom of the sidebar, always in view: his scene loops on the
 * pink stage, with what he is doing now. When he needs the owner it is a
 * button that opens what he is waiting on.
 */
export function CusoStatus({
  overview,
  now = new Date(),
  onOpen,
}: CusoStatusProps) {
  const pose = cusoPose(overview, now);
  const needsYou = pose === "needs-you";
  const working = pose === "reading" || pose === "thinking";
  const line = cusoLine(overview);
  // While he works the line is on the stage; it is not said twice.
  const onStage = needsYou ? "Needs you" : working ? line : null;
  const content = (
    <>
      <CusoScene
        scene={SCENES[pose]}
        now={onStage}
        calling={needsYou}
        compact
      />
      <span className="cuso-status-text">
        <span className="cuso-status-name">{AGENT_NAME}</span>
        {working ? null : <span className="note">{line}</span>}
      </span>
    </>
  );
  if (needsYou && onOpen) {
    return (
      <button type="button" className="cuso-status" onClick={onOpen}>
        {content}
      </button>
    );
  }
  return (
    <div className="cuso-status" role="status">
      {content}
    </div>
  );
}
