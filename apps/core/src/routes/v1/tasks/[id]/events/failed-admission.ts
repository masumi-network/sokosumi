import { createHash } from "node:crypto";
import { z } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";
import { conflict, forbidden } from "@/helpers/error";
import { requireTaskWorkerContext } from "@/helpers/task-worker-context";
import { getSeoAnalysisExecution } from "@/lib/seo/analysis-executor-config";
import {
  type AuthenticationContext,
  requireCoworkerAuthContext,
} from "@/middleware/auth";
import { taskWorkerContextSchema } from "@/schemas/task-worker-context.schema";

export const failedAdmissionSchema = z.strictObject({
  expectedContext: taskWorkerContextSchema,
  expectedInputFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  expectedStatus: z.enum(["READY", "INPUT_REQUIRED"]),
  expectedLastStatusEventId: z.uuid(),
  comment: z.string().trim().min(1).max(2000),
});

/** The Task row stays locked from validation until the FAILED event and status commit. */
export async function requireFailedSeoAdmission(
  auth: AuthenticationContext,
  taskId: string,
  input: z.infer<typeof failedAdmissionSchema>,
  tx: Prisma.TransactionClient,
) {
  const coworker = requireCoworkerAuthContext(auth);
  const { executor } = getSeoAnalysisExecution();
  const context = input.expectedContext;
  if (
    coworker.context ||
    !executor ||
    executor.coworkerId !== coworker.coworkerId ||
    (!("mode" in executor) &&
      (executor.workspaceId !== context.workspaceId ||
        executor.ownerId !== context.ownerId ||
        executor.organizationId !== context.organizationId))
  )
    throw forbidden("Only the assigned SEO worker can close an admission.");

  const task = await requireTaskWorkerContext(
    auth,
    taskId,
    context,
    tx,
    forbidden,
  );
  // The worker hashes the canonical JSON for these two fields in this order.
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ description: task.description, name: task.name }))
    .digest("hex");
  if (
    task.status !== input.expectedStatus ||
    fingerprint !== input.expectedInputFingerprint
  ) {
    throw conflict("The SEO Task or its input changed.");
  }
  const lastStatus = await tx.taskEvent.findFirst({
    where: { taskId, status: { not: null } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, status: true },
  });
  if (
    lastStatus?.id !== input.expectedLastStatusEventId ||
    lastStatus.status !== input.expectedStatus
  ) {
    throw conflict("The SEO Task entered a different status event.");
  }
}
