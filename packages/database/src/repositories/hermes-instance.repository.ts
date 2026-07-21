import type { Orchestrator, Prisma } from "../generated/prisma/client.js";

/**
 * Per-user Hermes orchestrator instance (local mirror + poll metadata).
 * Kept under the historical module name for import stability; the table is
 * `orchestrator`.
 */
export const hermesInstanceRepository = {
  async getByUserId(
    userId: string,
    tx: Prisma.TransactionClient,
  ): Promise<Orchestrator | null> {
    return tx.orchestrator.findFirst({
      where: { userId, archivedAt: null },
    });
  },

  /**
   * Insert a row if missing; otherwise no-op. Cheap and idempotent — safe to
   * call from any code path that observes a live orchestrator instance.
   */
  async upsertForUser(
    userId: string,
    tx: Prisma.TransactionClient,
  ): Promise<Orchestrator> {
    const existing = await tx.orchestrator.findUnique({ where: { userId } });
    if (!existing) {
      return tx.orchestrator.create({ data: { userId } });
    }
    if (existing.archivedAt != null) {
      return tx.orchestrator.update({
        where: { userId },
        data: {
          archivedAt: null,
          consecutivePollErrors: 0,
          lastPolledAt: null,
          lastInboxMessageAt: null,
          lastSeenInboxAt: null,
        },
      });
    }
    return existing;
  },

  /**
   * Find active instances due for polling now, ordered oldest-polled first.
   */
  async findDueForPoll(
    args: {
      hotCutoff: Date;
      warmCutoff: Date;
      hotMaxLastPolledAt: Date;
      warmMaxLastPolledAt: Date;
      coldMaxLastPolledAt: Date;
      limit: number;
    },
    tx: Prisma.TransactionClient,
  ): Promise<Orchestrator[]> {
    return tx.orchestrator.findMany({
      where: {
        archivedAt: null,
        OR: [
          {
            lastInboxMessageAt: { gt: args.hotCutoff },
            OR: [
              { lastPolledAt: null },
              { lastPolledAt: { lt: args.hotMaxLastPolledAt } },
            ],
          },
          {
            lastInboxMessageAt: {
              gt: args.warmCutoff,
              lte: args.hotCutoff,
            },
            OR: [
              { lastPolledAt: null },
              { lastPolledAt: { lt: args.warmMaxLastPolledAt } },
            ],
          },
          {
            OR: [
              { lastInboxMessageAt: null },
              { lastInboxMessageAt: { lte: args.warmCutoff } },
            ],
            AND: {
              OR: [
                { lastPolledAt: null },
                { lastPolledAt: { lt: args.coldMaxLastPolledAt } },
              ],
            },
          },
        ],
      },
      orderBy: [{ lastPolledAt: { sort: "asc", nulls: "first" } }],
      take: args.limit,
    });
  },

  async markPolled(
    args: {
      userId: string;
      lastInboxMessageAt?: Date | null;
      resetErrors?: boolean;
      incrementErrors?: boolean;
    },
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const data: Prisma.OrchestratorUpdateInput = {
      lastPolledAt: new Date(),
    };
    if (args.lastInboxMessageAt !== undefined) {
      data.lastInboxMessageAt = args.lastInboxMessageAt;
    }
    if (args.resetErrors) {
      data.consecutivePollErrors = 0;
    }
    if (args.incrementErrors) {
      data.consecutivePollErrors = { increment: 1 };
    }
    await tx.orchestrator.updateMany({
      where: { userId: args.userId, archivedAt: null },
      data,
    });
  },

  async deleteForUser(
    userId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    // Soft-archive (task creator FKs are Restrict).
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
  },

  async countUnreadInbox(
    userId: string,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const inst = await tx.orchestrator.findFirst({
      where: { userId, archivedAt: null },
      select: { lastSeenInboxAt: true },
    });
    if (!inst) return 0;
    return tx.hermesMessage.count({
      where: {
        userId,
        kind: { not: null },
        ...(inst.lastSeenInboxAt
          ? { createdAt: { gt: inst.lastSeenInboxAt } }
          : {}),
      },
    });
  },

  async markInboxSeen(
    args: { userId: string; asOf?: Date | null },
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const target = args.asOf ?? new Date();
    const inst = await tx.orchestrator.findFirst({
      where: { userId: args.userId, archivedAt: null },
      select: { lastSeenInboxAt: true },
    });
    if (!inst) return;
    if (inst.lastSeenInboxAt && inst.lastSeenInboxAt >= target) return;
    await tx.orchestrator.updateMany({
      where: { userId: args.userId, archivedAt: null },
      data: { lastSeenInboxAt: target },
    });
  },
};
