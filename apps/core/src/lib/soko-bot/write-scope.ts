import type { Prisma } from "@sokosumi/database";
import {
  buildSokoBotScopeJobWhere,
  buildSokoBotScopeTaskWhere,
  type SokoBotScope,
} from "@/helpers/task-visibility";

/** What a runtime write touches, so a shared bot's scope can be checked. */
export interface SokoBotWriteTargets {
  /** Tasks the write reads or changes. */
  taskIds?: (string | null | undefined)[];
  /** Projects the write puts something into; `null` means no Project. */
  projectIds?: (string | null)[];
  jobId?: string;
}

/**
 * The refusal for a Project write outside a project bot's Project, or `null`.
 * A personal or workspace bot is not limited to one Project.
 */
export function sokoBotProjectRefusal(
  scope: SokoBotScope | null,
  projectIds: (string | null)[],
): string | null {
  if (scope?.projectId == null) return null;
  return projectIds.every((id) => id === scope.projectId)
    ? null
    : `This Soko Bot works only in its own Project (${scope.projectId}).`;
}

/**
 * The refusal for a write outside a shared bot's scope, or `null`. A personal
 * bot (no scope) is unchanged and costs no query. The refusal reads like a
 * missing row, so an out-of-scope id does not leak that it exists.
 */
export async function sokoBotWriteScopeRefusal(
  client: Prisma.TransactionClient,
  scope: SokoBotScope | null,
  targets: SokoBotWriteTargets,
): Promise<string | null> {
  if (!scope) return null;
  const projectRefusal = sokoBotProjectRefusal(scope, targets.projectIds ?? []);
  if (projectRefusal) return projectRefusal;
  const taskIds = [
    ...new Set(
      (targets.taskIds ?? []).filter((id): id is string => Boolean(id)),
    ),
  ];
  if (taskIds.length > 0) {
    const visible = await client.task.count({
      where: {
        AND: [{ id: { in: taskIds } }, buildSokoBotScopeTaskWhere(scope)],
      },
    });
    if (visible !== taskIds.length) return "Task not found";
  }
  if (targets.jobId) {
    const visible = await client.job.count({
      where: { AND: [{ id: targets.jobId }, buildSokoBotScopeJobWhere(scope)] },
    });
    if (visible !== 1) return "Job not found";
  }
  return null;
}
