import type { Prisma } from "@sokosumi/database";

interface MentionClient {
  taskEventMention: {
    updateMany: Prisma.TransactionClient["taskEventMention"]["updateMany"];
    createMany: Prisma.TransactionClient["taskEventMention"]["createMany"];
  };
}

/**
 * Records who a stored Task comment names, and treats the comment as the
 * author's answer to every mention of them on the Task that is still open.
 * The answer is written first, so a comment never answers its own mentions.
 * Run it in the transaction that creates the comment.
 */
export async function recordTaskCommentMentions(
  tx: MentionClient,
  params: {
    taskId: string;
    taskEventId: string;
    /** Human who wrote the comment. Null when a Coworker or agent wrote. */
    authorUserId: string | null;
    mentionedUserIds: readonly string[];
    now: Date;
  },
): Promise<void> {
  if (params.authorUserId) {
    await tx.taskEventMention.updateMany({
      where: {
        taskId: params.taskId,
        userId: params.authorUserId,
        answeredAt: null,
      },
      data: { answeredAt: params.now },
    });
  }

  if (params.mentionedUserIds.length === 0) {
    return;
  }

  await tx.taskEventMention.createMany({
    data: params.mentionedUserIds.map((userId) => ({
      taskId: params.taskId,
      taskEventId: params.taskEventId,
      userId,
    })),
    skipDuplicates: true,
  });
}
