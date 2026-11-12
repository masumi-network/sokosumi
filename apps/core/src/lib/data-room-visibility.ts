import { type DataRoom, FileSourceScope } from "@sokosumi/database";

import { isOrganizationOwnerOrAdmin } from "@/helpers/organization-role";
import prisma from "@/lib/db/prisma";
import { driveRoomsOf } from "@/lib/drive-blob";
import type { FileActor, FileActorKind } from "@/lib/files/actor";

/**
 * Who an organization data room is for: the member who made it, the
 * organization's owners and admins, and the colleagues they add. Everyone
 * else in the organization never sees it: not in Files, search, recents, or
 * through an agent.
 *
 * Only people get in. Soko Bot, Cuso and coworkers never see an organization
 * room, because a room is about named people and a log of what they opened.
 */
export const DATA_ROOM_PEOPLE_KINDS: readonly FileActorKind[] = [
  "interactive",
  "api_key",
  "oauth",
];

export type DataRoomViewer = Pick<FileActor, "userId" | "kind">;

async function isOrganizationAdmin(
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const member = await prisma.member.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { role: true },
  });
  return member !== null && isOrganizationOwnerOrAdmin(member.role);
}

/** A personal room is its owner's alone, and the store gate checks that. */
export async function canSeeDataRoom(
  room: Pick<DataRoom, "id" | "sourceScope" | "ownerId" | "createdByUserId">,
  viewer: DataRoomViewer,
): Promise<boolean> {
  if (room.sourceScope === FileSourceScope.USER) return true;
  if (!DATA_ROOM_PEOPLE_KINDS.includes(viewer.kind)) return false;
  if (room.createdByUserId === viewer.userId) return true;
  const colleague = await prisma.dataRoomColleague.findUnique({
    where: { roomId_userId: { roomId: room.id, userId: viewer.userId } },
    select: { userId: true },
  });
  return (
    colleague !== null ||
    (await isOrganizationAdmin(room.ownerId, viewer.userId))
  );
}

/** Folder paths, within the organization's Files, of rooms this viewer may not see. */
export async function hiddenDataRoomFolders(
  organizationId: string,
  viewer: DataRoomViewer,
): Promise<string[]> {
  const known = await driveRoomsOf(
    FileSourceScope.ORGANIZATION,
    organizationId,
  );
  if (known.length === 0) return [];
  const rooms = await prisma.dataRoom.findMany({
    where: {
      sourceScope: FileSourceScope.ORGANIZATION,
      ownerId: organizationId,
    },
    select: {
      folderPath: true,
      createdByUserId: true,
      colleagues: {
        where: { userId: viewer.userId },
        select: { userId: true },
      },
    },
  });
  if (!DATA_ROOM_PEOPLE_KINDS.includes(viewer.kind))
    return rooms.map((room) => room.folderPath);
  if (await isOrganizationAdmin(organizationId, viewer.userId)) return [];
  return rooms
    .filter(
      (room) =>
        room.createdByUserId !== viewer.userId && room.colleagues.length === 0,
    )
    .map((room) => room.folderPath);
}

/** True when a path in the store is inside one of these folders, or holds one. */
export function touchesHiddenRoom(
  hidden: readonly string[],
  path: string,
): boolean {
  return hidden.some(
    (folder) =>
      path === folder ||
      path.startsWith(`${folder}/`) ||
      (path !== "" && folder.startsWith(`${path}/`)),
  );
}

/** True when a path in the store is inside one of these folders. */
export function insideHiddenRoom(
  hidden: readonly string[],
  path: string,
): boolean {
  return hidden.some(
    (folder) => path === folder || path.startsWith(`${folder}/`),
  );
}
