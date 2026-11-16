import type { Prisma } from "@sokosumi/database";

import { notFound } from "@/helpers/error";

/**
 * Hold the rows a Task send is checked against until the send commits: the
 * Task, the sender's organization membership, the room and the sender's room
 * membership. Making the Task private or moving it, removing the sender from
 * the organization or the room, and changing the room (its audience, archive
 * or guests, whose flows lock the room) all write one of these rows, so each
 * waits for the send, or the send waits for it and then reads its result.
 *
 * Run it first in the send transaction; the checks after it read current
 * state. Locks go in the order other flows take them: Member, then room, then
 * room membership. The Task and memberships are shared; the room is held for
 * update, so sends into one room run one after another and sends into
 * different rooms do not block one another. A missing row answers 404, as the
 * checks would.
 */
export async function lockTaskChatSend(
  tx: Prisma.TransactionClient,
  input: { taskId: string; roomId: string; userId: string },
): Promise<void> {
  const tasks = await tx.$queryRaw<{ workspaceId: string }[]>`
    SELECT "workspaceId" FROM "task" WHERE "id" = ${input.taskId} FOR SHARE
  `;
  const task = tasks[0];
  if (!task) throw notFound("Task not found");

  const workspaces = await tx.$queryRaw<{ organizationId: string | null }[]>`
    SELECT "organizationId" FROM "workspace"
    WHERE "id" = ${task.workspaceId}::uuid
  `;
  const organizationId = workspaces[0]?.organizationId ?? null;
  if (organizationId) {
    const members = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "member"
      WHERE "organizationId" = ${organizationId} AND "userId" = ${input.userId}
      FOR SHARE
    `;
    if (members.length === 0) throw notFound("Task not found");
  }

  // The room is locked for the write the send makes to it (room.updatedAt),
  // before any send writes. Taken shared, two sends into one room would both
  // hold it and then deadlock upgrading it. Room before room membership, as
  // the roster flows lock it.
  const rooms = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "chat_room" WHERE "id" = ${input.roomId}::uuid
    FOR NO KEY UPDATE
  `;
  if (rooms.length === 0) throw notFound("Room not found");

  const roomMembers = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "chat_room_user_member"
    WHERE "roomId" = ${input.roomId}::uuid AND "userId" = ${input.userId}
    FOR SHARE
  `;
  if (roomMembers.length === 0) throw notFound("Room not found");
}
