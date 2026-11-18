import prisma from "@/lib/db/prisma";
import { recordCoreWarning } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import {
  runCusoCompetitorCheck,
  startCusoWatchRun,
} from "@/services/cmo-competitors.service";
import {
  LIVE_CUSO_WHERE,
  listCusosWithApprovedStrategy,
} from "@/services/cmo-cuso.service";
import {
  type CompetitorCheckOutcome,
  runProjectCompetitorCheck,
} from "@/services/competitor-check.service";

function skipped(projectId: string, error: unknown): void {
  // The error can quote a page or an article.
  recordCoreWarning(
    { operation: "competitor_sync", project: { id: projectId } },
    {
      message: "The competitor check skipped a Project",
      why: "Running this Project's competitor check threw",
      fix: "The next sync tries again; a check that started is redone after an hour and charged once. If it repeats, look up the error name and code under failure.",
    },
    { failure: messageSafeErrorFields(error) },
  );
}

/**
 * Runs every weekly competitor check that is due: each paid Cuso with an
 * approved strategy, who then writes the week's feed, and each other
 * Project whose members turned the check on.
 */
export async function syncCompetitorChecks(
  shouldContinue: () => boolean = () => true,
  now: Date = new Date(),
): Promise<Record<CompetitorCheckOutcome | "failed", number>> {
  const counts = {
    checked: 0,
    not_due: 0,
    no_competitors: 0,
    paused: 0,
    unfunded: 0,
    failed: 0,
  };
  for (const cuso of await listCusosWithApprovedStrategy()) {
    if (!shouldContinue()) return counts;
    try {
      const outcome = await runCusoCompetitorCheck(cuso, now);
      counts[outcome] += 1;
      // Also after "not_due": a run that could not start (Cuso busy or
      // paused) starts on a later sync, while its check is fresh.
      if (outcome === "checked" || outcome === "not_due")
        await startCusoWatchRun(cuso, now);
    } catch (error) {
      counts.failed += 1;
      skipped(cuso.projectId, error);
    }
  }
  const projects = await prisma.project.findMany({
    where: {
      competitorChecksSince: { not: null },
      closedAt: null,
      // A CMO Project is checked above, on its Cuso's terms.
      sokoBots: { none: LIVE_CUSO_WHERE },
    },
    orderBy: { competitorChecksSince: "asc" },
    select: { id: true },
  });
  for (const { id } of projects) {
    if (!shouldContinue()) return counts;
    try {
      counts[await runProjectCompetitorCheck(id, now)] += 1;
    } catch (error) {
      counts.failed += 1;
      skipped(id, error);
    }
  }
  return counts;
}
