import { randomBytes } from "node:crypto";
import {
  type DataRoom,
  DataRoomStorage,
  DriveShareKind,
  FileSourceScope,
} from "@sokosumi/database";
import {
  buildOrganizationDriveFolderPrefix,
  buildUserDriveFolderPrefix,
  normalizeDriveFolderPath,
  validateDriveFolderPath,
} from "@sokosumi/utils";
import { BlobNotFoundError, list } from "@vercel/blob";
import { DRIVE_VIRTUAL_TASKS_FOLDER_NAME } from "@/helpers/drive-folder-reserved-names";
import {
  badRequest,
  conflict,
  notFound,
  serviceUnavailable,
} from "@/helpers/error";
import {
  canSeeDataRoom,
  hiddenDataRoomFolders,
} from "@/lib/data-room-visibility";
import prisma from "@/lib/db/prisma";
import {
  type DriveBlobStore,
  driveHasAny,
  driveRoomsOf,
  forgetDriveRooms,
  privateDriveStore,
  publicDriveStore,
  roomContaining,
  transferBetweenStores,
} from "@/lib/drive-blob";
import type { FileActor } from "@/lib/files/actor";
import { CMO_BRAND_MEDIA_FOLDER } from "@/services/cmo-brand-media.service";
import { IMAGE_STUDIO_DRIVE_FOLDER } from "@/services/image-studio-drive.service";
import { MARKETING_FILES_FOLDER } from "@/services/marketing-strategy-files.service";

/** The Drive store a room belongs to, as `resolveFileRequestContext` gives it. */
export interface DataRoomStore {
  workspaceId: string;
  scope: "user" | "organization";
  ownerId: string;
}

/** A store and who is asking: an organization room is only for its people. */
export interface DataRoomCaller extends DataRoomStore {
  actor: FileActor;
}

/**
 * Folders Sokosumi itself writes to and publishes from (Content Studio's
 * pictures, Cuso's Marketing files and brand pictures). Their files are
 * meant to go out, so they never become a room, and neither does a folder
 * that holds one.
 */
const SYSTEM_FOLDERS = [
  IMAGE_STUDIO_DRIVE_FOLDER,
  MARKETING_FILES_FOLDER,
  CMO_BRAND_MEDIA_FOLDER,
  DRIVE_VIRTUAL_TASKS_FOLDER_NAME,
];

function sourceScopeOf(scope: DataRoomStore["scope"]): FileSourceScope {
  return scope === "user" ? FileSourceScope.USER : FileSourceScope.ORGANIZATION;
}

function folderPrefix(store: DataRoomStore, folderPath: string): string {
  return store.scope === "user"
    ? buildUserDriveFolderPrefix(store.ownerId, folderPath)
    : buildOrganizationDriveFolderPrefix(store.ownerId, folderPath);
}

function roomFolderPath(raw: string): string {
  const folderPath = normalizeDriveFolderPath(raw);
  const invalid = validateDriveFolderPath(folderPath);
  if (invalid) throw badRequest(invalid);
  if (!folderPath)
    throw badRequest("Make a folder a data room, not all of Files");
  const root = folderPath.split("/")[0] ?? "";
  if (SYSTEM_FOLDERS.includes(root))
    throw badRequest(
      `"${root}" holds files Sokosumi publishes, so it cannot be a data room`,
    );
  return folderPath;
}

export function findDataRoom(store: DataRoomStore, folderPath: string) {
  return prisma.dataRoom.findUnique({
    where: {
      sourceScope_ownerId_folderPath: {
        sourceScope: sourceScopeOf(store.scope),
        ownerId: store.ownerId,
        folderPath: normalizeDriveFolderPath(folderPath),
      },
    },
  });
}

/** The store's rooms this caller is in. */
export async function listDataRooms(store: DataRoomCaller) {
  const [rooms, hidden] = await Promise.all([
    prisma.dataRoom.findMany({
      where: {
        sourceScope: sourceScopeOf(store.scope),
        ownerId: store.ownerId,
      },
      orderBy: { folderPath: "asc" },
    }),
    store.scope === "organization"
      ? hiddenDataRoomFolders(store.ownerId, store.actor)
      : Promise.resolve<string[]>([]),
  ]);
  return rooms.filter((room) => !hidden.includes(room.folderPath));
}

/**
 * Turns a folder into a data room. Its files start moving to the private
 * store at once; until they are all there, both stores are read. Links to
 * the folder or anything in it are removed: a room's files are reached by
 * invitation, never by link.
 */
export async function createDataRoom(input: {
  store: DataRoomStore;
  folderPath: string;
  userId: string;
}): Promise<DataRoom> {
  if (!privateDriveStore())
    throw serviceUnavailable("Data rooms are not set up here");
  const folderPath = roomFolderPath(input.folderPath);
  const { store } = input;
  const prefix = folderPrefix(store, folderPath);
  if (!(await driveHasAny(prefix))) throw notFound("Folder not found");

  const rooms = await driveRoomsOf(sourceScopeOf(store.scope), store.ownerId);
  if (rooms.some((room) => room.folderPath === folderPath))
    throw conflict("This folder is already a data room");
  if (roomContaining(rooms, folderPath))
    throw badRequest("This folder is already inside a data room");
  if (rooms.some((room) => room.folderPath.startsWith(`${folderPath}/`)))
    throw badRequest(
      "This folder holds a data room; a room cannot hold another",
    );

  const room = await prisma.$transaction(async (tx) => {
    await tx.driveShare.deleteMany({
      where: {
        workspaceId: store.workspaceId,
        sourceScope: sourceScopeOf(store.scope),
        ownerId: store.ownerId,
        OR: [
          {
            kind: DriveShareKind.FOLDER,
            OR: [
              { folderPath },
              { folderPath: { startsWith: `${folderPath}/` } },
            ],
          },
          {
            kind: DriveShareKind.FILE,
            resource: { sourceId: { startsWith: prefix } },
          },
        ],
      },
    });
    return tx.dataRoom.create({
      data: {
        workspaceId: store.workspaceId,
        sourceScope: sourceScopeOf(store.scope),
        ownerId: store.ownerId,
        folderPath,
        createdByUserId: input.userId,
        token: randomBytes(24).toString("base64url"),
      },
    });
  });
  forgetDriveRooms();
  return room;
}

/**
 * Closes a room: its files go back to the public Drive store and the folder
 * becomes an ordinary one once the last has moved.
 */
export async function closeDataRoom(
  store: DataRoomCaller,
  roomId: string,
): Promise<void> {
  const room = await prisma.dataRoom.findFirst({
    where: {
      id: roomId,
      sourceScope: sourceScopeOf(store.scope),
      ownerId: store.ownerId,
    },
  });
  if (!room || !(await canSeeDataRoom(room, store.actor)))
    throw notFound("Data room not found");
  await prisma.dataRoom.update({
    where: { id: room.id },
    data: { storage: DataRoomStorage.MOVING_OUT },
  });
  forgetDriveRooms();
}

export interface DataRoomMoveResult {
  rooms: number;
  moved: number;
  finished: number;
}

/** Objects one room moves before the next room gets a turn. */
const MOVE_BATCH = 50;

/**
 * Moves the bytes of rooms being opened or closed, a batch per room, until
 * `shouldContinue` says stop. A room whose source store has nothing left
 * under its folder is done: an opened room becomes PRIVATE, a closed one is
 * forgotten. Safe to run twice at once: a transfer whose source is already
 * gone is skipped.
 */
export async function moveDataRoomFiles(options: {
  shouldContinue: () => boolean;
}): Promise<DataRoomMoveResult> {
  const result: DataRoomMoveResult = { rooms: 0, moved: 0, finished: 0 };
  const privateStore = privateDriveStore();
  if (!privateStore) return result;
  const rooms = await prisma.dataRoom.findMany({
    where: {
      storage: { in: [DataRoomStorage.MOVING_IN, DataRoomStorage.MOVING_OUT] },
    },
    orderBy: { updatedAt: "asc" },
  });
  for (const room of rooms) {
    if (!options.shouldContinue()) break;
    result.rooms += 1;
    const store: DataRoomStore = {
      workspaceId: room.workspaceId,
      scope:
        room.sourceScope === FileSourceScope.USER ? "user" : "organization",
      ownerId: room.ownerId,
    };
    const goingIn = room.storage === DataRoomStorage.MOVING_IN;
    const from = goingIn ? publicDriveStore() : privateStore;
    const to = goingIn ? privateStore : publicDriveStore();
    let done = false;
    while (!done && options.shouldContinue()) {
      const moved = await moveBatch({
        prefix: folderPrefix(store, room.folderPath),
        from,
        to,
        shouldContinue: options.shouldContinue,
      });
      result.moved += moved.count;
      done = moved.done;
      if (moved.count === 0) break;
    }
    if (!done) continue;
    result.finished += 1;
    if (goingIn)
      await prisma.dataRoom.updateMany({
        where: { id: room.id, storage: DataRoomStorage.MOVING_IN },
        data: { storage: DataRoomStorage.PRIVATE },
      });
    else
      await prisma.dataRoom.deleteMany({
        where: { id: room.id, storage: DataRoomStorage.MOVING_OUT },
      });
  }
  if (result.finished > 0) forgetDriveRooms();
  return result;
}

async function moveBatch(input: {
  prefix: string;
  from: DriveBlobStore;
  to: DriveBlobStore;
  shouldContinue: () => boolean;
}): Promise<{ count: number; done: boolean }> {
  const page = await list({
    prefix: input.prefix,
    token: input.from.token,
    limit: MOVE_BATCH,
  });
  let count = 0;
  for (const blob of page.blobs) {
    if (!input.shouldContinue()) return { count, done: false };
    try {
      await transferBetweenStores({
        fromPathname: blob.pathname,
        fromStore: input.from,
        toPathname: blob.pathname,
        toStore: input.to,
      });
      count += 1;
    } catch (error) {
      if (!(error instanceof BlobNotFoundError)) throw error;
    }
  }
  return { count, done: page.blobs.length === 0 };
}
