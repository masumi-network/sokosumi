import type { Orchestrator, Prisma } from "@sokosumi/database";

import { notFound } from "@/helpers/error";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
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

async function applyEnsureOnExisting(
  existing: OrchestratorInstance,
  patch: EnsureOrchestratorPatch,
  tx: Prisma.TransactionClient | typeof prisma,
): Promise<OrchestratorInstance> {
  if (existing.archivedAt == null) {
    if (Object.keys(patch).length === 0) {
      return existing;
    }
    return tx.orchestrator.update({
      where: { id: existing.id },
      data: patchData(patch),
    });
  }

  // Re-activate: unarchive and reset poll cursors so a fresh instance does not
  // inherit stale inbox/poll state.
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
 * Create or unarchive the user's orchestrator instance. Resets poll state
 * only when re-activating an archived row.
 *
 * Concurrent creates race on unique `userId`: on P2002, re-read and apply
 * the update/unarchive path (same end state as a lone winner).
 */
export async function ensureOrchestratorForUser(
  userId: string,
  patch: EnsureOrchestratorPatch = {},
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<OrchestratorInstance> {
  const existing = await findOrchestratorForUser(userId, tx);

  if (existing) {
    return applyEnsureOnExisting(existing, patch, tx);
  }

  try {
    return await tx.orchestrator.create({
      data: {
        userId,
        name: patch.name ?? null,
        avatarSeed: patch.avatarSeed ?? null,
        personalityTone: patch.personalityTone ?? null,
        personalityDetail: patch.personalityDetail ?? null,
        personalityStyle: patch.personalityStyle ?? null,
      },
    });
  } catch (error) {
    if (!isPrismaUniqueViolation(error)) {
      throw error;
    }
    const raced = await findOrchestratorForUser(userId, tx);
    if (!raced) {
      throw error;
    }
    return applyEnsureOnExisting(raced, patch, tx);
  }
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
