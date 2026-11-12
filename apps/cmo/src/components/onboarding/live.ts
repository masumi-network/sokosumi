import type { CmoOverview } from "@sokosumi/core-client";

import { hostOf } from "../brand-profile";

type Work = NonNullable<CmoOverview["work"]>;

/**
 * How long each wait usually takes, in seconds: the production medians from
 * the speed review (2026-11-09), research p50 412 s and plan p50 329 s. The
 * bar never shows them; past them it says "Taking longer than usual", and
 * past twice them the chat offers Try again.
 */
export const USUAL_SECONDS: Record<Work["kind"], number> = {
  research: 7 * 60,
  strategy: 6 * 60,
};

type Group = CmoOverview["research"]["groups"][number];

/** Core's research groups; null from a Core that sends none. */
export function researchGroups(overview: CmoOverview): Group[] | null {
  const groups = overview.research?.groups;
  return groups && groups.length > 0 ? groups : null;
}

/** Cuso is writing a whole plan now; a brand fix or a patch is not one. */
export function planWriting(overview: CmoOverview): boolean {
  return (
    overview.work?.kind === "strategy" &&
    overview.work.status === "running" &&
    !overview.work.change
  );
}

/** What Cuso is doing now, from Core's work labels; null once he stopped. */
export function liveLine(
  overview: CmoOverview,
): { label: string; work: Work; lastAt: Date | string } | null {
  const work = overview.work;
  if (work?.status !== "running") return null;
  const step =
    work.steps.findLast((candidate) => candidate.status === "running") ??
    work.steps.at(-1);
  return {
    label:
      step?.label ??
      (work.kind === "research"
        ? `Reading ${hostOf(overview.websiteUrl)}`
        : "Planning your month"),
    work,
    // The last sign of progress: the newest step, else the start.
    lastAt: work.steps.at(-1)?.at ?? work.startedAt,
  };
}
