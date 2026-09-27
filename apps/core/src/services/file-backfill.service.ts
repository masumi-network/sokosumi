import { FileSourceKind, FileSourceScope } from "@sokosumi/database";
import {
  buildOrganizationDriveFolderPrefix,
  buildUserDriveFolderPrefix,
  isDriveFolderMarker,
} from "@sokosumi/utils";
import { list } from "@vercel/blob";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";
import { ensureEvidenceScope } from "@/lib/files/evidence-scope";
import { adoptDriveUploadResource } from "@/services/file-catalog.service";

/**
 * Give existing Drive objects a catalog identity.
 *
 * Uploads made before this feature — and any whose finalize call was lost —
 * exist only as blob pathnames. Adoption is idempotent and bounded: it never
 * reinterprets a reserved path as a new document, and it grants nothing. The
 * caller has already passed the Drive gate for this store.
 */

/** One listing page. */
const BACKFILL_PAGE_SIZE = 200;

/**
 * Pages per visit. Adoption happens on a read path, so one visit must stay
 * bounded; the cursor carries the rest to the next one.
 */
const BACKFILL_PAGES_PER_VISIT = 5;

export interface BackfillResult {
  scanned: number;
  adopted: number;
  /** True once the listing reported no further pages. */
  complete: boolean;
}

export async function backfillDriveStore(input: {
  workspaceId: string;
  scope: "user" | "organization";
  ownerId: string;
}): Promise<BackfillResult> {
  const token = getEnv().BLOB_READ_WRITE_TOKEN;
  if (!token) return { scanned: 0, adopted: 0, complete: false };

  const sourceScope =
    input.scope === "user"
      ? FileSourceScope.USER
      : FileSourceScope.ORGANIZATION;

  const progress = await storeBackfillProgress({
    workspaceId: input.workspaceId,
    sourceScope,
    ownerId: input.ownerId,
  });
  if (progress.backfilledAt) return { scanned: 0, adopted: 0, complete: true };

  const prefix =
    input.scope === "user"
      ? buildUserDriveFolderPrefix(input.ownerId, "")
      : buildOrganizationDriveFolderPrefix(input.ownerId, "");

  // Everything already catalogued for this store, so adoption never
  // reinterprets a reserved path as a new document.
  const known = new Set(
    (
      await prisma.fileResource.findMany({
        where: {
          workspaceId: input.workspaceId,
          sourceKind: FileSourceKind.DRIVE_UPLOAD,
          sourceScope,
        },
        select: { sourceId: true },
      })
    ).map((resource) => resource.sourceId),
  );

  let cursor = progress.backfillCursor ?? undefined;
  let scanned = 0;
  let adopted = 0;
  let complete = false;

  for (let visit = 0; visit < BACKFILL_PAGES_PER_VISIT; visit += 1) {
    const page = await list({
      prefix,
      token,
      cursor,
      limit: BACKFILL_PAGE_SIZE,
    });
    scanned += page.blobs.length;

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
      known.add(blob.pathname);
      adopted += 1;
    }

    cursor = page.hasMore ? page.cursor : undefined;
    if (!page.hasMore) {
      complete = true;
      break;
    }
  }

  // Record where this visit got to, so the next one resumes rather than
  // starting over — or stops, if the store is fully adopted.
  //
  // The row has to be ensured first. It is created by
  // `adoptDriveUploadResource`, which only runs when there is something to
  // adopt, so a store that adopted nothing had no row and the previous
  // `updateMany` matched zero of them: completion was discarded while this
  // function still returned `complete: true`. `isDriveStoreBackfillPending`
  // then answered "yes" forever, on a hot path — every Drive search — so an
  // empty Drive listed the blob store before every search for the life of
  // the account.
  const scope = await ensureEvidenceScope({
    workspaceId: input.workspaceId,
    sourceKind: FileSourceKind.DRIVE_UPLOAD,
    sourceScope,
    sourceId: input.ownerId,
  });
  await prisma.fileEvidenceScope.update({
    where: { id: scope.id },
    data: {
      backfillCursor: complete ? null : (cursor ?? null),
      backfilledAt: complete ? new Date() : null,
    },
  });

  return { scanned, adopted, complete };
}

async function storeBackfillProgress(input: {
  workspaceId: string;
  sourceScope: FileSourceScope;
  ownerId: string;
}): Promise<{ backfillCursor: string | null; backfilledAt: Date | null }> {
  const scope = await prisma.fileEvidenceScope.findUnique({
    where: {
      workspaceId_sourceKind_sourceScope_sourceId: {
        workspaceId: input.workspaceId,
        sourceKind: FileSourceKind.DRIVE_UPLOAD,
        sourceScope: input.sourceScope,
        sourceId: input.ownerId,
      },
    },
    select: { backfillCursor: true, backfilledAt: true },
  });
  return {
    backfillCursor: scope?.backfillCursor ?? null,
    backfilledAt: scope?.backfilledAt ?? null,
  };
}

/**
 * Whether this store still has objects to adopt.
 *
 * This used to ask whether the store had *zero* catalog rows, which was
 * wrong twice over: a store larger than one listing page stopped being
 * "uncatalogued" after its first 200 objects and never adopted the rest, and
 * a store that saw any upload after this deploy — `reserveDriveUploadResource`
 * writes a row at grant-mint time — was never backfilled at all, leaving
 * every pre-existing file invisible.
 *
 * Completion is now recorded per store, so the answer is "not finished yet"
 * rather than "never started".
 */
export async function isDriveStoreBackfillPending(input: {
  workspaceId: string;
  scope: "user" | "organization";
  ownerId: string;
}): Promise<boolean> {
  /**
   * No blob store, nothing to adopt from, nothing pending.
   *
   * Without this the answer is "yes" forever. `backfillDriveStore` returns
   * at its first line when `BLOB_READ_WRITE_TOKEN` is unset, before it can
   * write `backfilledAt`, so the marker this function reads is never set
   * and every caller sees a store that is permanently mid-backfill.
   *
   * That was not merely a wasted query. The one caller —
   * `GET /v1/drive/search` — nudges the indexer inside this branch, and
   * the nudge drains label suggestion, which is a paid model call per
   * document. A missing environment variable therefore turned every
   * search into billable work with no completion condition: not a slow
   * path, an unbounded one. Found by review, not by a bill.
   *
   * Answering "not pending" is the honest answer rather than a
   * suppression. Nothing can be adopted without a token, and if one is
   * configured later this returns to "pending" on its own — which
   * recording a false `backfilledAt` would have prevented forever.
   */
  if (!getEnv().BLOB_READ_WRITE_TOKEN) return false;

  const scope = await prisma.fileEvidenceScope.findUnique({
    where: {
      workspaceId_sourceKind_sourceScope_sourceId: {
        workspaceId: input.workspaceId,
        sourceKind: FileSourceKind.DRIVE_UPLOAD,
        sourceScope:
          input.scope === "user"
            ? FileSourceScope.USER
            : FileSourceScope.ORGANIZATION,
        sourceId: input.ownerId,
      },
    },
    select: { backfilledAt: true },
  });
  return scope?.backfilledAt == null;
}
