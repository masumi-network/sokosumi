import type { Prisma, VendorGrantStatus } from "@sokosumi/database";
import { sharedTable } from "@sokosumi/database/sql-tables";

import { requireTaskCollaboration } from "@/helpers/access-control";
import { lockTaskRows } from "@/helpers/calendar-locks";
import { conflict, notFound } from "@/helpers/error";
import {
  isGrantDeniedOrRevoked,
  throwGrantAccessError,
} from "@/helpers/vendor-grants";
import {
  type AuthenticationContext,
  isCoworkerAuthContext,
  requireCoworkerAuthContext,
} from "@/middleware/auth";
import type { TaskWorkerContext } from "@/schemas/task-worker-context.schema";

/** Keep all Task delivery assertions stable until the caller's write commits. */
export async function requireTaskWorkerContext(
  authContext: AuthenticationContext,
  taskId: string,
  expected: TaskWorkerContext,
  tx: Prisma.TransactionClient,
  contextMismatch = conflict,
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
    throw contextMismatch(
      "Task context changed. Read the current Task before delivery",
      {
        kind: "task_context_changed",
      },
    );
  }
  await requireNativeSeoWorkerAccess(authContext, taskId, tx);
  return task;
}

/** Native SEO honors explicit Vendor refusal even for an already assigned, unbound service. */
export async function requireNativeSeoWorkerAccess(
  authContext: AuthenticationContext,
  taskId: string,
  tx: Prisma.TransactionClient,
) {
  if (!isCoworkerAuthContext(authContext)) return null;
  const analysis = await tx.projectSeoAnalysis.findUnique({
    where: { taskId },
    select: { id: true },
  });
  if (!analysis) return null;
  if (!(await lockTaskRows(tx, [taskId]))) throw notFound("Task not found");
  const task = await requireTaskCollaboration(authContext, taskId, tx);
  // A write, rather than a row lock alone, makes a stale Serializable caller retry.
  // The existing grant stays locked through billing or linking the signed upload.
  const [grant] = await tx.$queryRaw<Array<{ status: VendorGrantStatus }>>`
    UPDATE ${sharedTable("vendor_grant")} SET "updatedAt" = "updatedAt"
    WHERE "vendorId" = ${authContext.vendorId}::uuid
      AND "workspaceId" = ${task.workspaceId}::uuid
    RETURNING "status"
  `;
  if (grant && isGrantDeniedOrRevoked(grant.status))
    throwGrantAccessError(grant.status);
  return task;
}
