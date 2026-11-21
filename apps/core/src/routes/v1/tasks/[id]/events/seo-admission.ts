import { createHash } from "node:crypto";
import { z } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";
import { conflict, forbidden } from "@/helpers/error";
import { requireTaskWorkerContext } from "@/helpers/task-worker-context";
import { isConfiguredSeoExecutor } from "@/lib/seo/analysis-executor-config";
import {
  type AuthenticationContext,
  requireCoworkerAuthContext,
} from "@/middleware/auth";
import { taskWorkerContextSchema } from "@/schemas/task-worker-context.schema";

const inputFingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);
const admissionCommentSchema = z.string().trim().min(1).max(2000);

export const failedAdmissionSchema = z.strictObject({
  expectedContext: taskWorkerContextSchema,
  expectedInputFingerprint: inputFingerprintSchema,
  expectedStatus: z.enum(["READY", "INPUT_REQUIRED"]),
  expectedLastStatusEventId: z.uuid(),
  expectedLatestEventId: z.uuid().optional(),
  comment: admissionCommentSchema,
});

export const startAdmissionSchema = z.strictObject({
  status: z.literal("RUNNING"),
  comment: admissionCommentSchema,
  expectedContext: taskWorkerContextSchema,
  admission: z.strictObject({
    eventId: z.uuid(),
    inputFingerprint: inputFingerprintSchema,
  }),
});

/** The Task row stays locked from validation until the FAILED event and status commit.
 * A start holds the same lock until the RUNNING event and status commit.
 */
export async function requireSeoAdmission(
  auth: AuthenticationContext,
  taskId: string,
  input:
    | z.infer<typeof failedAdmissionSchema>
    | z.infer<typeof startAdmissionSchema>,
  tx: Prisma.TransactionClient,
) {
  const coworker = requireCoworkerAuthContext(auth);
  const context = input.expectedContext;
  if (!isConfiguredSeoExecutor(coworker, context))
    throw forbidden("Only the assigned SEO worker can update an admission.");

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
  const start = "admission" in input;
  const matchesStatus = start
    ? task.status === "READY" || task.status === "INPUT_REQUIRED"
    : task.status === input.expectedStatus;
  const expectedFingerprint = start
    ? input.admission.inputFingerprint
    : input.expectedInputFingerprint;
  if (!matchesStatus || fingerprint !== expectedFingerprint)
    throw conflict("The SEO Task or its input changed.");

  const expectedLatestEventId = start
    ? input.admission.eventId
    : input.expectedLatestEventId;
  if (expectedLatestEventId) {
    const latestEvent = await tx.taskEvent.findFirst({
      where: { taskId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    if (latestEvent?.id !== expectedLatestEventId)
      throw conflict("The SEO Task received another event.");
  }
  if (start) return;
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
