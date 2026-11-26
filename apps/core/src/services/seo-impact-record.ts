import type { Prisma, ProjectSeoSuggestion } from "@sokosumi/database";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";

type TrackedSuggestion = Pick<
  ProjectSeoSuggestion,
  "id" | "projectId" | "kind" | "title" | "status" | "pageUrl" | "doneAt"
>;

interface TrackedProject {
  workspaceId: string;
  testCopyOfProjectId: string | null;
}

const TRACKED_STATUSES = new Set(["done", "verified"]);

/**
 * The tracked change row for a done page change, or null when the suggestion
 * is not one. A test copy is no customer, so it gets none; the callers skip
 * eval projects.
 */
export function trackedSeoChange(
  suggestion: TrackedSuggestion,
  project: TrackedProject,
): Prisma.ProjectSeoImpactVerdictCreateManyInput | null {
  const { doneAt, pageUrl } = suggestion;
  if (
    suggestion.kind !== "page_change" ||
    !TRACKED_STATUSES.has(suggestion.status) ||
    !doneAt ||
    !pageUrl ||
    project.testCopyOfProjectId
  )
    return null;
  return {
    projectId: suggestion.projectId,
    changeSource: "cuso_done",
    suggestionId: suggestion.id,
    changedAt: doneAt,
    pageUrl,
    title: suggestion.title,
    kind: suggestion.kind,
  };
}

/**
 * Every suggestion status write goes through here: while impact tracking is
 * on, a transition to done or verified records its change in the same
 * transaction, so a reopen and a second done before the daily sync keep both.
 */
export async function updateSeoSuggestion(args: {
  where: Prisma.ProjectSeoSuggestionWhereUniqueInput;
  data: Prisma.ProjectSeoSuggestionUpdateInput;
}): Promise<ProjectSeoSuggestion> {
  if (!getEnv().SEO_IMPACT_TRACKING_ENABLED)
    return await prisma.projectSeoSuggestion.update(args);
  return await prisma.$transaction(async (tx) => {
    const suggestion = await tx.projectSeoSuggestion.update({
      ...args,
      include: {
        project: { select: { workspaceId: true, testCopyOfProjectId: true } },
      },
    });
    const { project, ...row } = suggestion;
    const change = trackedSeoChange(row, project);
    if (!change) return row;
    // An eval project is no customer. Read on this transaction's connection:
    // the global client would ask the pool for a second one per status write.
    const evalLanes = await tx.evalLane.count({
      where: {
        OR: [
          { workspaceId: project.workspaceId },
          { cusoProjectId: row.projectId },
        ],
      },
    });
    // The cron backfill can have recorded this change already.
    if (evalLanes === 0)
      await tx.projectSeoImpactVerdict.createMany({
        data: [change],
        skipDuplicates: true,
      });
    return row;
  });
}
