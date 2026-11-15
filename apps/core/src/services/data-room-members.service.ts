import {
  type DataRoom,
  DataRoomEventKind,
  type DataRoomMember,
  FileSourceScope,
} from "@sokosumi/database";
import { normalizeDriveFolderPath } from "@sokosumi/utils";

import { badRequest, forbidden, notFound } from "@/helpers/error";
import { isOrganizationOwnerOrAdmin } from "@/helpers/organization-role";
import { canSeeDataRoom } from "@/lib/data-room-visibility";
import prisma from "@/lib/db/prisma";
import type { DataRoomCaller } from "@/services/data-room.service";
import {
  logDataRoomEvent,
  memberSeesPath,
  normalizeEmail,
} from "@/services/data-room-access.service";
import { findDataRoomFile } from "@/services/data-room-files.service";

/**
 * A room of this Drive the caller may run, or 404: one Drive's owner never
 * reaches another's, and an organization member outside a room never learns
 * it is there.
 */
export async function requireOwnedDataRoom(
  store: DataRoomCaller,
  roomId: string,
): Promise<DataRoom> {
  const room = await prisma.dataRoom.findFirst({
    where: {
      id: roomId,
      sourceScope:
        store.scope === "user"
          ? FileSourceScope.USER
          : FileSourceScope.ORGANIZATION,
      ownerId: store.ownerId,
    },
  });
  if (!room || !(await canSeeDataRoom(room, store.actor)))
    throw notFound("Data room not found");
  return room;
}

/** The maker and the organization's owners and admins choose who else is in. */
export async function canChooseDataRoomColleagues(
  room: DataRoom,
  actor: DataRoomCaller["actor"],
): Promise<boolean> {
  if (room.sourceScope !== FileSourceScope.ORGANIZATION) return false;
  if (room.createdByUserId === actor.userId) return true;
  const member = await prisma.member.findUnique({
    where: {
      userId_organizationId: {
        userId: actor.userId,
        organizationId: room.ownerId,
      },
    },
    select: { role: true },
  });
  return member !== null && isOrganizationOwnerOrAdmin(member.role);
}

export async function listDataRoomColleagues(roomId: string) {
  const rows = await prisma.dataRoomColleague.findMany({
    where: { roomId },
    select: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(({ user }) => ({
    userId: user.id,
    name: user.name,
    email: user.email,
  }));
}

/** Replaces who else in the organization is let in. Leaving someone out takes them out. */
export async function setDataRoomColleagues(input: {
  store: DataRoomCaller;
  roomId: string;
  userIds: readonly string[];
}) {
  const room = await requireOwnedDataRoom(input.store, input.roomId);
  if (room.sourceScope !== FileSourceScope.ORGANIZATION)
    throw badRequest("A personal data room is yours alone");
  if (!(await canChooseDataRoomColleagues(room, input.store.actor)))
    throw forbidden(
      "Only the person who made this room and the organization's owners and admins choose who is in it",
    );
  const userIds = [...new Set(input.userIds)];
  const members = await prisma.member.findMany({
    where: { organizationId: room.ownerId, userId: { in: userIds } },
    select: { userId: true },
  });
  if (members.length !== userIds.length)
    throw badRequest("Everyone let in must be a member of the organization");
  await prisma.$transaction([
    prisma.dataRoomColleague.deleteMany({
      where: { roomId: room.id, userId: { notIn: userIds } },
    }),
    prisma.dataRoomColleague.createMany({
      data: userIds.map((userId) => ({
        roomId: room.id,
        userId,
        addedByUserId: input.store.actor.userId,
      })),
      skipDuplicates: true,
    }),
  ]);
  return listDataRoomColleagues(room.id);
}

const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanDomains(domains: readonly string[]): string[] {
  const cleaned = [
    ...new Set(
      domains.map((domain) => domain.trim().toLowerCase().replace(/^@/, "")),
    ),
  ].filter(Boolean);
  const invalid = cleaned.find((domain) => !DOMAIN.test(domain));
  if (invalid) throw badRequest(`"${invalid}" is not an email domain`);
  return cleaned;
}

function cleanFolderPaths(paths: readonly string[]): string[] {
  return [...new Set(paths.map(normalizeDriveFolderPath))].filter(Boolean);
}

export async function updateDataRoomSettings(input: {
  store: DataRoomCaller;
  roomId: string;
  title?: string | null;
  welcomeNote?: string | null;
  logoFileId?: string | null;
  allowedDomains?: string[];
  expiresAt?: Date | null;
  allowDownload?: boolean;
  watermark?: boolean;
  notifyOnFirstVisit?: boolean;
}): Promise<DataRoom> {
  const room = await requireOwnedDataRoom(input.store, input.roomId);
  if (input.logoFileId) {
    const logo = await prisma.fileResource.findFirst({
      where: { id: input.logoFileId, workspaceId: room.workspaceId },
      select: { mimeType: true },
    });
    if (!logo?.mimeType?.startsWith("image/"))
      throw badRequest("The logo must be an image from this workspace's Files");
  }
  return prisma.dataRoom.update({
    where: { id: room.id },
    data: {
      ...(input.title !== undefined
        ? { title: input.title?.trim() || null }
        : {}),
      ...(input.welcomeNote !== undefined
        ? { welcomeNote: input.welcomeNote?.trim() || null }
        : {}),
      ...(input.logoFileId !== undefined
        ? { logoFileId: input.logoFileId }
        : {}),
      ...(input.allowedDomains
        ? { allowedDomains: cleanDomains(input.allowedDomains) }
        : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      ...(input.allowDownload !== undefined
        ? { allowDownload: input.allowDownload }
        : {}),
      ...(input.watermark !== undefined ? { watermark: input.watermark } : {}),
      ...(input.notifyOnFirstVisit !== undefined
        ? { notifyOnFirstVisit: input.notifyOnFirstVisit }
        : {}),
    },
  });
}

export interface DataRoomMemberSummary {
  member: DataRoomMember;
  views: number;
  downloads: number;
}

export async function listDataRoomMembers(
  room: Pick<DataRoom, "id">,
): Promise<DataRoomMemberSummary[]> {
  const [members, counts] = await Promise.all([
    prisma.dataRoomMember.findMany({
      where: { roomId: room.id },
      orderBy: [{ revokedAt: "asc" }, { createdAt: "asc" }],
    }),
    prisma.dataRoomEvent.groupBy({
      by: ["memberId", "kind"],
      where: {
        roomId: room.id,
        kind: {
          in: [
            DataRoomEventKind.VIEW,
            DataRoomEventKind.DOWNLOAD,
            DataRoomEventKind.DOWNLOAD_ALL,
          ],
        },
      },
      _count: { _all: true },
    }),
  ]);
  return members.map((member) => {
    const mine = counts.filter((count) => count.memberId === member.id);
    const total = (kinds: DataRoomEventKind[]) =>
      mine
        .filter((count) => kinds.includes(count.kind))
        .reduce((sum, count) => sum + count._count._all, 0);
    return {
      member,
      views: total([DataRoomEventKind.VIEW]),
      downloads: total([
        DataRoomEventKind.DOWNLOAD,
        DataRoomEventKind.DOWNLOAD_ALL,
      ]),
    };
  });
}

/**
 * Lets people in, or back in. A person already invited keeps their record
 * and history; one who was removed comes back. Returns everyone this call
 * let in, for the invitation emails.
 */
export async function inviteDataRoomMembers(input: {
  store: DataRoomCaller;
  roomId: string;
  emails: string[];
  name?: string | null;
  expiresAt?: Date | null;
  folderPaths?: string[];
  invitedByUserId: string;
}): Promise<{ room: DataRoom; invited: DataRoomMember[] }> {
  const room = await requireOwnedDataRoom(input.store, input.roomId);
  const emails = [...new Set(input.emails.map(normalizeEmail))].filter(Boolean);
  if (emails.length === 0) throw badRequest("Add at least one email address");
  const invalid = emails.find((email) => !EMAIL.test(email));
  if (invalid) throw badRequest(`"${invalid}" is not an email address`);
  const folderPaths = cleanFolderPaths(input.folderPaths ?? []);
  const invited: DataRoomMember[] = [];
  for (const email of emails) {
    invited.push(
      await prisma.dataRoomMember.upsert({
        where: { roomId_email: { roomId: room.id, email } },
        create: {
          roomId: room.id,
          email,
          name: input.name?.trim() || null,
          invitedByUserId: input.invitedByUserId,
          expiresAt: input.expiresAt ?? null,
          folderPaths,
        },
        update: {
          revokedAt: null,
          invitedByUserId: input.invitedByUserId,
          ...(input.name !== undefined
            ? { name: input.name?.trim() || null }
            : {}),
          ...(input.expiresAt !== undefined
            ? { expiresAt: input.expiresAt }
            : {}),
          ...(input.folderPaths ? { folderPaths } : {}),
        },
      }),
    );
  }
  return { room, invited };
}

export async function updateDataRoomMember(input: {
  store: DataRoomCaller;
  roomId: string;
  memberId: string;
  name?: string | null;
  expiresAt?: Date | null;
  folderPaths?: string[];
}): Promise<DataRoomMember> {
  const room = await requireOwnedDataRoom(input.store, input.roomId);
  const member = await prisma.dataRoomMember.findFirst({
    where: { id: input.memberId, roomId: room.id },
  });
  if (!member) throw notFound("Person not found");
  return prisma.dataRoomMember.update({
    where: { id: member.id },
    data: {
      ...(input.name !== undefined ? { name: input.name?.trim() || null } : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      ...(input.folderPaths
        ? { folderPaths: cleanFolderPaths(input.folderPaths) }
        : {}),
    },
  });
}

/**
 * Takes someone out of the room at once: their open sessions end on their
 * next request, and their code stops working.
 */
export async function revokeDataRoomMember(input: {
  store: DataRoomCaller;
  roomId: string;
  memberId: string;
}): Promise<void> {
  const room = await requireOwnedDataRoom(input.store, input.roomId);
  const { count } = await prisma.dataRoomMember.updateMany({
    where: { id: input.memberId, roomId: room.id },
    data: {
      revokedAt: new Date(),
      sessionVersion: { increment: 1 },
      codeHash: null,
      codeExpiresAt: null,
    },
  });
  if (count === 0) throw notFound("Person not found");
}

export async function listDataRoomEvents(input: {
  room: Pick<DataRoom, "id">;
  memberId?: string;
  before?: Date;
  take: number;
}) {
  return prisma.dataRoomEvent.findMany({
    where: {
      roomId: input.room.id,
      ...(input.memberId ? { memberId: input.memberId } : {}),
      ...(input.before ? { createdAt: { lt: input.before } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: input.take,
    include: { member: { select: { email: true, name: true } } },
  });
}

/** Replaces the owner's order: positions count from 1 within each folder. */
export async function setDataRoomOrder(input: {
  store: DataRoomCaller;
  roomId: string;
  entries: { path: string; position: number }[];
}): Promise<void> {
  const room = await requireOwnedDataRoom(input.store, input.roomId);
  await prisma.$transaction([
    prisma.dataRoomEntry.deleteMany({ where: { roomId: room.id } }),
    prisma.dataRoomEntry.createMany({
      data: input.entries.map((entry) => ({
        roomId: room.id,
        path: normalizeDriveFolderPath(entry.path),
        position: entry.position,
      })),
      skipDuplicates: true,
    }),
  ]);
}

export async function listDataRoomQuestions(input: {
  room: Pick<DataRoom, "id">;
  memberId?: string;
  path?: string;
}) {
  return prisma.dataRoomQuestion.findMany({
    where: {
      roomId: input.room.id,
      ...(input.memberId ? { memberId: input.memberId } : {}),
      ...(input.path ? { path: input.path } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: { member: { select: { email: true, name: true } } },
  });
}

export async function answerDataRoomQuestion(input: {
  store: DataRoomCaller;
  roomId: string;
  questionId: string;
  answer: string;
  userId: string;
}) {
  const room = await requireOwnedDataRoom(input.store, input.roomId);
  const answer = input.answer.trim();
  if (!answer) throw badRequest("Write an answer");
  const { count } = await prisma.dataRoomQuestion.updateMany({
    where: { id: input.questionId, roomId: room.id },
    data: { answer, answeredByUserId: input.userId, answeredAt: new Date() },
  });
  if (count === 0) throw notFound("Question not found");
}

/** A viewer's question about a document they can open. */
export async function askDataRoomQuestion(input: {
  room: DataRoom;
  member: DataRoomMember;
  resourceId: string;
  body: string;
}) {
  const body = input.body.trim();
  if (!body) throw badRequest("Write a question");
  const file = await findDataRoomFile(input.room, input.resourceId);
  if (!file || !memberSeesPath(input.member, file.path))
    throw notFound("File not found");
  const question = await prisma.dataRoomQuestion.create({
    data: {
      roomId: input.room.id,
      memberId: input.member.id,
      path: file.path,
      body,
    },
  });
  await logDataRoomEvent({
    roomId: input.room.id,
    memberId: input.member.id,
    kind: DataRoomEventKind.ASK,
    path: file.path,
  });
  return question;
}
