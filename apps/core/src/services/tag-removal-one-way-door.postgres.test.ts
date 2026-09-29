import { randomUUID } from "node:crypto";

import {
  FileFieldOverrideDecision,
  FileLabelKind,
  FileMetadataProvenance,
  FileMetadataState,
  FileResourceLifecycle,
  FileSourceKind,
  FileSourceScope,
} from "@sokosumi/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import prisma from "@/lib/db/prisma";
import type { FileActor } from "@/lib/files/actor";
import { ensureEvidenceScope } from "@/lib/files/evidence-scope";
import {
  decideFileSuggestion,
  updateFileMetadata,
} from "@/services/file-metadata.service";

/**
 * Removing a tag was a one-way door, and the way back already existed.
 *
 * Driven through the real interface: accept a model tag suggestion on a
 * document, then remove it. The tag is gone and it does not come back.
 * There is no undo, reloading does not help, the row's More actions menu
 * offers Download, Rename, Move and Delete, the bulk bar sets categories
 * and not tags, and reindex is not reachable from the interface at all.
 *
 * Reindex is also not the answer, and that is deliberate rather than
 * missing. Removal writes a durable `fileFieldOverride` REJECT tombstone
 * and `file-suggestions.service.ts` filters every tombstoned label out of
 * the vocabulary it asks the model about. So a reindex runs and declines
 * to re-suggest the tag, which is the correct behaviour — a person said
 * no and the model does not get to overrule it.
 *
 * What was missing was the manual way back. `applyTagEdits` has handled
 * `addTagLabelIds` all along: it upserts the label to CONFIRMED and then
 * deletes the tombstone, because adding a tag by hand clears an earlier
 * rejection of it. The API is symmetric; only the web app was not, and it
 * passed `removeTagLabelIds` and never `addTagLabelIds`.
 *
 * This suite pins the backend half of the round trip so the web wiring
 * has something underneath it that cannot quietly rot. It needs a real
 * database: the tombstone is a row with a compound unique key, and the
 * whole claim is about which rows exist after three edits in sequence.
 */

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const suffix = randomUUID().slice(0, 8);
let ownerId = "";
let workspaceId = "";
let scopeId = "";
let tagId = "";
let resourceId = "";

function actor(): FileActor {
  return { userId: ownerId, organizationId: null, kind: "interactive" };
}

/** The current revision, which every edit has to be told. */
async function revision(): Promise<number> {
  const row = await prisma.fileResource.findUniqueOrThrow({
    where: { id: resourceId },
    select: { metadataRevision: true },
  });
  return row.metadataRevision;
}

/** The tombstone that makes removal durable, or null. */
async function tombstone() {
  return prisma.fileFieldOverride.findFirst({
    where: {
      resourceId,
      field: "tags",
      labelId: tagId,
      evidenceScopeId: scopeId,
    },
    select: { decision: true },
  });
}

async function labelRow() {
  return prisma.fileLabel.findFirst({
    where: { resourceId, labelId: tagId, evidenceScopeId: scopeId },
    select: { id: true, state: true, provenance: true },
  });
}

/**
 * A model suggestion, written the way the suggestion pipeline writes one.
 *
 * The starting point matters: A's report is about a *suggested* tag that
 * was accepted and then removed, and MODEL provenance is what makes the
 * removal a rejection of the model rather than an edit of a manual tag.
 */
async function seedSuggestion(): Promise<string> {
  const row = await prisma.fileLabel.create({
    data: {
      resourceId,
      labelId: tagId,
      evidenceScopeId: scopeId,
      state: FileMetadataState.SUGGESTED,
      provenance: FileMetadataProvenance.MODEL,
      contentRevision: 1,
      vocabularyVersion: 1,
    },
    select: { id: true },
  });
  return row.id;
}

describe.skipIf(!enabled)("a removed tag can be put back", () => {
  beforeAll(async () => {
    const owner = await prisma.user.create({
      data: {
        name: "Tag owner",
        email: `tag-door-${suffix}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    ownerId = owner.id;

    workspaceId = (
      await prisma.workspace.create({
        data: { userId: ownerId },
        select: { id: true },
      })
    ).id;

    scopeId = (
      await ensureEvidenceScope({
        workspaceId,
        sourceKind: FileSourceKind.DRIVE_UPLOAD,
        sourceScope: FileSourceScope.USER,
        sourceId: ownerId,
      })
    ).id;

    tagId = (
      await prisma.workspaceLabel.create({
        data: {
          workspaceId,
          kind: FileLabelKind.TAG,
          displayName: "Commuting",
          normalizedName: "commuting",
          description: "Documents about commuting",
        },
        select: { id: true },
      })
    ).id;

    resourceId = (
      await prisma.fileResource.create({
        data: {
          workspaceId,
          sourceKind: FileSourceKind.DRIVE_UPLOAD,
          sourceScope: FileSourceScope.USER,
          sourceId: `drive/users/${ownerId}/commuters.txt`,
          ownerUserId: ownerId,
          displayName: "commuters.txt",
          normalizedName: "commuters.txt",
          mimeType: "text/plain",
          lifecycle: FileResourceLifecycle.ACTIVE,
          versions: {
            create: {
              revision: 1,
              objectKey: `drive/users/${ownerId}/commuters.txt`,
              mimeType: "text/plain",
              extractionState: "INDEXED",
              extractionCoverage: 1,
            },
          },
        },
        select: { id: true },
      })
    ).id;
  });

  beforeEach(async () => {
    // Each case starts from a document with no decisions on it, or the
    // previous case's tombstone decides this one's outcome.
    await prisma.fileLabel.deleteMany({ where: { resourceId } });
    await prisma.fileFieldOverride.deleteMany({ where: { resourceId } });
  });

  afterAll(async () => {
    if (!enabled) return;
    await prisma.fileResource.deleteMany({ where: { workspaceId } });
    await prisma.fileEvidenceScope.deleteMany({ where: { workspaceId } });
    await prisma.workspaceLabel.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  });

  it("leaves a tombstone when the tag is removed", async () => {
    /**
     * Stated first and on its own, because it is what makes the next case
     * mean anything. If removal stopped writing the tombstone, "the
     * tombstone is gone after adding it back" would pass for the wrong
     * reason — there would have been nothing to delete.
     */
    const suggestionId = await seedSuggestion();

    expect(
      (
        await decideFileSuggestion({
          workspaceId,
          actor: actor(),
          resourceId,
          suggestionId,
          decision: "accept",
          expectedMetadataRevision: await revision(),
        })
      ).status,
    ).toBe("applied");
    expect((await labelRow())?.state).toBe(FileMetadataState.CONFIRMED);

    expect(
      (
        await updateFileMetadata({
          workspaceId,
          actor: actor(),
          resourceId,
          request: {
            expectedMetadataRevision: await revision(),
            removeTagLabelIds: [tagId],
          },
        })
      ).status,
    ).toBe("applied");

    expect((await labelRow())?.state).toBe(FileMetadataState.REJECTED);
    expect((await tombstone())?.decision).toBe(
      FileFieldOverrideDecision.REJECT,
    );
  }, 60_000);

  it("clears the tombstone and confirms the label when it is added back", async () => {
    /**
     * The round trip, end to end: suggested, accepted, removed, added
     * back. Both halves are asserted — a re-add that confirmed the label
     * but left the tombstone would put the tag on screen while the model
     * stayed permanently barred from ever suggesting it again, which is a
     * quieter version of the same one-way door.
     */
    const suggestionId = await seedSuggestion();
    await decideFileSuggestion({
      workspaceId,
      actor: actor(),
      resourceId,
      suggestionId,
      decision: "accept",
      expectedMetadataRevision: await revision(),
    });
    await updateFileMetadata({
      workspaceId,
      actor: actor(),
      resourceId,
      request: {
        expectedMetadataRevision: await revision(),
        removeTagLabelIds: [tagId],
      },
    });
    // The door, shut. Everything above is setup for this line.
    expect(await tombstone()).not.toBeNull();

    const added = await updateFileMetadata({
      workspaceId,
      actor: actor(),
      resourceId,
      request: {
        expectedMetadataRevision: await revision(),
        addTagLabelIds: [tagId],
      },
    });

    expect(added.status).toBe("applied");

    const row = await labelRow();
    expect(row?.state).toBe(FileMetadataState.CONFIRMED);
    // Put back by a person, and recorded as such.
    expect(row?.provenance).toBe(FileMetadataProvenance.MANUAL);

    expect(
      await tombstone(),
      "the label is on the file again but the model is still barred from " +
        "ever suggesting it: removal is still one-way for the pipeline",
    ).toBeNull();
  }, 60_000);

  it("reuses the one label row rather than writing a second", async () => {
    // The suggestion and the tag are the same row, by compound unique key.
    // A re-add that inserted a new row would leave the REJECTED one behind
    // and the two would disagree about what the document is tagged with.
    const suggestionId = await seedSuggestion();
    await decideFileSuggestion({
      workspaceId,
      actor: actor(),
      resourceId,
      suggestionId,
      decision: "accept",
      expectedMetadataRevision: await revision(),
    });
    await updateFileMetadata({
      workspaceId,
      actor: actor(),
      resourceId,
      request: {
        expectedMetadataRevision: await revision(),
        removeTagLabelIds: [tagId],
      },
    });
    await updateFileMetadata({
      workspaceId,
      actor: actor(),
      resourceId,
      request: {
        expectedMetadataRevision: await revision(),
        addTagLabelIds: [tagId],
      },
    });

    const rows = await prisma.fileLabel.findMany({
      where: { resourceId, labelId: tagId, evidenceScopeId: scopeId },
      select: { id: true, state: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(suggestionId);
  }, 60_000);

  it("refuses to add a tag against a stale revision", async () => {
    /**
     * The conflict path the web control has to handle, because the detail
     * page holds a revision from whenever it last loaded. Asserted here so
     * the client's "reload and tell them" branch is answering something
     * real rather than something assumed.
     */
    const stale = await revision();
    await updateFileMetadata({
      workspaceId,
      actor: actor(),
      resourceId,
      request: {
        expectedMetadataRevision: stale,
        addTagLabelIds: [tagId],
      },
    });

    const second = await updateFileMetadata({
      workspaceId,
      actor: actor(),
      resourceId,
      request: { expectedMetadataRevision: stale, addTagLabelIds: [tagId] },
    });

    expect(second.status).toBe("conflict");
  }, 60_000);
});
