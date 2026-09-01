import type { Prisma } from "@sokosumi/database";

import {
  requireTaskAssignableCoworker,
  type TaskAssigner,
} from "@/helpers/access-control";
import { forbidden, unprocessableEntity } from "@/helpers/error";
import type {
  ResolvedTaskAssignee,
  TaskAssigneeRequestFields,
} from "@/helpers/task-assignee";

/**
 * Write-time remap: shadow PA coworker assigneeId → assigneeOrchestratorId.
 * Validates owner-scoped orchestrator assignability and coworker assignability.
 */
export async function resolveTaskAssigneeForWrite(
  input: TaskAssigneeRequestFields,
  params: {
    workspaceId: string;
    assigner: TaskAssigner;
  },
  tx: Prisma.TransactionClient,
): Promise<ResolvedTaskAssignee> {
  const assigneeIdProvided = input.assigneeId !== undefined;
  const orchestratorProvided = input.assigneeOrchestratorId !== undefined;
  if (!assigneeIdProvided && !orchestratorProvided) {
    throw new Error(
      "resolveTaskAssigneeForWrite requires at least one assignee field",
    );
  }

  let assigneeId = assigneeIdProvided ? (input.assigneeId ?? null) : null;
  let assigneeOrchestratorId = orchestratorProvided
    ? (input.assigneeOrchestratorId ?? null)
    : null;

  if (orchestratorProvided && !assigneeIdProvided) {
    assigneeId = null;
  }
  if (assigneeIdProvided && !orchestratorProvided) {
    assigneeOrchestratorId = null;
  }

  if (assigneeId != null && assigneeOrchestratorId != null) {
    throw unprocessableEntity(
      "assigneeId and assigneeOrchestratorId are mutually exclusive",
    );
  }

  if (assigneeId) {
    const shadow = await tx.coworker.findFirst({
      where: { id: assigneeId, sokoBotId: { not: null } },
      select: {
        sokoBotId: true,
        sokoBot: {
          select: {
            userId: true,
            workspaceId: true,
            archivedAt: true,
            deletedAt: true,
          },
        },
      },
    });
    const bot = shadow?.sokoBot;
    if (
      shadow?.sokoBotId &&
      bot &&
      bot.workspaceId === params.workspaceId &&
      bot.archivedAt == null &&
      bot.deletedAt == null
    ) {
      const isOwnerAssigner =
        params.assigner?.kind === "user" &&
        bot.userId === params.assigner.userId;
      const isSelfBotAssigner =
        params.assigner?.kind === "soko_bot" &&
        shadow.sokoBotId === params.assigner.sokoBotId;
      if (isOwnerAssigner || isSelfBotAssigner) {
        assigneeOrchestratorId = shadow.sokoBotId;
        assigneeId = null;
      }
    }
  }

  const resolved: ResolvedTaskAssignee = {
    assigneeId,
    assigneeOrchestratorId,
  };

  if (resolved.assigneeId) {
    await requireTaskAssignableCoworker(
      resolved.assigneeId,
      params.workspaceId,
      tx,
      params.assigner,
    );
  }
  if (resolved.assigneeOrchestratorId) {
    await requireTaskAssignableOrchestrator(
      resolved.assigneeOrchestratorId,
      params.workspaceId,
      tx,
      params.assigner,
    );
  }

  return resolved;
}

/**
 * Owner-scoped PA assignability. Only the bot owner (or the bot itself) may
 * task the orchestrator assignee rail.
 */
export async function requireTaskAssignableOrchestrator(
  orchestratorId: string,
  workspaceId: string,
  tx: Prisma.TransactionClient,
  assigner: TaskAssigner = null,
): Promise<void> {
  const bot = await tx.sokoBot.findFirst({
    where: {
      id: orchestratorId,
      workspaceId,
      archivedAt: null,
      deletedAt: null,
    },
    select: { id: true, userId: true },
  });
  if (!bot) {
    throw forbidden("Only the owner can assign work to this Soko Bot");
  }
  if (!assigner) return;
  const isOwner =
    assigner.kind === "user"
      ? bot.userId === assigner.userId
      : assigner.kind === "soko_bot" && bot.id === assigner.sokoBotId;
  if (!isOwner) {
    throw forbidden("Only the owner can assign work to this Soko Bot");
  }
}
