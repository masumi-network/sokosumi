import { isVercelBlobPublicHost } from "@sokosumi/utils";

import { assertDriveStoreMatchesWorkspace } from "@/helpers/drive-file-access";
import { parseDriveFilePathname } from "@/helpers/drive-file-pathname";
import { badRequest } from "@/helpers/error";

/** A file a client names by its Drive blob pathname and public URL. */
export interface DriveFileRef {
  pathname: string;
  fileUrl: string;
  name: string;
}

/**
 * Pins a client-supplied Drive file to the active workspace's store: the
 * pathname must belong to that store (403 otherwise, 422 when malformed) and
 * `fileUrl` must be an https Vercel Blob URL of exactly that pathname (400).
 * Returns the normalized URL, safe to download.
 */
export function requireWorkspaceDriveFileUrl(
  workspace: { userId: string; organizationId: string | null },
  ref: DriveFileRef,
): string {
  const { scope, ownerId } = parseDriveFilePathname(
    ref.pathname,
    workspace.userId,
  );
  assertDriveStoreMatchesWorkspace(workspace, scope, ownerId);

  let url: URL;
  let decodedPathname: string;
  try {
    url = new URL(ref.fileUrl);
    decodedPathname = decodeURIComponent(url.pathname);
  } catch {
    throw badRequest(`Media file "${ref.name}" has an invalid URL`);
  }
  if (
    url.protocol !== "https:" ||
    !isVercelBlobPublicHost(url.hostname) ||
    decodedPathname !== `/${ref.pathname}`
  ) {
    throw badRequest(`Media file "${ref.name}" is not a Drive file`);
  }
  return url.toString();
}
