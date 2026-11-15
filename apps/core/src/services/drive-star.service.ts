import {
  buildOrganizationDriveFolderPrefix,
  buildUserDriveFolderPrefix,
  normalizeDriveFolderPath,
} from "@sokosumi/utils";

import { notFound } from "@/helpers/error";
import type { FileRequestContext } from "@/helpers/file-workspace";
import {
  hiddenDataRoomFolders,
  insideHiddenRoom,
} from "@/lib/data-room-visibility";
import prisma from "@/lib/db/prisma";
import { driveHasAny } from "@/lib/drive-blob";
import type { FileResourceDto } from "@/schemas/file-resource.schema";
import {
  type DriveShareTarget,
  shareFolderPath,
} from "@/services/drive-share.service";
import {
  hydrateResources,
  loadLiveResources,
} from "@/services/file-search.service";

/** The most stars one person keeps in one workspace's list. */
const MAX_STARS = 50;

export interface DriveStars {
  folders: { path: string; name: string }[];
  files: FileResourceDto[];
}

/**
 * Star or unstar one file or folder for the person making the request.
 * Starring checks the person can open it now; unstarring never needs to.
 */
export async function setDriveStar(input: {
  store: FileRequestContext;
  target: DriveShareTarget;
  starred: boolean;
}): Promise<void> {
  const { store, target } = input;
  const userId = store.actor.userId;
  const workspaceId = store.workspaceId;

  if (target.kind === "file") {
    const where = { userId, workspaceId, resourceId: target.resourceId };
    if (!input.starred) {
      await prisma.driveStar.deleteMany({ where });
      return;
    }
    const [resource] = await loadLiveResources({
      workspaceId,
      actor: store.actor,
      resourceIds: [target.resourceId],
    });
    if (!resource) throw notFound("File not found");
    await prisma.driveStar.upsert({
      where: { userId_workspaceId_resourceId: where },
      create: where,
      update: {},
    });
    return;
  }

  const where = {
    userId,
    workspaceId,
    folderPath: shareFolderPath(target.folderPath),
  };
  if (!input.starred) {
    await prisma.driveStar.deleteMany({ where });
    return;
  }
  const hidden = await hiddenFoldersOf(store);
  if (
    insideHiddenRoom(hidden, where.folderPath) ||
    !(await driveHasAny(folderPrefixOf(store, where.folderPath)))
  )
    throw notFound("Folder not found");
  await prisma.driveStar.upsert({
    where: { userId_workspaceId_folderPath: where },
    create: where,
    update: {},
  });
}

/**
 * The person's stars in this workspace, newest first. Only what they can open
 * now is listed: a file they lost access to, a deleted folder and a folder in
 * a data room they are not in drop out instead of showing as dead links.
 */
export async function listDriveStars(
  store: FileRequestContext,
): Promise<DriveStars> {
  const stars = await prisma.driveStar.findMany({
    where: { userId: store.actor.userId, workspaceId: store.workspaceId },
    orderBy: { createdAt: "desc" },
    take: MAX_STARS,
    select: { resourceId: true, folderPath: true },
  });

  const resourceIds = stars.flatMap((star) =>
    star.resourceId ? [star.resourceId] : [],
  );
  const hidden = await hiddenFoldersOf(store);
  const candidateFolders = stars.flatMap((star) =>
    star.folderPath && !insideHiddenRoom(hidden, star.folderPath)
      ? [star.folderPath]
      : [],
  );

  const [resources, folderExists] = await Promise.all([
    loadLiveResources({
      workspaceId: store.workspaceId,
      actor: store.actor,
      resourceIds,
    }),
    Promise.all(
      candidateFolders.map((path) => driveHasAny(folderPrefixOf(store, path))),
    ),
  ]);
  const files = await hydrateResources({ resources, query: null });
  const rank = new Map(resourceIds.map((id, index) => [id, index]));

  return {
    folders: candidateFolders
      .filter((_, index) => folderExists[index])
      .map((path) => ({ path, name: path.split("/").at(-1) ?? path })),
    files: files.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)),
  };
}

/** The folder and everything under it, as a `where` on folder stars. */
function underFolder(workspaceId: string, folderPath: string) {
  return {
    workspaceId,
    OR: [{ folderPath }, { folderPath: { startsWith: `${folderPath}/` } }],
  };
}

/**
 * Keeps everyone's stars on a folder that moved or was renamed, its subfolders
 * included. Call once the move has succeeded, beside `rebaseDriveFolderShares`.
 */
export async function rebaseDriveFolderStars(input: {
  workspaceId: string;
  fromFolderPath: string;
  toFolderPath: string;
}): Promise<void> {
  const from = normalizeDriveFolderPath(input.fromFolderPath);
  const to = normalizeDriveFolderPath(input.toFolderPath);
  if (!from || !to || from === to) return;
  // The move refused an existing destination, so a star already there is
  // left from a folder that went away. It would collide with the rebase.
  await prisma.driveStar.deleteMany({
    where: underFolder(input.workspaceId, to),
  });
  const stars = await prisma.driveStar.findMany({
    where: underFolder(input.workspaceId, from),
    select: { id: true, folderPath: true },
  });
  for (const star of stars) {
    const rest = (star.folderPath ?? "").slice(from.length);
    await prisma.driveStar.update({
      where: { id: star.id },
      data: { folderPath: `${to}${rest}` },
    });
  }
}

/** Removes everyone's stars on a deleted folder and its subfolders. */
export async function deleteDriveFolderStars(input: {
  workspaceId: string;
  folderPath: string;
}): Promise<void> {
  const folderPath = normalizeDriveFolderPath(input.folderPath);
  if (!folderPath) return;
  await prisma.driveStar.deleteMany({
    where: underFolder(input.workspaceId, folderPath),
  });
}

/** Data room folders of this store the person is not let into. */
function hiddenFoldersOf(store: FileRequestContext): Promise<string[]> {
  return store.scope === "organization"
    ? hiddenDataRoomFolders(store.ownerId, store.actor)
    : Promise.resolve([]);
}

function folderPrefixOf(store: FileRequestContext, folderPath: string): string {
  return store.scope === "user"
    ? buildUserDriveFolderPrefix(store.ownerId, folderPath)
    : buildOrganizationDriveFolderPrefix(store.ownerId, folderPath);
}
