import type { Prisma, Task } from "@sokosumi/database";

import { conflict } from "./error";

const SEO_EXECUTION_FIELDS = [
  "description",
  "projectId",
  "workspaceId",
  "assigneeId",
  "assigneeSokoBotId",
  "assigneeUserId",
] as const;
type SeoExecutionFields = Pick<Task, (typeof SEO_EXECUTION_FIELDS)[number]>;
const SEO_EXECUTION_FROZEN_MESSAGE =
  "This SEO analysis request is frozen. Request a new check to change its scope, limits, Workspace, Project or executor.";

/** A dispatched analysis keeps its approved scope, payer's Project and reviewed executor. */
export async function requireSeoTaskExecutionUnchanged(
  tx: Prisma.TransactionClient,
  task: SeoExecutionFields & Pick<Task, "id">,
  changes: Partial<SeoExecutionFields>,
): Promise<void> {
  if (
    !SEO_EXECUTION_FIELDS.some(
      (field) => changes[field] !== undefined && changes[field] !== task[field],
    )
  )
    return;
  const analysis = await tx.projectSeoAnalysis.findUnique({
    where: { taskId: task.id },
    select: { id: true },
  });
  if (analysis) throw conflict(SEO_EXECUTION_FROZEN_MESSAGE);
}

/** The same refusal for Tasks that move as a side effect, such as sub-tasks following their Task. */
export async function requireNoSeoTaskExecution(
  tx: Prisma.TransactionClient,
  taskIds: string[],
): Promise<void> {
  if (taskIds.length === 0) return;
  const analysis = await tx.projectSeoAnalysis.findFirst({
    where: { taskId: { in: taskIds } },
    select: { id: true },
  });
  if (analysis) throw conflict(SEO_EXECUTION_FROZEN_MESSAGE);
}
