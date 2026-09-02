import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

export interface RemapPaShadowCoworkersResult {
  shadows: number;
  memberships: number;
  senders: number;
  mentions: number;
  assignees: number;
  creators: number;
  events: number;
  files: number;
  directKeys: number;
  deleted: number;
}

const EMPTY_REMAP: RemapPaShadowCoworkersResult = {
  shadows: 0,
  memberships: 0,
  senders: 0,
  mentions: 0,
  assignees: 0,
  creators: 0,
  events: 0,
  files: 0,
  directKeys: 0,
  deleted: 0,
};

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Rewrite `coworker:{userId}:{shadowId}` and `direct:v2:` tokens that name a
 * PA shadow coworker onto the orchestrator id.
 */
export function remapPaShadowDirectKey(
  directKey: string,
  shadowId: string,
  sokoBotId: string,
): string {
  const parts = directKey.split(":");
  if (parts.length === 3 && parts[0] === "coworker" && parts[2] === shadowId) {
    return `orchestrator:${parts[1]}:${sokoBotId}`;
  }
  if (directKey.startsWith("direct:v2:")) {
    return directKey.replaceAll(
      `coworker:${shadowId}`,
      `orchestrator:${sokoBotId}`,
    );
  }
  return directKey;
}

/**
 * Remap room/task identities off PA shadow coworkers, then delete those rows.
 * Production deploy uses the SQL migration; tests call this after inserting a
 * leftover shadow fixture. Idempotent when no `sokoBotId` rows remain.
 */
export async function remapPaShadowCoworkers(
  db: Db,
): Promise<RemapPaShadowCoworkersResult> {
  const shadows = await db.coworker.findMany({
    where: { sokoBotId: { not: null } },
    select: { id: true, sokoBotId: true },
  });
  const linked = shadows.flatMap((row) =>
    row.sokoBotId ? [{ id: row.id, sokoBotId: row.sokoBotId }] : [],
  );
  if (linked.length === 0) {
    return EMPTY_REMAP;
  }

  const shadowIds = linked.map((row) => row.id);
  const byShadowId = new Map(linked.map((row) => [row.id, row.sokoBotId]));

  let memberships = 0;
  let senders = 0;
  let mentions = 0;
  let assignees = 0;
  let creators = 0;
  let events = 0;
  let files = 0;
  let directKeys = 0;

  for (const shadow of linked) {
    const memberRows = await db.chatRoomCoworkerMember.findMany({
      where: { coworkerId: shadow.id },
      select: { roomId: true, createdAt: true },
    });
    const created = await db.chatRoomOrchestratorMember.createMany({
      data: memberRows.map((row) => ({
        roomId: row.roomId,
        orchestratorId: shadow.sokoBotId,
        createdAt: row.createdAt,
      })),
      skipDuplicates: true,
    });
    memberships += created.count;

    await db.chatRoomCoworkerMember.deleteMany({
      where: { coworkerId: shadow.id },
    });

    senders += (
      await db.chatRoomMessage.updateMany({
        where: { senderCoworkerId: shadow.id },
        data: {
          senderOrchestratorId: shadow.sokoBotId,
          senderCoworkerId: null,
        },
      })
    ).count;

    mentions += (
      await db.chatRoomMention.updateMany({
        where: { coworkerId: shadow.id },
        data: {
          orchestratorId: shadow.sokoBotId,
          coworkerId: null,
        },
      })
    ).count;

    assignees += (
      await db.task.updateMany({
        where: { assigneeId: shadow.id },
        data: {
          assigneeOrchestratorId: shadow.sokoBotId,
          assigneeId: null,
        },
      })
    ).count;

    creators += (
      await db.task.updateMany({
        where: {
          creatorCoworkerId: shadow.id,
          creatorOrchestratorId: null,
        },
        data: {
          creatorOrchestratorId: shadow.sokoBotId,
          creatorCoworkerId: null,
        },
      })
    ).count;
    creators += (
      await db.task.updateMany({
        where: {
          creatorCoworkerId: shadow.id,
          creatorOrchestratorId: { not: null },
        },
        data: { creatorCoworkerId: null },
      })
    ).count;

    events += (
      await db.taskEvent.updateMany({
        where: {
          coworkerId: shadow.id,
          orchestratorId: null,
        },
        data: {
          orchestratorId: shadow.sokoBotId,
          coworkerId: null,
        },
      })
    ).count;
    events += (
      await db.taskEvent.updateMany({
        where: {
          coworkerId: shadow.id,
          orchestratorId: { not: null },
        },
        data: { coworkerId: null },
      })
    ).count;

    files += (
      await db.taskFile.updateMany({
        where: { uploadedByCoworkerId: shadow.id },
        data: { uploadedByCoworkerId: null },
      })
    ).count;
  }

  const rooms = await db.chatRoom.findMany({
    where: {
      OR: [
        { directKey: { startsWith: "coworker:" } },
        { directKey: { startsWith: "direct:v2:" } },
      ],
    },
    select: { id: true, directKey: true },
  });
  for (const room of rooms) {
    if (!room.directKey) continue;
    let next = room.directKey;
    for (const [shadowId, sokoBotId] of byShadowId) {
      next = remapPaShadowDirectKey(next, shadowId, sokoBotId);
    }
    if (next !== room.directKey) {
      await db.chatRoom.update({
        where: { id: room.id },
        data: { directKey: next },
      });
      directKeys += 1;
    }
  }

  const deleted = await db.coworker.deleteMany({
    where: { id: { in: shadowIds } },
  });

  return {
    shadows: linked.length,
    memberships,
    senders,
    mentions,
    assignees,
    creators,
    events,
    files,
    directKeys,
    deleted: deleted.count,
  };
}
