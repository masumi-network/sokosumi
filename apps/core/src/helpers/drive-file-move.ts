import {
  buildOrganizationDriveFolderPrefix,
  buildUserDriveFolderPrefix,
  isDriveFolderMarkerName,
} from "@sokosumi/utils";
import { BlobNotFoundError, head, list, rename } from "@vercel/blob";

import { badRequest, conflict, notFound } from "@/helpers/error";
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
  token: string;
}): Promise<string> {
  const { sourcePathname, token } = input;
  let sourceMetadata;
  try {
    sourceMetadata = await head(sourcePathname, { token });
  } catch (error) {
    if (error instanceof BlobNotFoundError) {
      throw notFound("Source file not found");
    }
    throw error;
  }

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

  try {
    await head(targetPathname, { token });
    throw conflict("Target file already exists");
  } catch (error) {
    if (!(error instanceof BlobNotFoundError)) throw error;
  }

  const folderCheck = await list({
    prefix: `${targetPathname}/`,
    token,
    limit: 1,
  });
  if (folderCheck.blobs.length > 0) {
    throw conflict("A folder with that name already exists");
  }

  await rename(sourcePathname, targetPathname, {
    token,
    access: "public",
    addRandomSuffix: false,
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
