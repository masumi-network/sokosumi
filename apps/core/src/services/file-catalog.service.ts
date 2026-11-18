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

/** Selects whether a row is a copy still being made (see reserveDriveCopyResource). */
const COPY_CLAIM_SELECT = {
  lifecycle: true,
  overrides: {
    where: { labelId: null, decision: FileFieldOverrideDecision.PIN },
    select: { id: true },
    take: 1,
  },
} as const;

function isCopyClaim(row: {
  lifecycle: FileResourceLifecycle;
  overrides: unknown[];
}): boolean {
  return (
    row.lifecycle === FileResourceLifecycle.PENDING && row.overrides.length > 0
  );
}

/**
 * Make one revision live and queue its extraction in one transaction, only
 * while the row still matches `where` at that revision. Returns false when
 * something moved it first, and then nothing was written.
 */
async function activateRevision(
  tx: Prisma.TransactionClient,
  where: Prisma.FileResourceWhereInput & { id: string },
  revision: number,
  metadata: { sizeBytes: number; mimeType?: string },
): Promise<boolean> {
  const { count } = await tx.fileResource.updateMany({
    where: { ...where, contentRevision: revision, tombstonedAt: null },
    data: { lifecycle: FileResourceLifecycle.ACTIVE, ...metadata },
  });
  if (count === 0) return false;
  await tx.fileVersion.updateMany({
    where: { resourceId: where.id, revision },
    data: metadata,
  });
  await enqueueFileIndexJob(
    {
      resourceId: where.id,
      pipeline: FileIndexJobPipeline.EXTRACT,
      contentRevision: revision,
    },
    tx,
  );
  return true;
}

/**
 * Reserve identity for an upload that has not happened yet. Called when the
 * Blob grant is minted, so a finalize callback has something to authenticate
 * against and an abandoned grant is visible as a pending resource rather than
 * as nothing at all.
 */
export async function reserveDriveUploadResource(input: {
  key: DriveResourceKey;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<{ resourceId: string; versionId: string }> {
  const { key } = input;
  const sourceScope = toSourceScope(key.scope);

  return prisma.$transaction(async (tx) => {
    await ensureEvidenceScope(
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
      select: { id: true, contentRevision: true, ...COPY_CLAIM_SELECT },
    });

    if (existing && isCopyClaim(existing)) {
      // A copy owns this name until it finishes or gives it back.
      throw conflict("A copy is being made at this name");
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

    const resource = await tx.fileResource.create({
      data: {
        workspaceId: key.workspaceId,
        sourceKind: FileSourceKind.DRIVE_UPLOAD,
        sourceScope,
        sourceId: key.pathname,
        ownerUserId: key.scope === "user" ? key.ownerId : null,
        ownerOrganizationId: key.scope === "organization" ? key.ownerId : null,
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
      },
      select: { id: true, versions: { select: { id: true } } },
    });

    return { resourceId: resource.id, versionId: resource.versions[0].id };
  });
}

/** Fields a copy pins empty, so no model is ever paid to label it. */
const COPY_PINNED_FIELDS = ["category", "tags"] as const;

/**
 * Reserve identity for one Drive copy request before its bytes exist, so a
 * backfill that sees the object adopts this row instead of minting another.
 *
 * A plain create, never the replace-a-version path: a name any row holds,
 * including another request's unfinished copy, fails with P2002 and the
 * caller tries the next name. Nothing ever joins another request's row.
 *
 * Category and tags are pinned empty. Labelling is a paid model call, and
 * a copy must stay free through extraction, the SUGGEST job it enqueues and
 * the missing-suggestion sweep: each of those finds nothing left to ask.
 * The reader can lift the pin from the file's details like any other.
 */
export async function reserveDriveCopyResource(input: {
  key: DriveResourceKey;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  decidedByUserId: string;
}): Promise<string> {
  const { key } = input;
  const sourceScope = toSourceScope(key.scope);

  return prisma.$transaction(async (tx) => {
    const scope = await ensureEvidenceScope(
      {
        workspaceId: key.workspaceId,
        sourceKind: FileSourceKind.DRIVE_UPLOAD,
        sourceScope,
        sourceId: key.ownerId,
      },
      tx,
    );
    const resource = await tx.fileResource.create({
      data: {
        workspaceId: key.workspaceId,
        sourceKind: FileSourceKind.DRIVE_UPLOAD,
        sourceScope,
        sourceId: key.pathname,
        ownerUserId: key.scope === "user" ? key.ownerId : null,
        ownerOrganizationId: key.scope === "organization" ? key.ownerId : null,
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
      },
      select: { id: true },
    });
    await tx.fileFieldOverride.createMany({
      data: COPY_PINNED_FIELDS.map((field) => ({
        resourceId: resource.id,
        field,
        labelId: null,
        decision: FileFieldOverrideDecision.PIN,
        evidenceScopeId: scope.id,
        contentRevision: 1,
        vocabularyVersion: 1,
        decidedByUserId: input.decidedByUserId,
      })),
    });
    return resource.id;
  });
}

/**
 * Give back a failed copy's name. `removeBytes` deletes whatever this
 * request wrote; the row goes only if that succeeds, and only while it is
 * still this request's pending claim at this pathname. Otherwise nothing is
 * touched: a live copy keeps its bytes, and a claim whose bytes could not be
 * removed stays pending and unlabelled rather than leaving unowned bytes.
 */
export async function releaseDriveCopyResource(
  claim: { resourceId: string; pathname: string },
  removeBytes: () => Promise<void>,
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const { count } = await tx.fileResource.deleteMany({
        where: {
          id: claim.resourceId,
          sourceId: claim.pathname,
          lifecycle: FileResourceLifecycle.PENDING,
          contentRevision: 1,
        },
      });
      if (count > 0) await removeBytes();
    },
    { timeout: 20_000 },
  );
}

/**
 * Make a reserved copy live with the metadata of the bytes it wrote. Fenced
 * to the claim's id, pathname and revision 1 while pending: a rename or any
 * other change in between means nothing is activated.
 */
export async function activateDriveCopyResource(input: {
  resourceId: string;
  pathname: string;
  sizeBytes: number;
  mimeType: string;
}): Promise<boolean> {
  return prisma.$transaction((tx) =>
    activateRevision(
      tx,
      {
        id: input.resourceId,
        sourceId: input.pathname,
        lifecycle: FileResourceLifecycle.PENDING,
      },
      1,
      { sizeBytes: input.sizeBytes, mimeType: input.mimeType },
    ),
  );
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
}): Promise<{ resourceId: string } | null> {
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
    select: { id: true, contentRevision: true, tombstonedAt: true },
  });
  if (!resource || resource.tombstonedAt) return null;

  const activated = await prisma.$transaction((tx) =>
    activateRevision(tx, { id: resource.id }, resource.contentRevision, {
      sizeBytes: input.sizeBytes,
      mimeType: input.mimeType,
    }),
  );
  return activated ? { resourceId: resource.id } : null;
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
    select: { id: true, contentRevision: true, ...COPY_CLAIM_SELECT },
  });

  if (existing) {
    // An interrupted copy is never adopted: only its own request may make
    // it live. A lost upload goes live with the listed size and its job in
    // one transaction, only at the revision and pathname read here.
    if (
      existing.lifecycle === FileResourceLifecycle.PENDING &&
      !isCopyClaim(existing)
    ) {
      const activate = (tx: Prisma.TransactionClient) =>
        activateRevision(
          tx,
          {
            id: existing.id,
            sourceId: input.key.pathname,
            lifecycle: FileResourceLifecycle.PENDING,
          },
          existing.contentRevision,
          {
            sizeBytes: input.sizeBytes,
            mimeType: input.mimeType ?? undefined,
          },
        );
      await (input.client
        ? activate(input.client)
        : prisma.$transaction(activate));
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
