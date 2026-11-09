import type { CmoOverview } from "@sokosumi/core-client";

import { AGENT_NAME } from "../../lib/agent";
import { cusoPose, cusoStatus } from "../../lib/thread";
import { CusoAvatar } from "../cuso";

/** One line: how far the month is while it is made, else Cuso's state. */
function cusoLine(overview: CmoOverview): string {
  const { production } = overview;
  return production.state === "running"
    ? `${production.ready} of ${production.total} made`
    : cusoStatus(overview);
}

interface CusoStatusProps {
  overview: CmoOverview;
  /** The time "just filed" counts from; tests and the preview pin it. */
  now?: Date;
  /** Opens what needs the owner (the chat); only used while he is needed. */
  onOpen?: () => void;
}

/**
 * Cuso's status card at the bottom of the sidebar. When he needs the owner it
 * is a button in focus that opens what he is waiting on.
 */
export function CusoStatus({
  overview,
  now = new Date(),
  onOpen,
}: CusoStatusProps) {
  const pose = cusoPose(overview, now);
  const needsYou = pose === "needs-you";
  const content = (
    <>
      <CusoAvatar pose={pose} size={36} />
      <span className="cuso-status-text">
        <span className="cuso-status-name">{AGENT_NAME}</span>
        {/* Needs you is the one state labelled on Iris. */}
        <span className={needsYou ? "cuso-status-iris" : "note"}>
          {cusoLine(overview)}
        </span>
      </span>
    </>
  );
  if (needsYou && onOpen) {
    return (
      <button
        type="button"
        className="cuso-status card card-focus"
        onClick={onOpen}
      >
        {content}
      </button>
    );
  }
  return (
    <div className="cuso-status card" role="status">
      {content}
    </div>
  );
}
