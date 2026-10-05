import { createHash } from "node:crypto";

import type { Prisma } from "@sokosumi/database";
import { z } from "zod";
import { enqueueSokoBotEffect } from "@/services/soko-bot-effect-outbox.service";

/** These effects cannot be repeated safely after an ambiguous transport failure. */
export const EXTERNAL_EFFECT_CAPABILITIES = new Set([
  "hire_agent",
  "provide_job_input",
  "run_integration_tool",
  "upload_file",
  "publish_social_post",
  // A paid provider call: never repeated after an unclear failure.
  "generate_image",
]);

export const ACTION_CAPABILITIES = new Set([
  ...EXTERNAL_EFFECT_CAPABILITIES,
  "create_task",
  "create_table",
  "write_table_rows",
  "update_table_columns",
  "update_task",
  "archive_task",
  "assign_task",
  "reply_to_task",
  "update_assigned_task",
  "link_tasks",
  "post_chat",
  "open_direct_chat",
  "create_schedule",
  "update_schedule",
  "delete_schedule",
  "update_memory",
  "manage_reminder",
  "create_social_post",
  "update_social_post",
  "schedule_social_post",
  "cancel_social_post",
]);

/** Object key order is not part of an operation's identity. */
export function canonicalActionJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalActionJson).join(",")}]`;
  }
  return `{${Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(
      ([key, entry]) => `${JSON.stringify(key)}:${canonicalActionJson(entry)}`,
    )
    .join(",")}}`;
}

export function actionInputHash(value: unknown): string {
  return createHash("sha256").update(canonicalActionJson(value)).digest("hex");
}

/**
 * Archival success requires the retained task and its committed history: the
 * bot's own archive event on it, in the turn's workspace. Who owns the Task is
 * not part of the proof; the archive already checked the owner may change it,
 * and a teammate's public Task archived that way must confirm too.
 */
export async function verifyTaskArchiveReceipt(
  tx: Prisma.TransactionClient,
  receiptId: string,
): Promise<boolean> {
  const receipt = await tx.sokoBotToolCall.findUnique({
    where: { id: receiptId },
    include: { turn: { select: { userId: true, workspaceId: true } } },
  });
  if (
    !receipt ||
    receipt.capability !== "archive_task" ||
    receipt.status !== "COMPLETED" ||
    receipt.verification !== "LOCAL_TRANSACTION" ||
    !receipt.committedAt ||
    !receipt.targetId ||
    !receipt.effectEventId ||
    !receipt.actorBotId ||
    !["APPLIED", "ALREADY_SATISFIED"].includes(receipt.disposition ?? "")
  )
    return false;
  return !!(await tx.task.findFirst({
    where: {
      id: receipt.targetId,
      workspaceId: receipt.turn.workspaceId,
      archivedAt: { not: null },
      events: {
        some: { id: receipt.effectEventId, sokoBotId: receipt.actorBotId },
      },
    },
    select: { id: true },
  }));
}

export function actionOperationKey(input: {
  workspaceId: string;
  principalId: string;
  intentRevision: string;
  capability: string;
  inputHash: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.workspaceId,
        input.principalId,
        input.intentRevision,
        input.capability,
        input.inputHash,
      ]),
    )
    .digest("hex");
}

/** Must be called in the same transaction as the effect. Never from a catch. */
export async function commitActionReceipt(
  tx: Prisma.TransactionClient,
  input: {
    turnId: string;
    toolCallId: string;
    actorBotId: string;
    targetId: string;
    effectEventId?: string;
    claimId?: string | null;
    observedVersion?: string;
    disposition?: "APPLIED" | "ALREADY_SATISFIED";
    result: Prisma.InputJsonValue;
  },
) {
  const receipt = await tx.sokoBotToolCall.update({
    where: {
      turnId_toolCallId: { turnId: input.turnId, toolCallId: input.toolCallId },
      status: "PENDING",
    },
    data: {
      status: "COMPLETED",
      disposition: input.disposition ?? "APPLIED",
      verification: "LOCAL_TRANSACTION",
      actorBotId: input.actorBotId,
      targetId: input.targetId,
      effectEventId: input.effectEventId,
      observedVersion: input.observedVersion,
      committedAt: new Date(),
      result: input.result,
    },
  });
  if (input.claimId) {
    await tx.sokoBotTaskActionClaim.update({
      where: {
        id: input.claimId,
        handlerBotId: input.actorBotId,
        turnId: input.turnId,
        receiptId: null,
      },
      data: { receiptId: receipt.id },
    });
  }
  const turn = await tx.sokoBotTurn.findUnique({
    where: { id: input.turnId },
    select: { intentId: true, intentRevision: true },
  });
  // Only a newly created task acquires a server-generated identity after the
  // request. Mutating an existing object must not expand later confirmation scope.
  if (turn?.intentId && receipt.capability === "create_task") {
    const intent = await tx.sokoBotIntent.findUnique({
      where: { id: turn.intentId },
      select: { targetIds: true },
    });
    const targets = Array.isArray(intent?.targetIds)
      ? intent.targetIds.filter((id): id is string => typeof id === "string")
      : [];
    if (!targets.includes(input.targetId)) {
      await tx.sokoBotIntent.update({
        where: {
          id: turn.intentId,
          revision: turn.intentRevision ?? undefined,
        },
        data: { targetIds: [...targets, input.targetId] },
      });
    }
  }
  if (
    input.effectEventId &&
    [
      "reply_to_task",
      "update_assigned_task",
      "create_task",
      "update_task",
      "archive_task",
      "assign_task",
    ].includes(receipt.capability)
  ) {
    await enqueueSokoBotEffect(tx, {
      receiptId: receipt.id,
      purpose: "TASK_EVENT",
      payload: { taskId: input.targetId, eventId: input.effectEventId },
    });
  }
  return receipt;
}

/** Only specific provider acknowledgments prove an external action. Arbitrary
 * integration payloads cannot attest that the user's requested business effect happened.
 */
export function externalActionReceipt(capability: string, result: unknown) {
  let targetId: string | null = null;
  // The studio refused before sending, and refunded: nothing happened.
  if (
    capability === "generate_image" &&
    z.object({ status: z.literal("FAILED") }).safeParse(result).success
  )
    return {
      targetId,
      disposition: "REJECTED" as const,
      verification: "NONE" as const,
      committedAt: null,
    };
  if (capability === "hire_agent" || capability === "provide_job_input") {
    const acknowledged = z
      .object({
        executed: z.literal(true),
        status: z.literal("ACCEPTED"),
        resultingEntityId: z.string().min(1).max(2048),
      })
      .safeParse(result);
    if (acknowledged.success) targetId = acknowledged.data.resultingEntityId;
  } else if (capability === "publish_social_post") {
    const acknowledged = z
      .object({
        id: z.string().trim().min(1).max(2048),
        status: z.literal("PUBLISHED"),
        publishedExternalId: z.string().trim().min(1).max(2048),
      })
      .safeParse(result);
    if (acknowledged.success) targetId = acknowledged.data.id;
  } else if (capability === "generate_image") {
    // Only a job the provider took; an uncertain submission stays UNKNOWN.
    const acknowledged = z
      .object({
        jobId: z.string().min(1).max(2048),
        status: z.enum([
          "PENDING",
          "SUBMITTING",
          "QUEUED",
          "RUNNING",
          "SUCCEEDED",
        ]),
      })
      .safeParse(result);
    if (acknowledged.success) targetId = acknowledged.data.jobId;
  } else if (capability === "upload_file") {
    const acknowledged = z
      .object({
        id: z.uuid(),
        filename: z.string().min(1),
        size: z.number().int().nonnegative(),
      })
      .safeParse(result);
    if (acknowledged.success) targetId = acknowledged.data.id;
  }
  return {
    targetId,
    disposition: targetId ? ("APPLIED" as const) : ("UNKNOWN" as const),
    verification: targetId ? ("PROVIDER_ACK" as const) : ("NONE" as const),
    committedAt: targetId ? new Date() : null,
  };
}
