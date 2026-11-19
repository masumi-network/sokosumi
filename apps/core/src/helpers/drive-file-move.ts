import {
  buildOrganizationDriveFolderPrefix,
  buildUserDriveFolderPrefix,
  isDriveFolderMarkerName,
} from "@sokosumi/utils";

import { badRequest, conflict, notFound } from "@/helpers/error";
import {
  type DriveHeadResult,
  driveDelIfMatch,
  driveExists,
  driveHasAny,
  driveHead,
  driveRename,
} from "@/lib/drive-blob";
import {
  adoptDriveUploadResource,
  moveDriveUploadResource,
} from "@/services/file-catalog.service";

/**
 * Moves one Drive object to a new pathname, catalog first. The document's
 * row takes the destination before any bytes move, so a pathname another
 * document holds (a pending upload too) answers 409 with the source intact.
 * An object the catalog has never seen is adopted first, so it has a row to
 * move; bytes a deleted document still owns are not moved (409).
 *
 * When storage fails, the row follows the bytes: back to the source when
 * the destination never got them; kept at the destination when a transfer
 * wrote it and then failed to remove the source, which is then removed only
 * if it is still the object this request read.
 */
export async function relocateDriveFile(input: {
  workspaceId: string;
  scope: "user" | "organization";
  ownerId: string;
  fromPathname: string;
  toPathname: string;
  source: DriveHeadResult;
}): Promise<Awaited<ReturnType<typeof driveRename>>> {
  const { workspaceId, scope, fromPathname, toPathname, source } = input;
  const resourceId = await adoptDriveUploadResource({
    key: { workspaceId, scope, ownerId: input.ownerId, pathname: fromPathname },
    displayName: fromPathname.split("/").at(-1) || "unnamed",
    mimeType: source.contentType,
    sizeBytes: source.size,
    uploadedAt: source.uploadedAt,
  });
  if (!resourceId) throw conflict("This file is being deleted");
  const displayName = await moveDriveUploadResource({
    workspaceId,
    scope,
    resourceId,
    fromPathname,
    toPathname,
    displayName: toPathname.split("/").at(-1) || "unnamed",
  });
  try {
    return await driveRename(fromPathname, toPathname, {
      contentType: source.contentType,
      cacheControlMaxAge: parseCacheControlMaxAge(source.cacheControl),
    });
  } catch (error) {
    // A destination someone else filled is not this transfer's.
    const occupied =
      error instanceof Error && /already exists/i.test(error.message);
    const landed = occupied ? null : await driveHead(toPathname);
    if (landed && landed.size === source.size) {
      await driveDelIfMatch(fromPathname, source);
      return { url: landed.url, pathname: toPathname, access: landed.access };
    }
    if (await driveExists(fromPathname)) {
      await moveDriveUploadResource({
        workspaceId,
        scope,
        resourceId,
        fromPathname: toPathname,
        toPathname: fromPathname,
        displayName,
      });
    }
    throw error;
  }
}

/**
 * Moves one Drive file into a folder of the same store and tells the catalog.
 * The caller has passed the Drive gate for `scope`/`ownerId` and resolved the
 * workspace first, so a resolution failure cannot leave a moved object with a
 * stale catalog entry. Returns the new pathname.
 */
export async function moveDriveFile(input: {
  sourcePathname: string;
  /** Normalized folder path; "" for the top level. */
  targetFolderPath: string;
  scope: "user" | "organization";
  ownerId: string;
  workspaceId: string;
}): Promise<string> {
  const { sourcePathname } = input;
  const sourceMetadata = await driveHead(sourcePathname);
  if (!sourceMetadata) throw notFound("Source file not found");

  const filename = sourcePathname.split("/").at(-1) || "unnamed";
  if (isDriveFolderMarkerName(filename)) {
    throw badRequest(
      "Cannot move the reserved folder marker file (__drive_folder__)",
    );
  }

  const targetPrefix =
    input.scope === "user"
      ? buildUserDriveFolderPrefix(input.ownerId, input.targetFolderPath)
      : buildOrganizationDriveFolderPrefix(
          input.ownerId,
          input.targetFolderPath,
        );
  const targetPathname = `${targetPrefix}${filename}`;
  if (targetPathname === sourcePathname) return targetPathname;

  if (await driveExists(targetPathname)) {
    throw conflict("Target file already exists");
  }
  if (await driveHasAny(`${targetPathname}/`)) {
    throw conflict("A folder with that name already exists");
  }

  await relocateDriveFile({
    workspaceId: input.workspaceId,
    scope: input.scope,
    ownerId: input.ownerId,
    fromPathname: sourcePathname,
    toPathname: targetPathname,
    source: sourceMetadata,
  });
  return targetPathname;
}

export function parseCacheControlMaxAge(
  cacheControl: string,
): number | undefined {
  const match = /max-age=(\d+)/.exec(cacheControl);
  return match ? Number.parseInt(match[1], 10) : undefined;
}
