import type { CmoOverview } from "@sokosumi/core-client";

import { type CusoState, cusoState, cusoStatus } from "../../lib/thread";
import { AGENT_NAME, CusoAvatar, type Pose } from "../cuso";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The pose each state shows. A state that waits on the owner (or stopped)
 * needs him; "running" has no pose of its own, see `cusoPose`.
 */
const STATE_POSE: Record<Exclude<CusoState, "running">, Pose> = {
  stopped: "needs-you",
  learning: "reading",
  "needs-answers": "needs-you",
  paused: "needs-you",
  working: "thinking",
  planning: "thinking",
  "waiting-approval": "needs-you",
  "waiting-channel": "needs-you",
};

/**
 * Running is steady: thinking while the month is made, reading while
 * research runs, reporting for a day after a report is filed, else done.
 */
function cusoPose(overview: CmoOverview, now: Date): Pose {
  const state = cusoState(overview);
  if (state !== "running") return STATE_POSE[state];
  if (overview.work?.kind === "research") return "reading";
  if (
    overview.production.state === "running" ||
    overview.work?.status === "running"
  ) {
    return "thinking";
  }
  const filed = overview.updates.some(
    (update) => now.getTime() - new Date(update.at).getTime() < DAY_MS,
  );
  return filed ? "reporting" : "done";
}

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
}

/** Cuso's status card at the bottom of the sidebar. */
export function CusoStatus({ overview, now = new Date() }: CusoStatusProps) {
  const pose = cusoPose(overview, now);
  return (
    <div className="cuso-status card" role="status">
      <CusoAvatar pose={pose} size={36} />
      <span className="cuso-status-text">
        <span className="cuso-status-name">{AGENT_NAME}</span>
        {/* Needs you is the one state labelled on Iris. */}
        <span className={pose === "needs-you" ? "cuso-status-iris" : "note"}>
          {cusoLine(overview)}
        </span>
      </span>
    </div>
  );
}
