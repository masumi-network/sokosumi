import type { HermesMessage, Prisma } from "../generated/prisma/client.js";

/**
 * Repository for the per-user Hermes conversation. There is at most one
 * logical conversation per user; messages are ordered by `createdAt` ASC.
 */
export const hermesMessageRepository = {
  /**
   * List the user's full Hermes conversation history, oldest first.
   */
  async listForUser(
    userId: string,
    tx: Prisma.TransactionClient,
  ): Promise<HermesMessage[]> {
    return tx.hermesMessage.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
  },

  /**
   * Persist a single message turn (user or assistant). Use `appendPair` for
   * the common case of a successful user→assistant round-trip.
   *
   * `kind` is set by the inbox cron for agent-initiated pushes (`task_result`,
   * `reminder`, etc.) — leave it undefined for normal user turns and chat
   * replies; the UI treats null/undefined as a regular conversation turn.
   */
  async append(
    args: {
      userId: string;
      role: "user" | "assistant" | "system";
      content: string;
      kind?: string | null;
    },
    tx: Prisma.TransactionClient,
  ): Promise<HermesMessage> {
    return tx.hermesMessage.create({
      data: {
        userId: args.userId,
        role: args.role,
        content: args.content,
        kind: args.kind ?? null,
      },
    });
  },

  /**
   * Persist a user message followed by its assistant reply atomically.
   * Returns both rows in chronological order.
   */
  async appendPair(
    args: { userId: string; userContent: string; assistantContent: string },
    tx: Prisma.TransactionClient,
  ): Promise<HermesMessage[]> {
    const user = await tx.hermesMessage.create({
      data: {
        userId: args.userId,
        role: "user",
        content: args.userContent,
      },
    });
    const assistant = await tx.hermesMessage.create({
      data: {
        userId: args.userId,
        role: "assistant",
        content: args.assistantContent,
      },
    });
    return [user, assistant];
  },

  /**
   * Wipe the user's entire Hermes conversation history.
   */
  async clearForUser(
    userId: string,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await tx.hermesMessage.deleteMany({
      where: { userId },
    });
    return result.count;
  },
};
