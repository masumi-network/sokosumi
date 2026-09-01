import type { Prisma } from "@sokosumi/database";

import {
  type TaskAssigner,
  requireTaskAssignableCoworker,
} from "@/helpers/access-control";
import { forbidden, unprocessableEntity } from "@/helpers/error";

export interface TaskAssigneeRequestFields {
  assigneeId?: string | null;
  assigneeOrchestratorId?: string | null;
}

export interface ResolvedTaskAssignee {
  assigneeId: string | null;
  assigneeOrchestratorId: string | null;
}

export function hasResolvedTaskAssignee(
  assignee: ResolvedTaskAssignee,
): boolean {
  return assignee.assigneeId != null || assignee.assigneeOrchestratorId != null;
}

export function refineTaskAssigneeXorConflict(
  data: TaskAssigneeRequestFields,
  ctx: {
    addIssue: (issue: {
      code: "custom";
      message: string;
      path: Array<string | number>;
    }) => void;
  },
): void {
  const hasCoworker =
    data.assigneeId !== undefined &&
    data.assigneeId !== null &&
    data.assigneeId !== "";
  const hasOrchestrator =
    data.assigneeOrchestratorId !== undefined &&
    data.assigneeOrchestratorId !== null &&
    data.assigneeOrchestratorId !== "";
  if (hasCoworker && hasOrchestrator) {
    ctx.addIssue({
      code: "custom",
      message: "assigneeId and assigneeOrchestratorId are mutually exclusive",
      path: ["assigneeOrchestratorId"],
    });
  }
}

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

/** Dual-rail: orchestrator assignee or legacy shadow coworker assignee. */
export function isTaskAssignedToSokoBot(
  task: {
    assigneeOrchestratorId?: string | null;
    assigneeId?: string | null;
    assignee?: { sokoBotId?: string | null } | null;
  },
  bot: { id: string; coworkerId?: string | null },
): boolean {
  if (task.assigneeOrchestratorId === bot.id) return true;
  if (bot.coworkerId && task.assigneeId === bot.coworkerId) return true;
  if (task.assignee?.sokoBotId === bot.id) return true;
  return false;
}
