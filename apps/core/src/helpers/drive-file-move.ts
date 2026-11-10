import {
  buildOrganizationDriveFolderPrefix,
  buildUserDriveFolderPrefix,
  isDriveFolderMarkerName,
} from "@sokosumi/utils";

import { badRequest, conflict, notFound } from "@/helpers/error";
import {
  driveExists,
  driveHasAny,
  driveHead,
  driveRename,
} from "@/lib/drive-blob";
import { reconcileDriveUploadMoves } from "@/services/file-catalog.service";

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

  await driveRename(sourcePathname, targetPathname, {
    contentType: sourceMetadata.contentType,
    cacheControlMaxAge: parseCacheControlMaxAge(sourceMetadata.cacheControl),
  });

  // Follow the object in the catalog. Without this the entry kept pointing at
  // the vacated pathname, so a later upload there inherited this document's
  // manual tags.
  await reconcileDriveUploadMoves({
    workspaceId: input.workspaceId,
    scope: input.scope,
    moves: [{ fromPathname: sourcePathname, toPathname: targetPathname }],
  });
  return targetPathname;
}

export function parseCacheControlMaxAge(
  cacheControl: string,
): number | undefined {
  const match = /max-age=(\d+)/.exec(cacheControl);
  return match ? Number.parseInt(match[1], 10) : undefined;
}
