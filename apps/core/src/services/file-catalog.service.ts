import {
  FileExtractionState,
  FileFieldOverrideDecision,
  FileIndexJobPipeline,
  FileResourceLifecycle,
  FileSourceKind,
  FileSourceScope,
  type Prisma,
} from "@sokosumi/database";
import { normalizeFileResourceName } from "@sokosumi/utils";

import { conflict } from "@/helpers/error";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import { DEFAULT_TOKEN_VALID_MS } from "@/lib/blob-upload-grant";
import prisma from "@/lib/db/prisma";
import { ensureEvidenceScope } from "@/lib/files/evidence-scope";
import { enqueueFileIndexJob } from "@/lib/files/index-jobs";

/**
 * The catalog is what turns "an object at a pathname" into a document with a
 * durable identity. A Drive file that is renamed, moved or replaced keeps the
 * same resource id — which is what lets a manual tag, a confirmed project and
 * a deep link survive all three.
 *
 * Nothing here grants access. Every row records which canonical source
 * governs it, and every read re-asks that source.
 */

export interface DriveResourceKey {
  workspaceId: string;
  scope: "user" | "organization";
  ownerId: string;
  pathname: string;
}

function toSourceScope(scope: "user" | "organization"): FileSourceScope {
  return scope === "user" ? FileSourceScope.USER : FileSourceScope.ORGANIZATION;
}

/**
 * Reserve identity for an upload that has not happened yet. Called when the
 * Blob grant is minted, so a finalize callback has something to authenticate
 * against and an abandoned grant is visible as a pending resource rather than
 * as nothing at all.
 *
 * `pinLabelsEmpty` (Make a copy): category and tags are pinned empty in the
 * same transaction, so no paid model ever labels the file; the reader can
 * lift the pins like any other. Only on a new document: a name any row
 * holds answers 409 rather than pinning someone else's document.
 */
/**
 * After this, a copy's upload grant (minted before its reservation) has
 * expired and any PUT it started, which the browser abandons after two
 * minutes, has settled.
 */
const COPY_GRANT_SETTLED_MS = DEFAULT_TOKEN_VALID_MS + 5 * 60_000;

export async function reserveDriveUploadResource(input: {
  key: DriveResourceKey;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  pinLabelsEmpty?: { decidedByUserId: string };
}): Promise<{ resourceId: string; versionId: string }> {
  const { key } = input;
  const sourceScope = toSourceScope(key.scope);

  return prisma.$transaction(async (tx) => {
    const evidenceScope = await ensureEvidenceScope(
      {
        workspaceId: key.workspaceId,
        sourceKind: FileSourceKind.DRIVE_UPLOAD,
        sourceScope,
        sourceId: key.ownerId,
      },
      tx,
    );

    const existing = await tx.fileResource.findUnique({
      where: {
        workspaceId_sourceKind_sourceScope_sourceId: {
          workspaceId: key.workspaceId,
          sourceKind: FileSourceKind.DRIVE_UPLOAD,
          sourceScope,
          sourceId: key.pathname,
        },
      },
      select: {
        id: true,
        contentRevision: true,
        lifecycle: true,
        createdAt: true,
        overrides: { select: { id: true }, take: 1 },
      },
    });

    const pin = input.pinLabelsEmpty;
    if (existing && pin) {
      throw conflict("A file already holds that name");
    }
    if (
      existing?.lifecycle === FileResourceLifecycle.PENDING &&
      existing.overrides.length > 0
    ) {
      // A copy's reservation (no person can set an override on a pending
      // document). Its grant may still write here, and those bytes and their
      // finalize must stay the copy's, pinned free. Only once the grant can
      // no longer land is the name given to this upload, and the copy's
      // settings go with its upload, not this one.
      // ponytail: time-fenced by the grant's lifetime; a per-attempt object
      // key would remove the wait if it ever matters.
      if (Date.now() - existing.createdAt.getTime() < COPY_GRANT_SETTLED_MS) {
        throw conflict("A copy is still being saved at this name");
      }
      await tx.fileFieldOverride.deleteMany({
        where: { resourceId: existing.id },
      });
    }
    if (existing) {
      // Replacing the bytes at a live pathname is a new version of the same
      // document, so manual metadata and the deep link both survive it. A
      // tombstoned resource cannot appear here: deletion releases its path.
      const revision = existing.contentRevision + 1;
      const version = await tx.fileVersion.create({
        data: {
          resourceId: existing.id,
          revision,
          objectKey: key.pathname,
          sizeBytes: input.sizeBytes,
          mimeType: input.mimeType,
        },
        select: { id: true },
      });
      await tx.fileResource.update({
        where: { id: existing.id },
        data: {
          contentRevision: revision,
          displayName: input.displayName,
          normalizedName: normalizeFileResourceName(input.displayName),
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
        },
      });
      return { resourceId: existing.id, versionId: version.id };
    }

    const resource = await tx.fileResource
      .create({
        data: {
          workspaceId: key.workspaceId,
          sourceKind: FileSourceKind.DRIVE_UPLOAD,
          sourceScope,
          sourceId: key.pathname,
          ownerUserId: key.scope === "user" ? key.ownerId : null,
          ownerOrganizationId:
            key.scope === "organization" ? key.ownerId : null,
          displayName: input.displayName,
          normalizedName: normalizeFileResourceName(input.displayName),
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          lifecycle: FileResourceLifecycle.PENDING,
          versions: {
            create: {
              revision: 1,
              objectKey: key.pathname,
              sizeBytes: input.sizeBytes,
              mimeType: input.mimeType,
            },
          },
          overrides: pin
            ? {
                create: (["category", "tags"] as const).map((field) => ({
                  field,
                  labelId: null,
                  decision: FileFieldOverrideDecision.PIN,
                  evidenceScopeId: evidenceScope.id,
                  contentRevision: 1,
                  vocabularyVersion: 1,
                  decidedByUserId: pin.decidedByUserId,
                })),
              }
            : undefined,
        },
        select: { id: true, versions: { select: { id: true } } },
      })
      .catch((error: unknown) => {
        // Two uploads that both found the name free: the later insert loses.
        if (isPrismaUniqueViolation(error)) {
          throw conflict("A file already holds that name");
        }
        throw error;
      });

    return { resourceId: resource.id, versionId: resource.versions[0].id };
  });
}

/**
 * Turn a reserved upload into a live document once the bytes are verified.
 * Filename and safe metadata are searchable from this moment; text follows
 * when extraction finishes.
 */
export async function activateDriveUploadResource(input: {
  key: DriveResourceKey;
  sizeBytes: number;
  mimeType: string;
}): Promise<{ resourceId: string; labelsPinnedEmpty: boolean } | null> {
  const sourceScope = toSourceScope(input.key.scope);

  const resource = await prisma.fileResource.findUnique({
    where: {
      workspaceId_sourceKind_sourceScope_sourceId: {
        workspaceId: input.key.workspaceId,
        sourceKind: FileSourceKind.DRIVE_UPLOAD,
        sourceScope,
        sourceId: input.key.pathname,
      },
    },
    select: {
      id: true,
      contentRevision: true,
      tombstonedAt: true,
      // A copy's reservation (see reserveDriveUploadResource).
      overrides: {
        where: { labelId: null, decision: FileFieldOverrideDecision.PIN },
        select: { field: true },
      },
    },
  });
  if (!resource || resource.tombstonedAt) return null;

  await prisma.$transaction(async (tx) => {
    await tx.fileResource.update({
      where: { id: resource.id },
      data: {
        lifecycle: FileResourceLifecycle.ACTIVE,
        sizeBytes: input.sizeBytes,
        mimeType: input.mimeType,
      },
    });
    await tx.fileVersion.updateMany({
      where: { resourceId: resource.id, revision: resource.contentRevision },
      data: { sizeBytes: input.sizeBytes, mimeType: input.mimeType },
    });
    await enqueueFileIndexJob(
      {
        resourceId: resource.id,
        pipeline: FileIndexJobPipeline.EXTRACT,
        contentRevision: resource.contentRevision,
      },
      tx,
    );
  });

  // Both fields pinned empty: nothing about this upload is for the paid
  // labelling model, so its finalize has no reason to drain that queue.
  const pinned = new Set(resource.overrides.map((override) => override.field));
  return {
    resourceId: resource.id,
    labelsPinnedEmpty: pinned.has("category") && pinned.has("tags"),
  };
}

/**
 * A rename keeps the document. Only the name and the object key move, so
 * nothing is re-extracted and no label is lost.
 */
export async function renameDriveUploadResource(input: {
  workspaceId: string;
  scope: "user" | "organization";
  fromPathname: string;
  toPathname: string;
  displayName: string;
}): Promise<void> {
  const sourceScope = toSourceScope(input.scope);

  await prisma.$transaction(async (tx) => {
    const resource = await tx.fileResource.findUnique({
      where: {
        workspaceId_sourceKind_sourceScope_sourceId: {
          workspaceId: input.workspaceId,
          sourceKind: FileSourceKind.DRIVE_UPLOAD,
          sourceScope,
          sourceId: input.fromPathname,
        },
      },
      select: { id: true, contentRevision: true },
    });
    if (!resource) return;

    await tx.fileResource.update({
      where: { id: resource.id },
      data: {
        sourceId: input.toPathname,
        displayName: input.displayName,
        normalizedName: normalizeFileResourceName(input.displayName),
        metadataRevision: { increment: 1 },
      },
    });
    await tx.fileVersion.updateMany({
      where: { resourceId: resource.id, revision: resource.contentRevision },
      data: { objectKey: input.toPathname },
    });
  });
}

/**
 * Deletion tombstones the resource, drops its passages so it stops matching
 * at once, and cancels the work that would otherwise write derived bytes
 * after the source is gone.
 */
export async function tombstoneDriveUploadResource(input: {
  workspaceId: string;
  scope: "user" | "organization";
  pathname: string;
}): Promise<void> {
  const sourceScope = toSourceScope(input.scope);

  await prisma.$transaction(async (tx) => {
    const resource = await tx.fileResource.findUnique({
      where: {
        workspaceId_sourceKind_sourceScope_sourceId: {
          workspaceId: input.workspaceId,
          sourceKind: FileSourceKind.DRIVE_UPLOAD,
          sourceScope,
          sourceId: input.pathname,
        },
      },
      select: { id: true },
    });
    if (!resource) return;

    await tx.fileResource.update({
      where: { id: resource.id },
      data: {
        lifecycle: FileResourceLifecycle.TOMBSTONED,
        tombstonedAt: new Date(),
        aclRevision: { increment: 1 },
        // Release the pathname. A later upload to the same path is a
        // different document and must get its own identity — it does not
        // inherit this one's labels by coincidence of name, and this one
        // cannot be resurrected by re-uploading over it.
        sourceId: `${input.pathname}#tombstoned:${resource.id}`,
      },
    });

    // Chunks go now: a tombstoned document must stop matching immediately,
    // not when a sweeper next runs.
    await tx.fileChunk.deleteMany({
      where: { version: { resourceId: resource.id } },
    });
    await tx.fileIndexJob.updateMany({
      where: { resourceId: resource.id, state: { in: ["QUEUED", "LEASED"] } },
      data: { state: "CANCELLED", lastError: "resource tombstoned" },
    });
    await tx.fileIndexArtifact.updateMany({
      where: { job: { resourceId: resource.id }, state: "ACTIVE" },
      data: { state: "ABANDONED" },
    });
    // The store's evidence scope is deliberately left alone. Deleting one
    // file does not change who may read the store, and bumping the scope
    // version would invalidate every other document's chunks with it.
  });
}

/**
 * Adopt a Drive object the catalog has never seen — an upload from before
 * this feature, or one whose finalize call was lost. The bytes are already
 * authorized by the caller's Drive gate; this only gives them an identity.
 */
export async function adoptDriveUploadResource(input: {
  key: DriveResourceKey;
  displayName: string;
  mimeType: string | null;
  sizeBytes: number;
  uploadedAt: Date;
  client?: Prisma.TransactionClient;
}): Promise<string> {
  const client = input.client ?? prisma;
  const sourceScope = toSourceScope(input.key.scope);

  const existing = await client.fileResource.findUnique({
    where: {
      workspaceId_sourceKind_sourceScope_sourceId: {
        workspaceId: input.key.workspaceId,
        sourceKind: FileSourceKind.DRIVE_UPLOAD,
        sourceScope,
        sourceId: input.key.pathname,
      },
    },
    select: { id: true, lifecycle: true },
  });

  if (existing) {
    if (existing.lifecycle === FileResourceLifecycle.PENDING) {
      await client.fileResource.update({
        where: { id: existing.id },
        data: { lifecycle: FileResourceLifecycle.ACTIVE },
      });
      await enqueueFileIndexJob(
        {
          resourceId: existing.id,
          pipeline: FileIndexJobPipeline.EXTRACT,
          contentRevision: 1,
        },
        client,
      );
    }
    return existing.id;
  }

  await ensureEvidenceScope(
    {
      workspaceId: input.key.workspaceId,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope,
      sourceId: input.key.ownerId,
    },
    client,
  );

  const resource = await client.fileResource.create({
    data: {
      workspaceId: input.key.workspaceId,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope,
      sourceId: input.key.pathname,
      ownerUserId: input.key.scope === "user" ? input.key.ownerId : null,
      ownerOrganizationId:
        input.key.scope === "organization" ? input.key.ownerId : null,
      displayName: input.displayName,
      normalizedName: normalizeFileResourceName(input.displayName),
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      lifecycle: FileResourceLifecycle.ACTIVE,
      createdAt: input.uploadedAt,
      versions: {
        create: {
          revision: 1,
          objectKey: input.key.pathname,
          sizeBytes: input.sizeBytes,
          mimeType: input.mimeType,
          extractionState: FileExtractionState.PENDING,
        },
      },
    },
    select: { id: true },
  });

  await enqueueFileIndexJob(
    {
      resourceId: resource.id,
      pipeline: FileIndexJobPipeline.EXTRACT,
      contentRevision: 1,
    },
    client,
  );

  return resource.id;
}

/**
 * Apply a completed blob mutation to the catalog.
 *
 * Four routes mutate Drive objects: single-file delete, folder delete, file
 * move and folder rename. Only the first told the catalog. The other three
 * left tombstoned or relocated documents fully indexed, so a deleted
 * document kept matching full-text search and kept returning content
 * snippets — and a later upload into a vacated pathname inherited the moved
 * file's manual tags, which is exactly what `tombstoneDriveUploadResource`'s
 * own comment says must be impossible.
 *
 * These two wrappers exist so a route reconciles by handing over the
 * pathnames it actually changed. Both delegate to the per-pathname helpers,
 * which are idempotent and return quietly for a pathname the catalog has
 * never seen — a Drive folder holds folder markers and pre-catalog uploads
 * as well as catalogued files.
 */
export async function tombstoneDriveUploadResources(input: {
  workspaceId: string;
  scope: "user" | "organization";
  pathnames: readonly string[];
}): Promise<void> {
  for (const pathname of input.pathnames) {
    await tombstoneDriveUploadResource({
      workspaceId: input.workspaceId,
      scope: input.scope,
      pathname,
    });
  }
}

export async function reconcileDriveUploadMoves(input: {
  workspaceId: string;
  scope: "user" | "organization";
  moves: readonly { fromPathname: string; toPathname: string }[];
}): Promise<void> {
  for (const move of input.moves) {
    // A move changes the folder, not the filename, so the display name is
    // the destination's last segment — which for a pure relocation is the
    // name the document already had.
    const displayName = move.toPathname.split("/").pop() ?? move.toPathname;
    await renameDriveUploadResource({
      workspaceId: input.workspaceId,
      scope: input.scope,
      fromPathname: move.fromPathname,
      toPathname: move.toPathname,
      displayName,
    });
  }
}
