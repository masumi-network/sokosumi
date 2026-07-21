import type { Orchestrator, Prisma } from "@sokosumi/database";

import { notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";

export type OrchestratorInstance = Orchestrator;

/**
 * Active (non-archived) orchestrator for a user, or null.
 */
export async function findActiveOrchestratorForUser(
  userId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<OrchestratorInstance | null> {
  return tx.orchestrator.findFirst({
    where: { userId, archivedAt: null },
  });
}

/**
 * Any orchestrator row for a user (including archived), or null.
 */
export async function findOrchestratorForUser(
  userId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<OrchestratorInstance | null> {
  return tx.orchestrator.findUnique({
    where: { userId },
  });
}

/**
 * Require an active orchestrator for attribution / instance ops.
 */
export async function requireActiveOrchestratorForUser(
  userId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<OrchestratorInstance> {
  const orchestrator = await findActiveOrchestratorForUser(userId, tx);
  if (!orchestrator) {
    throw notFound("Orchestrator instance not found for user");
  }
  return orchestrator;
}

export interface EnsureOrchestratorPatch {
  name?: string | null;
  avatarSeed?: string | null;
  personalityTone?: number | null;
  personalityDetail?: number | null;
  personalityStyle?: number | null;
}

function patchData(
  patch: EnsureOrchestratorPatch,
): Prisma.OrchestratorUpdateInput {
  const data: Prisma.OrchestratorUpdateInput = {};
  if (patch.name !== undefined) {
    data.name = patch.name;
  }
  if (patch.avatarSeed !== undefined) {
    data.avatarSeed = patch.avatarSeed;
  }
  if (patch.personalityTone !== undefined) {
    data.personalityTone = patch.personalityTone;
  }
  if (patch.personalityDetail !== undefined) {
    data.personalityDetail = patch.personalityDetail;
  }
  if (patch.personalityStyle !== undefined) {
    data.personalityStyle = patch.personalityStyle;
  }
  return data;
}

/**
 * Create or unarchive the user's orchestrator instance. Resets poll state
 * only when re-activating an archived row.
 */
export async function ensureOrchestratorForUser(
  userId: string,
  patch: EnsureOrchestratorPatch = {},
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<OrchestratorInstance> {
  const existing = await findOrchestratorForUser(userId, tx);

  if (!existing) {
    return tx.orchestrator.create({
      data: {
        userId,
        name: patch.name ?? null,
        avatarSeed: patch.avatarSeed ?? null,
        personalityTone: patch.personalityTone ?? null,
        personalityDetail: patch.personalityDetail ?? null,
        personalityStyle: patch.personalityStyle ?? null,
      },
    });
  }

  if (existing.archivedAt == null) {
    if (Object.keys(patch).length === 0) {
      return existing;
    }
    return tx.orchestrator.update({
      where: { id: existing.id },
      data: patchData(patch),
    });
  }

  return tx.orchestrator.update({
    where: { id: existing.id },
    data: {
      archivedAt: null,
      consecutivePollErrors: 0,
      lastPolledAt: null,
      lastInboxMessageAt: null,
      lastSeenInboxAt: null,
      ...patchData(patch),
    },
  });
}

/**
 * Archive orchestrator and clear poll metadata. Idempotent when already
 * archived or missing. Does not delete the row (task creator FKs are Restrict).
 */
export async function archiveOrchestratorForUser(
  userId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  await tx.orchestrator.updateMany({
    where: { userId, archivedAt: null },
    data: {
      archivedAt: new Date(),
      lastPolledAt: null,
      lastInboxMessageAt: null,
      lastSeenInboxAt: null,
      consecutivePollErrors: 0,
    },
  });
}

/**
 * Wipe Sokosumi's per-user Hermes mirror: chat history, pending OAuth claims,
 * and archive the orchestrator (poll cursors cleared). Idempotent. Used by
 * user destroy, fresh provision cleanup, and POST /orchestrators/me/purge.
 */
export async function clearHermesLocalMirrorForUser(
  userId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.hermesMessage.deleteMany({ where: { userId } });
    await tx.hermesPendingConnection.deleteMany({ where: { userId } });
    await archiveOrchestratorForUser(userId, tx);
  });
}
