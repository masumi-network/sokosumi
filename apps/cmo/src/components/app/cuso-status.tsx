import type { CmoOverview } from "@sokosumi/core-client";

import { cusoStatus } from "../../lib/thread";
import { AGENT_NAME, CusoAvatar, type Pose } from "../onboarding/parts";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What Cuso is doing, as the pose he shows. Something that needs the owner
 * comes first, then work in progress (reading while he researches, thinking
 * while he plans or makes the month), then a report filed in the last day.
 */
function cusoPose(overview: CmoOverview, now: Date = new Date()): Pose {
  const status = cusoStatus(overview);
  if (
    overview.learning === "failed" ||
    status === "Needs your answers" ||
    status === "Waiting for approval" ||
    status === "Waiting for a channel" ||
    status === "Paused"
  ) {
    return "needs-you";
  }
  if (overview.learning === "running" || overview.work?.kind === "research") {
    return "reading";
  }
  if (
    overview.botStatus === "RUNNING" ||
    overview.production.state === "running" ||
    overview.work?.status === "running" ||
    status === "Planning"
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

/** Cuso's status card at the bottom of the sidebar. */
export function CusoStatus({
  overview,
  now,
}: {
  overview: CmoOverview;
  now?: Date;
}) {
  return (
    <div className="cuso-status" role="status">
      <CusoAvatar pose={cusoPose(overview, now)} size={36} />
      <span className="cuso-status-text">
        <span className="cuso-status-name">{AGENT_NAME}</span>
        <span className="note">{cusoLine(overview)}</span>
      </span>
    </div>
  );
}
