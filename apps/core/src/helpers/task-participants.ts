import type { Prisma } from "@sokosumi/database";

import { resolveMentionedUserIds } from "@/routes/v1/chats/rooms/helpers";

interface ParticipantClient {
  workspace: {
    findUnique: Prisma.TransactionClient["workspace"]["findUnique"];
  };
  taskParticipant: {
    findMany: Prisma.TransactionClient["taskParticipant"]["findMany"];
    createMany: Prisma.TransactionClient["taskParticipant"]["createMany"];
  };
}

/**
 * Workspace humans a Task comment may @.
 * Personal workspace: its user. Organization workspace: current members.
 */
export async function listTaskWorkspaceMembers(
  tx: ParticipantClient,
  workspaceId: string,
): Promise<Array<{ id: string; name: string }>> {
  const workspace = await tx.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      user: { select: { id: true, name: true } },
      organization: {
        select: {
          members: {
            select: { user: { select: { id: true, name: true } } },
          },
        },
      },
    },
  });

  if (!workspace) {
    return [];
  }

  if (workspace.organization) {
    return workspace.organization.members.map((member) => member.user);
  }

  return workspace.user ? [workspace.user] : [];
}

/**
 * Add workspace members named by a Task comment. Unknown ids are ignored.
 * `@all` does not add the workspace. Already-present users are left as they are.
 * Returns only the user ids inserted by this call.
 */
export async function addTaskParticipantsFromComment(
  tx: ParticipantClient,
  params: {
    taskId: string;
    workspaceId: string;
    comment: string;
    mentionedUserIds?: readonly string[];
  },
): Promise<string[]> {
  const members = await listTaskWorkspaceMembers(tx, params.workspaceId);
  const mentionedUserIds = resolveMentionedUserIds({
    content: params.comment,
    explicitUserIds: params.mentionedUserIds,
    roomUsers: members,
    expandAll: false,
  });

  if (mentionedUserIds.length === 0) {
    return [];
  }

  const existing = await tx.taskParticipant.findMany({
    where: { taskId: params.taskId, userId: { in: mentionedUserIds } },
    select: { userId: true },
  });
  const already = new Set(existing.map((row) => row.userId));
  const addedUserIds = mentionedUserIds.filter(
    (userId) => !already.has(userId),
  );

  if (addedUserIds.length === 0) {
    return [];
  }

  await tx.taskParticipant.createMany({
    data: addedUserIds.map((userId) => ({
      taskId: params.taskId,
      userId,
    })),
    skipDuplicates: true,
  });

  return addedUserIds;
}
