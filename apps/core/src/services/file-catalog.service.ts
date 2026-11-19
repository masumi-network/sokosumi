import { randomUUID } from "node:crypto";
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

import { conflict, notFound, serviceUnavailable } from "@/helpers/error";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import prisma from "@/lib/db/prisma";
import { isStagedUploadPathname, stagedUploadPathname } from "@/lib/drive-blob";
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

function sourceKeyOf(key: DriveResourceKey) {
  return {
    workspaceId: key.workspaceId,
    sourceKind: FileSourceKind.DRIVE_UPLOAD,
    sourceScope: toSourceScope(key.scope),
    sourceId: key.pathname,
  };
}

/**
 * Source id of a document deleted from the catalog whose bytes storage has
 * not yet confirmed gone. It still owns those bytes: nothing adopts them as a
 * new document, and the next delete of the pathname finishes the job.
 */
function deletingSourceIdPrefix(pathname: string): string {
  return `${pathname}#deleting:`;
}

function deletingRowsAt(pathname: string) {
  return {
    startsWith: deletingSourceIdPrefix(pathname).replace(/[\\%_]/g, "\\$&"),
  };
}

/**
 * Serializes every catalog writer of one Drive pathname (reservation,
 * staged publication, released activation, adoption and the deletion hold)
 * for the rest of the transaction, whether or not a row holds it yet: what
 * each one checked is still true when it writes.
 */
async function lockDrivePathname(
  tx: Prisma.TransactionClient,
  key: Pick<DriveResourceKey, "workspaceId" | "scope" | "pathname">,
): Promise<void> {
  const lock = `drive-pathname:${key.workspaceId}:${key.scope}:${key.pathname}`;
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${lock}::TEXT, 0))
  `;
}

/** The current version's object key and promotion claim. */
const CURRENT_VERSION = {
  orderBy: { revision: "desc" },
  take: 1,
  select: { id: true, objectKey: true, etag: true },
} as const;

/**
 * A staged attempt whose promotion has started: its object key is still the
 * staging key, and the staged ETag recorded when promotion began marks it.
 * From then until finalize resolves it, the attempt alone owns the pathname,
 * because a move to the pathname may still be in flight.
 */
function isClaimedPromotion(
  version: { objectKey: string; etag: string | null } | undefined,
): boolean {
  return Boolean(
    version && isStagedUploadPathname(version.objectKey) && version.etag,
  );
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
 *
 * `staged`: the grant writes this version's staging key, recorded as its
 * object key, so only finalize with this version's id publishes it. A staged
 * upload never replaces a live document (409); it can supersede a pending one.
 */
export async function reserveDriveUploadResource(input: {
  key: DriveResourceKey;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  pinLabelsEmpty?: { decidedByUserId: string };
  staged?: boolean;
}): Promise<{ resourceId: string; versionId: string }> {
  const { key } = input;
  const sourceScope = toSourceScope(key.scope);
  const versionId = randomUUID();
  const objectKey = input.staged
    ? stagedUploadPathname(versionId, key.pathname)
    : key.pathname;

  return prisma.$transaction(async (tx) => {
    await lockDrivePathname(tx, key);
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
        overrides: { select: { id: true }, take: 1 },
        versions: CURRENT_VERSION,
      },
    });

    if (isClaimedPromotion(existing?.versions[0])) {
      throw conflict("An upload is being saved at this name");
    }
    const pin = input.pinLabelsEmpty;
    if (existing && pin) {
      throw conflict("A file already holds that name");
    }
    if (input.staged && existing?.lifecycle === FileResourceLifecycle.ACTIVE) {
      throw conflict("A file already holds that name");
    }
    if (
      existing?.lifecycle === FileResourceLifecycle.PENDING &&
      existing.overrides.length > 0
    ) {
      // A copy's reservation (no person can set an override on a pending
      // document) at its own minted key. Its grant may still write its
      // staging key and finalize here, so the key stays the copy's: only that
      // attempt ever knew the name. Another upload taking this row would also
      // take the copy's empty pins.
      throw conflict("A copy is being saved at this name");
    }
    if (existing) {
      // Replacing the bytes at a live pathname is a new version of the same
      // document, so manual metadata and the deep link both survive it. A
      // tombstoned resource cannot appear here: deletion releases its path.
      const revision = existing.contentRevision + 1;
      const version = await tx.fileVersion.create({
        data: {
          id: versionId,
          resourceId: existing.id,
          revision,
          objectKey,
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
              id: versionId,
              revision: 1,
              objectKey,
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
  return prisma.$transaction(async (tx) => {
    // Locked, so a staged re-mint or a deletion hold cannot commit between
    // this check and the write.
    await lockDrivePathname(tx, input.key);
    const resource = await tx.fileResource.findUnique({
      where: {
        workspaceId_sourceKind_sourceScope_sourceId: sourceKeyOf(input.key),
      },
      select: {
        id: true,
        contentRevision: true,
        tombstonedAt: true,
        versions: CURRENT_VERSION,
        // A copy's reservation (see reserveDriveUploadResource).
        overrides: {
          where: { labelId: null, decision: FileFieldOverrideDecision.PIN },
          select: { field: true },
        },
      },
    });
    if (!resource || resource.tombstonedAt) return null;
    // A staged attempt is published only by finalize with its own id; bytes
    // at the pathname are not its bytes.
    if (isStagedUploadPathname(resource.versions[0]?.objectKey ?? "")) {
      return null;
    }

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

    // Both fields pinned empty: nothing about this upload is for the paid
    // labelling model, so its finalize has no reason to drain that queue.
    const pinned = new Set(
      resource.overrides.map((override) => override.field),
    );
    return {
      resourceId: resource.id,
      labelsPinnedEmpty: pinned.has("category") && pinned.has("tags"),
    };
  });
}

/** Finalize's storage steps for one staged attempt. */
export interface StagedUploadStorage {
  /** ETag of the staged object, or null when nothing is staged. */
  observe(staged: string): Promise<string | null>;
  /**
   * Moves the staged object onto the pathname if it is still staged, never
   * replacing anything there, and reports what each location holds after.
   */
  promote(staged: string): Promise<{
    stillStaged: boolean;
    stored: { sizeBytes: number; mimeType: string } | null;
  }>;
}

/** The attempt whose promotion holds this pathname, if any. */
export async function claimedDriveUploadAttempt(
  key: DriveResourceKey,
): Promise<string | null> {
  const resource = await prisma.fileResource.findUnique({
    where: { workspaceId_sourceKind_sourceScope_sourceId: sourceKeyOf(key) },
    select: { tombstonedAt: true, versions: CURRENT_VERSION },
  });
  const version = resource?.versions[0];
  return !resource?.tombstonedAt && isClaimedPromotion(version)
    ? (version?.id ?? null)
    : null;
}

/**
 * Publishes one staged upload attempt and activates it.
 *
 * 1. Claim, locked: the attempt must be current. The staged ETag is recorded
 *    on its version. From here no reservation can replace it (409), so the
 *    pathname is this attempt's alone however the move below ends.
 * 2. Move, with no transaction open: the staged object onto the pathname.
 * 3. Resolve, locked: staging empty and the pathname filled means the move
 *    happened (only this attempt's move empties its staging key, and nothing
 *    else may write the pathname while the claim holds), so the document goes
 *    live. Staging still full beside other bytes at the pathname: those are
 *    not this attempt's, the claim is released and the answer is 409. Both
 *    empty: nothing uploaded, claim released. Staging full and pathname
 *    empty: the move did not happen yet; the claim stays for a retry.
 *
 * A move that outlives its request is harmless: the claim still holds, and
 * the next finalize, or the next mint of the pathname, resolves it.
 */
export async function publishStagedDriveUpload(input: {
  key: DriveResourceKey;
  attemptId: string;
  storage: StagedUploadStorage;
}): Promise<{ resourceId: string; labelsPinnedEmpty: boolean }> {
  const { key, attemptId } = input;

  const current = (tx: Prisma.TransactionClient) =>
    tx.fileResource.findUnique({
      where: { workspaceId_sourceKind_sourceScope_sourceId: sourceKeyOf(key) },
      select: {
        id: true,
        contentRevision: true,
        tombstonedAt: true,
        versions: CURRENT_VERSION,
        overrides: {
          where: { labelId: null, decision: FileFieldOverrideDecision.PIN },
          select: { field: true },
        },
      },
    });
  type Current = NonNullable<Awaited<ReturnType<typeof current>>>;
  const resultOf = (resource: Current) => {
    const pinned = new Set(resource.overrides.map((o) => o.field));
    return {
      resourceId: resource.id,
      labelsPinnedEmpty: pinned.has("category") && pinned.has("tags"),
    };
  };
  /** The attempt's current state, or why it cannot be published. */
  const attemptIn = (resource: Current | null) => {
    if (!resource || resource.tombstonedAt)
      throw notFound("No upload is pending at that path");
    const version = resource.versions[0];
    if (version?.id !== attemptId)
      throw conflict("A newer upload replaced this one");
    if (
      version.objectKey !== key.pathname &&
      !isStagedUploadPathname(version.objectKey)
    )
      throw conflict("This upload is not a staged upload");
    return version;
  };

  const before = attemptIn(await current(prisma));
  if (before.objectKey === key.pathname) {
    return resultOf((await current(prisma)) as Current);
  }
  const staged = before.objectKey;
  const observed = before.etag ? null : await input.storage.observe(staged);

  await prisma.$transaction(async (tx) => {
    await lockDrivePathname(tx, key);
    const version = attemptIn(await current(tx));
    if (version.objectKey === key.pathname || version.etag) return;
    if (!observed) throw notFound("No uploaded file for this upload");
    await tx.fileVersion.update({
      where: { id: version.id },
      data: { etag: observed },
    });
  });

  const outcome = await input.storage.promote(staged);

  const resolved = await prisma.$transaction(async (tx) => {
    await lockDrivePathname(tx, key);
    const resource = await current(tx);
    const version = attemptIn(resource);
    const live = resource as Current;
    if (version.objectKey === key.pathname) return resultOf(live);
    const { stillStaged, stored } = outcome;
    if (!stillStaged && stored) {
      await tx.fileVersion.update({
        where: { id: version.id },
        data: {
          objectKey: key.pathname,
          sizeBytes: stored.sizeBytes,
          mimeType: stored.mimeType,
        },
      });
      await tx.fileResource.update({
        where: { id: live.id },
        data: {
          lifecycle: FileResourceLifecycle.ACTIVE,
          sizeBytes: stored.sizeBytes,
          mimeType: stored.mimeType,
        },
      });
      await enqueueFileIndexJob(
        {
          resourceId: live.id,
          pipeline: FileIndexJobPipeline.EXTRACT,
          contentRevision: live.contentRevision,
        },
        tx,
      );
      return resultOf(live);
    }
    if (stillStaged && !stored) return "retry" as const;
    // Committed before the answer: the attempt no longer holds the name.
    await tx.fileVersion.update({
      where: { id: version.id },
      data: { etag: null },
    });
    return stored ? ("occupied" as const) : ("empty" as const);
  });
  if (resolved === "retry")
    throw serviceUnavailable("The upload is still being saved; try again");
  if (resolved === "occupied")
    throw conflict("Another file is already at that path");
  if (resolved === "empty") throw notFound("No uploaded file for this upload");
  return resolved;
}

/**
 * Moves one document's row to a new pathname before its bytes move. The
 * pathname is unique per store, so a name any other document holds, a
 * pending upload included, answers 409 here, before storage changes. 409
 * too when the row is no longer at `fromPathname`. Returns the display name
 * the row had, so a failed storage move can put it back.
 */
export async function moveDriveUploadResource(input: {
  workspaceId: string;
  scope: "user" | "organization";
  resourceId: string;
  fromPathname: string;
  toPathname: string;
  displayName: string;
}): Promise<string> {
  const sourceScope = toSourceScope(input.scope);
  return prisma
    .$transaction(async (tx) => {
      const resource = await tx.fileResource.findFirst({
        where: {
          id: input.resourceId,
          workspaceId: input.workspaceId,
          sourceKind: FileSourceKind.DRIVE_UPLOAD,
          sourceScope,
          sourceId: input.fromPathname,
          tombstonedAt: null,
        },
        select: { contentRevision: true, displayName: true },
      });
      if (!resource) throw conflict("The file changed while it was moving");
      const moved = await tx.fileResource.updateMany({
        where: { id: input.resourceId, sourceId: input.fromPathname },
        data: {
          sourceId: input.toPathname,
          displayName: input.displayName,
          normalizedName: normalizeFileResourceName(input.displayName),
          metadataRevision: { increment: 1 },
        },
      });
      if (moved.count !== 1)
        throw conflict("The file changed while it was moving");
      await tx.fileVersion.updateMany({
        where: {
          resourceId: input.resourceId,
          revision: resource.contentRevision,
        },
        data: { objectKey: input.toPathname },
      });
      return resource.displayName;
    })
    .catch((error: unknown) => {
      if (isPrismaUniqueViolation(error)) {
        throw conflict("A file already holds that name");
      }
      throw error;
    });
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
    // Release the pathname. A later upload to the same path is a
    // different document and must get its own identity — it does not
    // inherit this one's labels by coincidence of name, and this one
    // cannot be resurrected by re-uploading over it.
    await tombstoneIn(
      tx,
      resource.id,
      `${input.pathname}#tombstoned:${resource.id}`,
    );
  });
}

async function tombstoneIn(
  tx: Prisma.TransactionClient,
  resourceId: string,
  sourceId: string,
): Promise<void> {
  await tx.fileResource.update({
    where: { id: resourceId },
    data: {
      lifecycle: FileResourceLifecycle.TOMBSTONED,
      tombstonedAt: new Date(),
      aclRevision: { increment: 1 },
      sourceId,
    },
  });

  // Chunks go now: a tombstoned document must stop matching immediately,
  // not when a sweeper next runs.
  await tx.fileChunk.deleteMany({
    where: { version: { resourceId } },
  });
  await tx.fileIndexJob.updateMany({
    where: { resourceId, state: { in: ["QUEUED", "LEASED"] } },
    data: { state: "CANCELLED", lastError: "resource tombstoned" },
  });
  await tx.fileIndexArtifact.updateMany({
    where: { job: { resourceId }, state: "ACTIVE" },
    data: { state: "ABANDONED" },
  });
  // The store's evidence scope is deliberately left alone. Deleting one
  // file does not change who may read the store, and bumping the scope
  // version would invalidate every other document's chunks with it.
}

/** The live document at a pathname, as a delete observes it. */
export async function driveDocumentAt(
  key: DriveResourceKey,
): Promise<{ resourceId: string; revision: number } | null> {
  const resource = await prisma.fileResource.findFirst({
    where: { ...sourceKeyOf(key), tombstonedAt: null },
    select: { id: true, contentRevision: true },
  });
  return resource
    ? { resourceId: resource.id, revision: resource.contentRevision }
    : null;
}

/**
 * Tombstones the document a delete observed, and only while it is still
 * that document at that revision: it stops matching at once, but keeps
 * owning its bytes (a `#deleting:` source id) until storage confirms them
 * gone. False when the document changed since, so nothing was touched.
 */
export async function holdDriveUploadForDelete(input: {
  key: DriveResourceKey;
  resourceId: string;
  revision: number;
}): Promise<boolean> {
  const { key, resourceId } = input;
  return prisma.$transaction(async (tx) => {
    await lockDrivePathname(tx, key);
    const resource = await tx.fileResource.findFirst({
      where: {
        ...sourceKeyOf(key),
        id: resourceId,
        contentRevision: input.revision,
        tombstonedAt: null,
      },
      select: { id: true },
    });
    if (!resource) return false;
    await tombstoneIn(
      tx,
      resourceId,
      `${deletingSourceIdPrefix(key.pathname)}${resourceId}`,
    );
    return true;
  });
}

/**
 * Storage confirmed the bytes at a pathname no live document owns are gone:
 * every earlier delete's hold there is released (a retried delete).
 */
export async function releaseDriveUploadDeleteHolds(
  key: DriveResourceKey,
): Promise<void> {
  const held = await prisma.fileResource.findMany({
    where: {
      workspaceId: key.workspaceId,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope: toSourceScope(key.scope),
      sourceId: deletingRowsAt(key.pathname),
    },
    select: { id: true },
  });
  for (const { id } of held)
    await releaseDriveUploadDeleteHold({ key, resourceId: id });
}

/** Storage confirmed this delete's bytes gone: the hold is released. */
export async function releaseDriveUploadDeleteHold(input: {
  key: DriveResourceKey;
  resourceId: string;
}): Promise<void> {
  const { key, resourceId } = input;
  await prisma.fileResource.updateMany({
    where: {
      id: resourceId,
      sourceId: `${deletingSourceIdPrefix(key.pathname)}${resourceId}`,
    },
    data: { sourceId: `${key.pathname}#tombstoned:${resourceId}` },
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
}): Promise<string | null> {
  // Locked, so a deletion hold or a staged re-mint cannot commit between
  // these checks and the write.
  return prisma.$transaction(async (client) => {
    await lockDrivePathname(client, input.key);
    return adoptIn(client, input);
  });
}

async function adoptIn(
  client: Prisma.TransactionClient,
  input: {
    key: DriveResourceKey;
    displayName: string;
    mimeType: string | null;
    sizeBytes: number;
    uploadedAt: Date;
  },
): Promise<string | null> {
  const sourceScope = toSourceScope(input.key.scope);

  // Bytes a deleted document still owns are not a new document.
  const deleting = await client.fileResource.findFirst({
    where: {
      workspaceId: input.key.workspaceId,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope,
      sourceId: deletingRowsAt(input.key.pathname),
    },
    select: { id: true },
  });
  if (deleting) return null;

  const existing = await client.fileResource.findUnique({
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
      lifecycle: true,
      versions: {
        orderBy: { revision: "desc" },
        take: 1,
        select: { objectKey: true },
      },
    },
  });

  if (existing) {
    // A staged attempt's bytes are its staged object, never these.
    if (isStagedUploadPathname(existing.versions[0]?.objectKey ?? "")) {
      return null;
    }
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

/**
 * Storage confirmed these pathnames' deleted bytes gone: their documents stop
 * owning them, and the pathnames are fully released.
 */
export async function settleDriveUploadDeletes(input: {
  workspaceId: string;
  scope: "user" | "organization";
  pathnames: readonly string[];
}): Promise<void> {
  const sourceScope = toSourceScope(input.scope);
  for (const pathname of input.pathnames) {
    const rows = await prisma.fileResource.findMany({
      where: {
        workspaceId: input.workspaceId,
        sourceKind: FileSourceKind.DRIVE_UPLOAD,
        sourceScope,
        sourceId: deletingRowsAt(pathname),
      },
      select: { id: true },
    });
    for (const row of rows) {
      await prisma.fileResource.update({
        where: { id: row.id },
        data: { sourceId: `${pathname}#tombstoned:${row.id}` },
      });
    }
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
