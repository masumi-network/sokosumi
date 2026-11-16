import type { Prisma } from "@sokosumi/database";

import { requireTaskCollaboration } from "@/helpers/access-control";
import { lockTaskRows } from "@/helpers/calendar-locks";
import { conflict, notFound } from "@/helpers/error";
import {
  type AuthenticationContext,
  requireCoworkerAuthContext,
} from "@/middleware/auth";
import type { TaskWorkerContext } from "@/schemas/task-worker-context.schema";

/** Keep all Task delivery assertions stable until the caller's write commits. */
export async function requireTaskWorkerContext(
  authContext: AuthenticationContext,
  taskId: string,
  expected: TaskWorkerContext,
  tx: Prisma.TransactionClient,
) {
  const coworker = requireCoworkerAuthContext(authContext);
  if (!(await lockTaskRows(tx, [taskId]))) throw notFound("Task not found");
  const task = await requireTaskCollaboration(authContext, taskId, tx);
  if (
    task.ownerId !== expected.ownerId ||
    task.organizationId !== expected.organizationId ||
    task.workspaceId !== expected.workspaceId ||
    task.assigneeId !== coworker.coworkerId
  ) {
    throw conflict(
      "Task context changed. Read the current Task before delivery",
      {
        kind: "task_context_changed",
      },
    );
  }
  return task;
}
