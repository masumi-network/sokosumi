import { FileSourceKind, FileSourceScope } from "@sokosumi/database";
import {
  buildOrganizationDriveFolderPrefix,
  buildUserDriveFolderPrefix,
  isDriveFolderMarker,
} from "@sokosumi/utils";
import { list } from "@vercel/blob";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";
import { adoptDriveUploadResource } from "@/services/file-catalog.service";

/**
 * Give existing Drive objects a catalog identity.
 *
 * Uploads made before this feature — and any whose finalize call was lost —
 * exist only as blob pathnames. Adoption is idempotent and bounded: it never
 * reinterprets a reserved path as a new document, and it grants nothing. The
 * caller has already passed the Drive gate for this store.
 */

/** One listing page. A large store is adopted across several visits. */
const BACKFILL_PAGE_SIZE = 200;

export interface BackfillResult {
  scanned: number;
  adopted: number;
}

export async function backfillDriveStore(input: {
  workspaceId: string;
  scope: "user" | "organization";
  ownerId: string;
}): Promise<BackfillResult> {
  const token = getEnv().BLOB_READ_WRITE_TOKEN;
  if (!token) return { scanned: 0, adopted: 0 };

  const prefix =
    input.scope === "user"
      ? buildUserDriveFolderPrefix(input.ownerId, "")
      : buildOrganizationDriveFolderPrefix(input.ownerId, "");

  const page = await list({ prefix, token, limit: BACKFILL_PAGE_SIZE });

  const known = new Set(
    (
      await prisma.fileResource.findMany({
        where: {
          workspaceId: input.workspaceId,
          sourceKind: FileSourceKind.DRIVE_UPLOAD,
          sourceScope:
            input.scope === "user"
              ? FileSourceScope.USER
              : FileSourceScope.ORGANIZATION,
        },
        select: { sourceId: true },
      })
    ).map((resource) => resource.sourceId),
  );

  let adopted = 0;
  for (const blob of page.blobs) {
    if (isDriveFolderMarker(blob.pathname)) continue;
    if (known.has(blob.pathname)) continue;

    const segments = blob.pathname.split("/");
    const displayName = segments[segments.length - 1] ?? blob.pathname;

    await adoptDriveUploadResource({
      key: {
        workspaceId: input.workspaceId,
        scope: input.scope,
        ownerId: input.ownerId,
        pathname: blob.pathname,
      },
      displayName,
      mimeType: null,
      sizeBytes: blob.size,
      uploadedAt: blob.uploadedAt,
    });
    adopted += 1;
  }

  return { scanned: page.blobs.length, adopted };
}

/**
 * True when this store has never been catalogued. Used to bootstrap a
 * workspace on its first search rather than requiring a migration run.
 */
export async function isDriveStoreUncatalogued(input: {
  workspaceId: string;
  scope: "user" | "organization";
}): Promise<boolean> {
  const existing = await prisma.fileResource.findFirst({
    where: {
      workspaceId: input.workspaceId,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope:
        input.scope === "user"
          ? FileSourceScope.USER
          : FileSourceScope.ORGANIZATION,
    },
    select: { id: true },
  });
  return existing === null;
}
