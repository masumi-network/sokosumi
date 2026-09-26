import { randomUUID } from "node:crypto";

import {
  FileLabelKind,
  FileMetadataProvenance,
  FileMetadataState,
  FileResourceLifecycle,
  FileSourceKind,
  FileSourceScope,
} from "@sokosumi/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import prisma from "@/lib/db/prisma";
import type { FileActor } from "@/lib/files/actor";
import { ensureEvidenceScope } from "@/lib/files/evidence-scope";
import { chunkExtractedText } from "@/lib/files/extraction";
import { retrieveFileCandidates } from "@/lib/files/retrieval";
import { writeVersionChunks } from "@/services/file-index.service";
import { updateFileMetadata } from "@/services/file-metadata.service";
import { searchFiles } from "@/services/file-search.service";

/**
 * The retrieval layer against a real PostgreSQL.
 *
 * The authorized relation, the FTS query and the window paging are all raw
 * SQL, so a unit test cannot tell whether they are even syntactically valid.
 * This suite runs them against a disposable database with every migration
 * applied, and it is opt-in the same way the other `*.postgres.test.ts`
 * suites are.
 *
 * No model is involved: Jev stays disabled here, which is also what makes
 * these assertions about *our* ordering rather than about a provider.
 */

const databaseUrl = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  databaseUrl?.startsWith("postgres");

const suffix = randomUUID().slice(0, 8);
let ownerId = "";
let outsiderId = "";
let workspaceId = "";
let scopeId = "";
const resourceIds: string[] = [];

function actorFor(userId: string): FileActor {
  return { userId, organizationId: null, kind: "interactive" };
}

async function seedResource(input: {
  displayName: string;
  text: string;
}): Promise<string> {
  const resource = await prisma.fileResource.create({
    data: {
      workspaceId,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope: FileSourceScope.USER,
      sourceId: `drive/users/${ownerId}/${input.displayName}`,
      ownerUserId: ownerId,
      displayName: input.displayName,
      normalizedName: input.displayName.toLowerCase(),
      mimeType: "text/plain",
      sizeBytes: input.text.length,
      lifecycle: FileResourceLifecycle.ACTIVE,
      versions: {
        create: {
          revision: 1,
          objectKey: `drive/users/${ownerId}/${input.displayName}`,
          mimeType: "text/plain",
          extractionState: "INDEXED",
          extractionCoverage: 1,
        },
      },
    },
    select: { id: true, versions: { select: { id: true } } },
  });

  await writeVersionChunks({
    versionId: resource.versions[0].id,
    evidenceScopeId: scopeId,
    scopeVersion: 1,
    chunks: chunkExtractedText(input.text),
  });

  resourceIds.push(resource.id);
  return resource.id;
}

describe.skipIf(!enabled)("Files retrieval against PostgreSQL", () => {
  beforeAll(async () => {
    const owner = await prisma.user.create({
      data: {
        name: "Files owner",
        email: `files-owner-${suffix}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const outsider = await prisma.user.create({
      data: {
        name: "Files outsider",
        email: `files-outsider-${suffix}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    ownerId = owner.id;
    outsiderId = outsider.id;

    const workspace = await prisma.workspace.create({
      data: { userId: ownerId },
      select: { id: true },
    });
    workspaceId = workspace.id;

    const scope = await ensureEvidenceScope({
      workspaceId,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope: FileSourceScope.USER,
      sourceId: ownerId,
    });
    scopeId = scope.id;

    await seedResource({
      displayName: "aurora-research.txt",
      text: "Findings about bicycle commuters in the Aurora launch audience.",
    });
    await seedResource({
      displayName: "quarterly-strategy.txt",
      text: "Strategy for the next quarter. Commuters are one segment we cover.",
    });
    await seedResource({
      displayName: "unrelated-notes.txt",
      text: "Kitchen renovation quotes and a shopping list.",
    });
  });

  afterAll(async () => {
    if (!enabled) return;
    await prisma.fileResource.deleteMany({ where: { workspaceId } });
    await prisma.fileEvidenceScope.deleteMany({ where: { workspaceId } });
    await prisma.fileResultWindow.deleteMany({ where: { workspaceId } });
    await prisma.workspaceLabel.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({
      where: { id: { in: [ownerId, outsiderId] } },
    });
  });

  it("finds a document by a word in its text", async () => {
    const result = await retrieveFileCandidates({
      workspaceId,
      actor: actorFor(ownerId),
      query: "commuters",
      filters: {},
      sortBy: "relevance",
      sortOrder: "desc",
    });

    const names = result.candidates.map((candidate) => candidate.displayName);
    expect(names).toContain("aurora-research.txt");
    expect(names).toContain("quarterly-strategy.txt");
    expect(names).not.toContain("unrelated-notes.txt");
    expect(result.recall.fullText).toBeGreaterThan(0);
  });

  it("puts an exact filename match first, ahead of a stronger text match", async () => {
    const result = await retrieveFileCandidates({
      workspaceId,
      actor: actorFor(ownerId),
      query: "quarterly-strategy.txt",
      filters: {},
      sortBy: "relevance",
      sortOrder: "desc",
    });

    expect(result.candidates[0]?.displayName).toBe("quarterly-strategy.txt");
    expect(result.candidates[0]?.exactNameMatch).toBe(true);
  });

  it("returns nothing at all to someone who does not own the store", async () => {
    const result = await retrieveFileCandidates({
      workspaceId,
      actor: actorFor(outsiderId),
      query: "commuters",
      filters: {},
      sortBy: "relevance",
      sortOrder: "desc",
    });

    expect(result.candidates).toEqual([]);
  });

  it("lists the store with no query, newest first", async () => {
    const result = await retrieveFileCandidates({
      workspaceId,
      actor: actorFor(ownerId),
      query: null,
      filters: {},
      sortBy: "modified",
      sortOrder: "desc",
    });

    expect(result.candidates).toHaveLength(3);
    expect(result.recall.browse).toBe(3);
  });

  it("pages a ranked window and reports a cursor, not a corpus total", async () => {
    const page = await searchFiles({
      workspaceId,
      actor: actorFor(ownerId),
      query: "commuters",
      filters: {},
      sortBy: "relevance",
      sortOrder: "desc",
      cursor: null,
      limit: 1,
    });

    expect(page.items).toHaveLength(1);
    expect(page.search.rankingMode).toBe("deterministic");
    expect(page.search.hasMore).toBe(true);
    expect(page.search.nextCursor).toBeTruthy();
    expect(page.search.windowCount).toBe(2);

    const second = await searchFiles({
      workspaceId,
      actor: actorFor(ownerId),
      query: "commuters",
      filters: {},
      sortBy: "relevance",
      sortOrder: "desc",
      cursor: page.search.nextCursor,
      limit: 1,
    });

    expect(second.items).toHaveLength(1);
    expect(second.items[0].id).not.toBe(page.items[0].id);
    expect(second.search.restarted).toBe(false);
  });

  it("keeps a removed tag removed, and filters by a confirmed one", async () => {
    const tag = await prisma.workspaceLabel.create({
      data: {
        workspaceId,
        kind: FileLabelKind.TAG,
        displayName: "Audience",
        normalizedName: "audience",
      },
      select: { id: true },
    });

    const [resourceId] = resourceIds;
    const before = await prisma.fileResource.findUniqueOrThrow({
      where: { id: resourceId },
      select: { metadataRevision: true },
    });

    const applied = await updateFileMetadata({
      workspaceId,
      actor: actorFor(ownerId),
      resourceId,
      request: {
        expectedMetadataRevision: before.metadataRevision,
        addTagLabelIds: [tag.id],
      },
    });
    expect(applied.status).toBe("applied");

    const filtered = await retrieveFileCandidates({
      workspaceId,
      actor: actorFor(ownerId),
      query: null,
      filters: { tagLabelIds: [tag.id], tagMatch: "any" },
      sortBy: "modified",
      sortOrder: "desc",
    });
    expect(filtered.candidates.map((entry) => entry.resourceId)).toEqual([
      resourceId,
    ]);

    const removed = await updateFileMetadata({
      workspaceId,
      actor: actorFor(ownerId),
      resourceId,
      request: {
        expectedMetadataRevision: applied.metadataRevision ?? 0,
        removeTagLabelIds: [tag.id],
      },
    });
    expect(removed.status).toBe("applied");

    // The durable part: a rejection override outlives the assignment, so a
    // later suggestion run cannot put the tag back.
    const override = await prisma.fileFieldOverride.findFirst({
      where: { resourceId, labelId: tag.id, field: "tags" },
      select: { decision: true },
    });
    expect(override?.decision).toBe("REJECT");

    const label = await prisma.fileLabel.findFirst({
      where: { resourceId, labelId: tag.id },
      select: { state: true, provenance: true },
    });
    expect(label?.state).toBe(FileMetadataState.REJECTED);
    expect(label?.provenance).toBe(FileMetadataProvenance.MANUAL);
  });

  it("rejects an edit made against a stale revision", async () => {
    const [resourceId] = resourceIds;
    const outcome = await updateFileMetadata({
      workspaceId,
      actor: actorFor(ownerId),
      resourceId,
      request: { expectedMetadataRevision: 1 },
    });
    expect(outcome.status).toBe("conflict");
  });
});
