import { FileSourceScope } from "@sokosumi/database";
import { normalizeDriveFolderPath } from "@sokosumi/utils";

import { badRequest } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import {
  driveRoomsOf,
  forgetDriveRooms,
  roomContaining,
} from "@/lib/drive-blob";

function sourceScopeOf(scope: "user" | "organization"): FileSourceScope {
  return scope === "user" ? FileSourceScope.USER : FileSourceScope.ORGANIZATION;
}

/**
 * Refuses a folder move or rename that would put one data room inside
 * another: a room's people and log are its own, and nesting would make a
 * file belong to two.
 */
export async function assertDataRoomMoveAllowed(input: {
  scope: "user" | "organization";
  ownerId: string;
  fromFolderPath: string;
  toFolderPath: string;
}): Promise<void> {
  const from = normalizeDriveFolderPath(input.fromFolderPath);
  const to = normalizeDriveFolderPath(input.toFolderPath);
  const rooms = await driveRoomsOf(sourceScopeOf(input.scope), input.ownerId);
  const carried = (folderPath: string) =>
    folderPath === from || folderPath.startsWith(`${from}/`);
  const carriesRoom = rooms.some((room) => carried(room.folderPath));
  const landsInRoom = roomContaining(
    rooms.filter((room) => !carried(room.folderPath)),
    to,
  );
  if (carriesRoom && landsInRoom)
    throw badRequest("A data room cannot go inside another data room");
}

/**
 * Keeps data rooms on a folder that moved or was renamed, its subfolders
 * included. Runs **before** the objects move: once the room names the new
 * path, the moved objects are written to the private store, and the read
 * fallback still finds the ones not moved yet at the old path.
 */
export async function rebaseDataRooms(input: {
  scope: "user" | "organization";
  ownerId: string;
  fromFolderPath: string;
  toFolderPath: string;
}): Promise<void> {
  const from = normalizeDriveFolderPath(input.fromFolderPath);
  const to = normalizeDriveFolderPath(input.toFolderPath);
  if (!from || from === to) return;
  const rooms = await prisma.dataRoom.findMany({
    where: {
      sourceScope: sourceScopeOf(input.scope),
      ownerId: input.ownerId,
      OR: [{ folderPath: from }, { folderPath: { startsWith: `${from}/` } }],
    },
    select: { id: true, folderPath: true },
  });
  for (const room of rooms) {
    await prisma.dataRoom.update({
      where: { id: room.id },
      data: { folderPath: `${to}${room.folderPath.slice(from.length)}` },
    });
  }
  if (rooms.length > 0) forgetDriveRooms();
}

/** Forgets the data rooms on a deleted folder, its subfolders included. */
export async function deleteDataRoomsUnder(input: {
  scope: "user" | "organization";
  ownerId: string;
  folderPath: string;
}): Promise<void> {
  const folderPath = normalizeDriveFolderPath(input.folderPath);
  if (!folderPath) return;
  const { count } = await prisma.dataRoom.deleteMany({
    where: {
      sourceScope: sourceScopeOf(input.scope),
      ownerId: input.ownerId,
      OR: [{ folderPath }, { folderPath: { startsWith: `${folderPath}/` } }],
    },
  });
  if (count > 0) forgetDriveRooms();
}
