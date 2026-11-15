import type { Prisma } from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import {
  buildOrganizationDriveFolderPrefix,
  buildUserDriveFolderPrefix,
  normalizeDriveFolderPath,
} from "@sokosumi/utils";
import pLimit from "p-limit";
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

/** Folder existence checks in flight at once while listing. */
const FOLDER_CHECKS_AT_ONCE = 8;

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
  if (insideHiddenRoom(hidden, where.folderPath))
    throw notFound("Folder not found");
  // Check and write under the folder-star lock, so a folder that moves or is
  // deleted meanwhile either takes this star along or is already gone.
  await withFolderStarLock(workspaceId, async (tx) => {
    if (!(await driveHasAny(folderPrefixOf(store, where.folderPath))))
      throw notFound("Folder not found");
    await tx.driveStar.upsert({
      where: { userId_workspaceId_folderPath: where },
      create: where,
      update: {},
    });
  });
}

/**
 * One workspace's folder-star writes, one at a time: starring a folder, and
 * moving or deleting the stars of a folder that moved or went away. A star
 * request checks that the folder exists and writes inside it; maintenance
 * runs after the blobs moved, so it either sees that star or makes the check
 * fail. Unstarring needs no lock: deleting a row locks the row.
 */
function withFolderStarLock<T>(
  workspaceId: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${`drive-star-folders:${workspaceId}`}::TEXT, 0))`;
      return operation(tx);
    },
    // The star check lists blobs inside the transaction.
    { maxWait: 10_000, timeout: 30_000 },
  );
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
    // ponytail: every star, unpaged. The list is complete membership: the
    // Star toggles read it, so a cut-off list would call a starred item
    // unstarred. Page it if people start keeping hundreds.
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
    (() => {
      const limit = pLimit(FOLDER_CHECKS_AT_ONCE);
      return Promise.all(
        candidateFolders.map((path) =>
          limit(() => driveHasAny(folderPrefixOf(store, path))),
        ),
      );
    })(),
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
 *
 * One statement under the folder-star lock: the rows it deletes are exactly
 * the rows it copies (`DELETE … RETURNING` feeds the `INSERT`), so nothing
 * committed between a copy and a delete can be dropped. Meanwhile:
 * - a star already on the destination is kept, and a copy that would
 *   duplicate it is dropped (`ON CONFLICT DO NOTHING`);
 * - an unstar committed first is not there to copy; one still in flight
 *   holds its row, the delete waits for it and then skips the row, so it is
 *   not copied either; one that rolls back leaves the row to be moved;
 * - a star request is serialized by the lock (see `withFolderStarLock`);
 * - running it again, as a retried move does, finds nothing left to move.
 *
 * Paths are compared with `left()`, not `LIKE`, so `%` and `_` in a folder
 * name match only themselves, and lengths come from PostgreSQL so they count
 * characters the way `substr` does.
 */
export async function rebaseDriveFolderStars(input: {
  workspaceId: string;
  fromFolderPath: string;
  toFolderPath: string;
}): Promise<void> {
  const from = normalizeDriveFolderPath(input.fromFolderPath);
  const to = normalizeDriveFolderPath(input.toFolderPath);
  if (!from || !to || from === to) return;
  const underFrom = PrismaRaw.sql`"workspaceId" = ${input.workspaceId}::uuid
    AND ("folderPath" = ${from}
      OR left("folderPath", length(${from}) + 1) = ${`${from}/`})`;
  await withFolderStarLock(
    input.workspaceId,
    (tx) => tx.$executeRaw`
      WITH moved AS (
        DELETE FROM drive_star WHERE ${underFrom}
        RETURNING "createdAt", "userId", "workspaceId", "folderPath"
      )
      INSERT INTO drive_star (id, "createdAt", "userId", "workspaceId", "folderPath")
      SELECT gen_random_uuid(), "createdAt", "userId", "workspaceId",
        ${to} || substr("folderPath", length(${from}) + 1)
      FROM moved
      ON CONFLICT ("userId", "workspaceId", "folderPath") DO NOTHING`,
  );
}

/** Removes everyone's stars on a deleted folder and its subfolders. */
export async function deleteDriveFolderStars(input: {
  workspaceId: string;
  folderPath: string;
}): Promise<void> {
  const folderPath = normalizeDriveFolderPath(input.folderPath);
  if (!folderPath) return;
  await withFolderStarLock(input.workspaceId, (tx) =>
    tx.driveStar.deleteMany({
      where: underFolder(input.workspaceId, folderPath),
    }),
  );
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
