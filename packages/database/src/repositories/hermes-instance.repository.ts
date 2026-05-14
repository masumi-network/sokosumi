import type { HermesInstance, Prisma } from "../generated/prisma/client.js";

/**
 * Sokosumi-side metadata about each user's Hermes instance. The orchestrator
 * owns instance lifecycle; this table only tracks polling metadata used by
 * the inbox cron.
 */
export const hermesInstanceRepository = {
  async getByUserId(
    userId: string,
    tx: Prisma.TransactionClient,
  ): Promise<HermesInstance | null> {
    return tx.hermesInstance.findUnique({ where: { userId } });
  },

  /**
   * Insert a row if missing; otherwise no-op. Cheap and idempotent — safe to
   * call from any code path that observes a live orchestrator instance.
   */
  async upsertForUser(
    userId: string,
    tx: Prisma.TransactionClient,
  ): Promise<HermesInstance> {
    return tx.hermesInstance.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  },

  /**
   * Find instances due for polling now, ordered oldest-polled first to give
   * fair coverage when the cron only processes a slice per tick.
   *
   * Tier interval thresholds are computed by the caller and passed in — the
   * repo just executes the query. This keeps tier policy in one place
   * (the cron) and avoids hardcoding intervals in two locations.
   */
  async findDueForPoll(
    args: {
      hotCutoff: Date; // lastInboxMessageAt > this → instance is hot
      warmCutoff: Date; // lastInboxMessageAt > this (and not hot) → warm
      hotMaxLastPolledAt: Date; // poll if lastPolledAt < this when hot
      warmMaxLastPolledAt: Date;
      coldMaxLastPolledAt: Date;
      limit: number;
    },
    tx: Prisma.TransactionClient,
  ): Promise<HermesInstance[]> {
    return tx.hermesInstance.findMany({
      where: {
        OR: [
          // Hot: recent message AND due for hot-tier poll
          {
            lastInboxMessageAt: { gt: args.hotCutoff },
            OR: [
              { lastPolledAt: null },
              { lastPolledAt: { lt: args.hotMaxLastPolledAt } },
            ],
          },
          // Warm: somewhat recent message AND due for warm-tier poll
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
          // Cold: no recent message AND due for cold-tier poll
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
    const data: Prisma.HermesInstanceUpdateInput = {
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
    await tx.hermesInstance.update({
      where: { userId: args.userId },
      data,
    });
  },

  async deleteForUser(
    userId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.hermesInstance
      .delete({ where: { userId } })
      .catch(() => undefined);
  },

  /**
   * Count agent-initiated push messages (kind != null) the user hasn't seen
   * yet. Drives the sidebar unread badge.
   */
  async countUnreadInbox(
    userId: string,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const inst = await tx.hermesInstance.findUnique({
      where: { userId },
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

  /**
   * Mark all inbox-kind messages up to `asOf` as seen. Called when the user
   * is actively viewing the chat. Monotonic — never moves the cursor backward.
   */
  async markInboxSeen(
    args: { userId: string; asOf?: Date | null },
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const target = args.asOf ?? new Date();
    const inst = await tx.hermesInstance.findUnique({
      where: { userId: args.userId },
      select: { lastSeenInboxAt: true },
    });
    if (!inst) return;
    if (inst.lastSeenInboxAt && inst.lastSeenInboxAt >= target) return;
    await tx.hermesInstance.update({
      where: { userId: args.userId },
      data: { lastSeenInboxAt: target },
    });
  },
};
