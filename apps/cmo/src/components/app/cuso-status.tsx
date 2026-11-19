import type { CmoOverview } from "@sokosumi/core-client";

import { AGENT_NAME } from "../../lib/agent";
import { type CusoPose, cusoPose, cusoStatus } from "../../lib/thread";
import { type CusoArt, cusoArt } from "../cuso";

/** One line: how far the month is while it is made, else Cuso's state. */
function cusoLine(overview: CmoOverview): string {
  const { production } = overview;
  return production.state === "running"
    ? `${production.ready} of ${production.total} made`
    : cusoStatus(overview);
}

/** The scene each state shows: he points at the owner when needed. */
/** The drawing each state shows: he points at the owner when needed. */
const ART: Record<CusoPose, CusoArt> = {
  reading: "searching",
  thinking: "thinking",
  reporting: "walking",
  done: "thumbs-up",
  "needs-you": "pointing",
};

interface CusoStatusProps {
  overview: CmoOverview;
  /** The time "just filed" counts from; tests and the preview pin it. */
  now?: Date;
  /** Opens what needs the owner (the chat); only used while he is needed. */
  onOpen?: () => void;
}

/**
 * Cuso at the bottom of the sidebar, always in view and small: his pose on a
 * little Iris stage beside one line that says what he is doing now. When he
 * needs the owner it is a button that opens what he is waiting on.
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
  // The words say the state; the drawing only shows it.
  const label = `${AGENT_NAME}: ${line}`;
  const content = (
    <>
      <img
        className="cuso-status-art"
        src={cusoArt(ART[pose])}
        alt=""
        width={640}
        height={640}
      />
      <span className="cuso-status-text">
        <b>{AGENT_NAME}</b>
        <span
          className={
            needsYou ? "cuso-status-line cuso-status-call" : "cuso-status-line"
          }
        >
          {working ? <span className="ob-box-dot" aria-hidden="true" /> : null}
          {line}
        </span>
        {working ? <span className="ob-scene-bar" aria-hidden="true" /> : null}
      </span>
    </>
  );
  if (needsYou && onOpen) {
    return (
      <button
        type="button"
        className="cuso-status"
        aria-label={label}
        onClick={onOpen}
      >
        {content}
      </button>
    );
  }
  return (
    <div className="cuso-status" role="status" aria-label={label}>
      {content}
    </div>
  );
}
