import { randomUUID } from "node:crypto";

import {
  type FileExtractionState,
  FileLabelKind,
  FileMetadataProvenance,
  FileMetadataState,
  FileResourceLifecycle,
  FileSourceKind,
  FileSourceScope,
} from "@sokosumi/database";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import prisma from "@/lib/db/prisma";
import type { FileActor } from "@/lib/files/actor";
import { ensureEvidenceScope } from "@/lib/files/evidence-scope";
import { chunkExtractedText } from "@/lib/files/extraction";
import {
  METADATA_WEIGHT_CONFIRMED,
  METADATA_WEIGHT_SUGGESTED,
  RRF_K,
  retrieveFileCandidates,
} from "@/lib/files/retrieval";
import { writeVersionChunks } from "@/services/file-index.service";
import { updateFileMetadata } from "@/services/file-metadata.service";
import {
  coverageOf,
  hydrateResources,
  loadLiveResources,
  searchFiles,
} from "@/services/file-search.service";

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
  /**
   * Defaults to INDEXED, which is what every pre-existing case here
   * assumes. The coverage cases below need documents that are still
   * being read, and the header's whole job is to count those.
   */
  extractionState?: FileExtractionState;
  /** Skips the version row entirely, so the current revision has none. */
  withoutVersion?: boolean;
  /** Seeds under another user, for the authorization case. */
  ownerUserId?: string;
}): Promise<string> {
  const owner = input.ownerUserId ?? ownerId;
  const resource = await prisma.fileResource.create({
    data: {
      workspaceId,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope: FileSourceScope.USER,
      sourceId: `drive/users/${owner}/${input.displayName}`,
      ownerUserId: owner,
      displayName: input.displayName,
      normalizedName: input.displayName.toLowerCase(),
      mimeType: "text/plain",
      sizeBytes: input.text.length,
      lifecycle: FileResourceLifecycle.ACTIVE,
      ...(input.withoutVersion
        ? {}
        : {
            versions: {
              create: {
                revision: 1,
                objectKey: `drive/users/${owner}/${input.displayName}`,
                mimeType: "text/plain",
                extractionState: input.extractionState ?? "INDEXED",
                extractionCoverage: 1,
              },
            },
          }),
    },
    select: { id: true, versions: { select: { id: true } } },
  });

  if (resource.versions[0]) {
    await writeVersionChunks({
      versionId: resource.versions[0].id,
      evidenceScopeId: scopeId,
      scopeVersion: 1,
      chunks: chunkExtractedText(input.text),
    });
  }

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

  /**
   * "3 still processing" over forty-three Processing badges.
   *
   * Not a rendering race: the two numbers were computed over different
   * sets. `indexCoverage` was `coverageOf(items)`, the hydrated current
   * page, while `windowCount` two lines above it was `entries.length`,
   * the whole window — and the client accumulates items across
   * load-more while replacing `meta` outright. So one sentence carried
   * an accumulated numerator, a window-wide denominator and a
   * last-page-only processing count, and read as though all three
   * shared a scope.
   *
   * The badges were never wrong. The classification rule is identical on
   * both sides and is not what changed; the scope of the count is.
   */
  describe("the header's processing count", () => {
    let coverageWorkspaceIds: string[] = [];

    beforeAll(async () => {
      coverageWorkspaceIds = [
        await seedResource({
          displayName: "pending-alpha.txt",
          text: "Commuters waiting in line alpha.",
          extractionState: "PENDING",
        }),
        await seedResource({
          displayName: "pending-beta.txt",
          text: "Commuters waiting in line beta.",
          extractionState: "RUNNING",
        }),
      ];
    });

    afterAll(async () => {
      if (!enabled) return;
      await prisma.fileResource.deleteMany({
        where: { id: { in: coverageWorkspaceIds } },
      });
    });

    it("1. counts the whole window, not the page it returned", async () => {
      const page = await searchFiles({
        workspaceId,
        actor: actorFor(ownerId),
        query: "waiting",
        filters: {},
        sortBy: "relevance",
        sortOrder: "desc",
        cursor: null,
        limit: 1,
      });

      expect(page.items).toHaveLength(1);
      expect(page.search.windowCount).toBe(2);
      expect(
        page.search.indexCoverage.processing,
        "the count is over the returned page while windowCount beside it " +
          "is over the window, so the header reports a share of the " +
          "documents and presents it as the whole",
      ).toBe(2);
    }, 60_000);

    it("2. agrees with the page when the window fits in one page", async () => {
      /**
       * The invariant that stops the two from drifting apart again. When
       * every entry is returned, a count over the window and a count
       * over the items are counts over the same set, so they have to be
       * the same object — and `coverageOf` is the page-path classifier,
       * so this is the two paths being compared rather than one path
       * being compared with itself.
       */
      const page = await searchFiles({
        workspaceId,
        actor: actorFor(ownerId),
        query: "waiting",
        filters: {},
        sortBy: "relevance",
        sortOrder: "desc",
        cursor: null,
        limit: 20,
      });

      expect(page.items).toHaveLength(page.search.windowCount);
      expect(page.search.indexCoverage).toEqual(coverageOf(page.items));
    }, 60_000);

    it("3. counts a resource with no version row exactly as hydration does", async () => {
      /**
       * Hydration LEFT JOINs `file_version`, so a resource whose current
       * revision has no version row still comes back, with a null state
       * that `classifyExtractionStates` buckets as filenameOnly. An
       * INNER JOIN in the aggregate would drop it instead, and the two
       * numbers would disagree again in a quieter way.
       */
      const orphan = await seedResource({
        displayName: "waiting-no-version.txt",
        text: "Commuters waiting with no version row.",
        withoutVersion: true,
      });

      try {
        const page = await searchFiles({
          workspaceId,
          actor: actorFor(ownerId),
          query: "waiting",
          filters: {},
          sortBy: "relevance",
          sortOrder: "desc",
          cursor: null,
          limit: 20,
        });

        const total =
          page.search.indexCoverage.indexed +
          page.search.indexCoverage.processing +
          page.search.indexCoverage.filenameOnly;

        expect(
          total,
          "the aggregate dropped a resource hydration keeps, so the " +
            "buckets no longer add up to the window",
        ).toBe(page.search.windowCount);
        expect(page.search.indexCoverage).toEqual(coverageOf(page.items));
      } finally {
        await prisma.fileResource.deleteMany({ where: { id: orphan } });
      }
    }, 60_000);

    it("4. does not count a resource the reader has lost access to", async () => {
      /**
       * The aggregate runs its own query, so it needs its own
       * `WHERE ${authorized}` — and showing that takes some care,
       * because a first page cannot show it at all. The window's ids
       * come from retrieval, which is already authorized, so on the
       * first page the aggregate is handed nothing it should refuse and
       * dropping the predicate changes no number. I wrote that version
       * first and it passed with the predicate deleted, which made it
       * evidence of nothing.
       *
       * The exposure is the one `loadLiveResources` is documented
       * against: "a cache hit is never authorization". A window is
       * stored and replayed by cursor, so access can change between the
       * page that built it and the page that follows it. Hydration
       * re-checks every page and drops the row. The aggregate has to
       * drop it too, or the header keeps counting a document the reader
       * can no longer open.
       */
      const revoked = await seedResource({
        displayName: "waiting-revoked.txt",
        text: "Commuters waiting, access about to change.",
        extractionState: "PENDING",
      });

      try {
        const first = await searchFiles({
          workspaceId,
          actor: actorFor(ownerId),
          query: "waiting",
          filters: {},
          sortBy: "relevance",
          sortOrder: "desc",
          cursor: null,
          limit: 1,
        });

        // The premise: it is in the window this cursor points at.
        expect(first.search.windowCount).toBe(3);
        expect(first.search.indexCoverage.processing).toBe(3);

        // Access changes while the window is still live.
        await prisma.fileResource.update({
          where: { id: revoked },
          data: { ownerUserId: outsiderId },
        });

        const second = await searchFiles({
          workspaceId,
          actor: actorFor(ownerId),
          query: "waiting",
          filters: {},
          sortBy: "relevance",
          sortOrder: "desc",
          cursor: first.search.nextCursor,
          limit: 20,
        });

        expect(second.items.map((item) => item.id)).not.toContain(revoked);
        expect(
          second.search.indexCoverage.processing,
          "the reader can no longer open that document and the header is " +
            "still counting it",
        ).toBe(2);
      } finally {
        await prisma.fileResource.deleteMany({ where: { id: revoked } });
      }
    }, 60_000);
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

  it("frees the pathname on delete, so a re-upload is a new document", async () => {
    const { tombstoneDriveUploadResource, reserveDriveUploadResource } =
      await import("@/services/file-catalog.service");

    const pathname = `drive/users/${ownerId}/recycled.txt`;
    const first = await reserveDriveUploadResource({
      key: { workspaceId, scope: "user", ownerId, pathname },
      displayName: "recycled.txt",
      mimeType: "text/plain",
      sizeBytes: 10,
    });

    await tombstoneDriveUploadResource({
      workspaceId,
      scope: "user",
      pathname,
    });

    const second = await reserveDriveUploadResource({
      key: { workspaceId, scope: "user", ownerId, pathname },
      displayName: "recycled.txt",
      mimeType: "text/plain",
      sizeBytes: 12,
    });

    expect(second.resourceId).not.toBe(first.resourceId);

    const tombstoned = await prisma.fileResource.findUniqueOrThrow({
      where: { id: first.resourceId },
      select: { sourceId: true, tombstonedAt: true },
    });
    expect(tombstoned.tombstonedAt).not.toBeNull();
    expect(tombstoned.sourceId).not.toBe(pathname);
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

  it("survives a table resource whose source id is not a uuid", async () => {
    // The NATIVE_TABLE arm casts `sourceId` to uuid to join `data_table`.
    // `sourceId` is a plain string column that holds a pathname for every
    // other source kind, so the cast is only safe while every NATIVE_TABLE
    // row happens to hold a well-formed id. One that does not is not a
    // missing table in the results — Postgres raises on the cast and the
    // whole authorized query fails, taking every other file in the
    // workspace down with it.
    // The arm is a semi-join, so an empty `data_table` never probes the
    // cast at all. One real table in the workspace is what makes the join
    // evaluate it — which is the ordinary state once tables are indexed.
    const table = await prisma.dataTable.create({
      data: { workspaceId, title: "A real table", createdBy: ownerId },
      select: { id: true },
    });

    const planted = await prisma.fileResource.create({
      data: {
        workspaceId,
        sourceKind: FileSourceKind.NATIVE_TABLE,
        sourceScope: FileSourceScope.USER,
        sourceId: "not-a-uuid",
        ownerUserId: ownerId,
        displayName: "broken-table",
        normalizedName: "broken-table",
        lifecycle: FileResourceLifecycle.ACTIVE,
      },
      select: { id: true },
    });

    try {
      // Browsing, not searching: the text path only ever reaches rows that
      // have indexed chunks, so it never sees this one. Listing the store
      // scans every resource, which is where the cast is reached.
      const browsed = await retrieveFileCandidates({
        workspaceId,
        actor: actorFor(ownerId),
        query: null,
        filters: {},
        sortBy: "modified",
        sortOrder: "desc",
      });

      const names = browsed.candidates.map(
        (candidate) => candidate.displayName,
      );
      expect(names).toContain("aurora-research.txt");
      expect(names).not.toContain("broken-table");
    } finally {
      await prisma.fileResource.delete({ where: { id: planted.id } });
      await prisma.dataTable.delete({ where: { id: table.id } });
    }
  });

  it("says why the ordering was deterministic, in the same payload", async () => {
    /**
     * The gap a reviewer hit on a preview: `rankingMode: "deterministic"`
     * came back in 340 ms with no way to find out what gated it. The
     * reason existed — `fallbackReason` is computed on every ranking —
     * but it went only to evlog, and pulling it back out of the
     * platform's log stream defeated two attempts because the stream is
     * unbounded and exhausted the heap.
     *
     * A reason only an operator with log access can read is a reason
     * nobody reads, so it travels with the ordering it explains.
     *
     * Jev is not configured in this environment, which is exactly the
     * case that was indistinguishable from a healthy deterministic
     * search: the mode alone cannot tell "the feature is off" from "the
     * model ran and agreed with the deterministic order".
     */
    const page = await searchFiles({
      workspaceId,
      actor: actorFor(ownerId),
      query: "commuters",
      filters: {},
      sortBy: "relevance",
      sortOrder: "desc",
      cursor: null,
      limit: 10,
    });

    expect(page.search.rankingMode).toBe("deterministic");
    expect(page.search.rankingFallback).toBe("disabled");
  });

  it("reports no reason for a page that ranked nothing", async () => {
    /**
     * A cursor page reuses a stored window and runs no ranking at all,
     * so there is no cause to report. Null here means "not applicable to
     * this page", and inventing a reason would be as misleading as the
     * silence this replaces.
     */
    const first = await searchFiles({
      workspaceId,
      actor: actorFor(ownerId),
      query: "commuters",
      filters: {},
      sortBy: "relevance",
      sortOrder: "desc",
      cursor: null,
      limit: 1,
    });
    expect(first.search.nextCursor).toBeTruthy();

    const second = await searchFiles({
      workspaceId,
      actor: actorFor(ownerId),
      query: "commuters",
      filters: {},
      sortBy: "relevance",
      sortOrder: "desc",
      cursor: first.search.nextCursor,
      limit: 1,
    });

    expect(second.search.rankingFallback).toBeNull();
  });

  /**
   * A label the model applied and nobody has confirmed is findable.
   *
   * Every one of the four label clauses in `retrieval.ts` gated on
   * `state = CONFIRMED`, and the only thing that ever promoted a label to
   * CONFIRMED was the manual assign surface. With that surface removed the
   * model's own labels were visible on the row and unreachable by both the
   * filter beside them and the search box above them: a tag you could read
   * and could not use. Decorative rather than absent, which is why no test
   * and no reader caught it.
   *
   * SUGGESTED is now findable; REJECTED still is not, at every clause.
   */
  describe("finding a document by a label nobody has confirmed", () => {
    let suggestedTagId = "";
    let suggestedResourceId = "";

    beforeAll(async () => {
      const tag = await prisma.workspaceLabel.create({
        data: {
          workspaceId,
          kind: FileLabelKind.TAG,
          displayName: "Zeppelin",
          normalizedName: "zeppelin",
          description: "Documents about airships",
        },
        select: { id: true },
      });
      suggestedTagId = tag.id;

      suggestedResourceId = await seedResource({
        displayName: "airship-logbook.txt",
        text: "Mooring procedures and ballast notes.",
      });
    });

    /** Exactly what `runSuggestionJob` writes: SUGGESTED, provenance MODEL. */
    async function suggestTheTag(): Promise<void> {
      await prisma.fileLabel.create({
        data: {
          resourceId: suggestedResourceId,
          labelId: suggestedTagId,
          state: FileMetadataState.SUGGESTED,
          provenance: FileMetadataProvenance.MODEL,
          evidenceScopeId: scopeId,
          contentRevision: 1,
          vocabularyVersion: 1,
          evidenceSnippet: "Mooring procedures",
        },
      });
    }

    /** Resources a single case seeded, torn down with that case. */
    let extraResourceIds: string[] = [];

    afterEach(async () => {
      if (!enabled) return;
      // By label, not by resource: a case that seeds a second document with
      // the same tag would otherwise leave a row that the *next* case's filter
      // legitimately matches — which reads as the filter being wrong when it
      // is the fixture leaking.
      await prisma.fileLabel.deleteMany({ where: { labelId: suggestedTagId } });
      if (extraResourceIds.length > 0) {
        await prisma.fileResource.deleteMany({
          where: { id: { in: extraResourceIds } },
        });
        extraResourceIds = [];
      }
    });

    afterAll(async () => {
      if (!enabled) return;
      await prisma.fileResource.deleteMany({
        where: { id: { in: [suggestedResourceId] } },
      });
    });

    it("filters by a suggested tag", async () => {
      await suggestTheTag();
      const filtered = await retrieveFileCandidates({
        workspaceId,
        actor: actorFor(ownerId),
        query: null,
        filters: { tagLabelIds: [suggestedTagId], tagMatch: "any" },
        sortBy: "modified",
        sortOrder: "desc",
      });
      expect(filtered.candidates.map((entry) => entry.resourceId)).toEqual([
        suggestedResourceId,
      ]);
    });

    it("filters by a suggested tag under tagMatch all", async () => {
      await suggestTheTag();
      // A separate clause in the source, with its own copy of the defect.
      const filtered = await retrieveFileCandidates({
        workspaceId,
        actor: actorFor(ownerId),
        query: null,
        filters: { tagLabelIds: [suggestedTagId], tagMatch: "all" },
        sortBy: "modified",
        sortOrder: "desc",
      });
      expect(filtered.candidates.map((entry) => entry.resourceId)).toEqual([
        suggestedResourceId,
      ]);
    });

    it("finds the document by typing the suggested label's name", async () => {
      await suggestTheTag();
      // The metadata retrieval strategy, which is a different clause again:
      // the query matches no word in this document's text, so a hit can only
      // have come through the label.
      const found = await retrieveFileCandidates({
        workspaceId,
        actor: actorFor(ownerId),
        query: "zeppelin",
        filters: {},
        sortBy: "relevance",
        sortOrder: "desc",
      });
      expect(found.candidates.map((entry) => entry.resourceId)).toContain(
        suggestedResourceId,
      );
      // Through the metadata leg specifically, and weighted as a suggestion
      // rather than as something a person agreed to.
      const candidate = found.candidates.find(
        (entry) => entry.resourceId === suggestedResourceId,
      );
      expect(candidate?.metadataMatch).toBe(true);
      expect(candidate?.fusedScore).toBeCloseTo(
        METADATA_WEIGHT_SUGGESTED / (RRF_K + 1),
        10,
      );
    });

    it("ranks a confirmed label above an identical suggested one", async () => {
      await suggestTheTag();
      const confirmedResourceId = await seedResource({
        displayName: "airship-manifest.txt",
        text: "Cargo manifest.",
      });
      extraResourceIds.push(confirmedResourceId);
      await prisma.fileLabel.create({
        data: {
          resourceId: confirmedResourceId,
          labelId: suggestedTagId,
          state: FileMetadataState.CONFIRMED,
          provenance: FileMetadataProvenance.MANUAL,
          evidenceScopeId: scopeId,
          contentRevision: 1,
          vocabularyVersion: 1,
        },
      });

      const found = await retrieveFileCandidates({
        workspaceId,
        actor: actorFor(ownerId),
        query: "zeppelin",
        filters: {},
        sortBy: "relevance",
        sortOrder: "desc",
      });
      /**
       * Exact scores, by each row's own rank in the leg.
       *
       * This asserted only `confirmed > suggested`, and that passes with a
       * flat weight too: the metadata leg orders by `updatedAt DESC`, so the
       * newer document sits at a lower index and outscores the other on
       * reciprocal rank alone. The test could not fail for the thing it was
       * named after — verified by reverting the weighting and watching it stay
       * green. Pinning the weight each row was given is what makes it a test
       * of the weighting rather than of the insertion order.
       */
      const scoreAndRank = (id: string) => {
        const index = found.candidates.findIndex(
          (entry) => entry.resourceId === id,
        );
        return { index, score: found.candidates[index]?.fusedScore ?? 0 };
      };
      const confirmed = scoreAndRank(confirmedResourceId);
      const suggested = scoreAndRank(suggestedResourceId);

      // Both are findable — that is the point of the change. What differs is
      // what each match is worth, which is what keeps confirmation meaningful
      // to ranking instead of decorative.
      expect(confirmed.score).toBeCloseTo(
        METADATA_WEIGHT_CONFIRMED / (RRF_K + confirmed.index + 1),
        10,
      );
      expect(suggested.score).toBeCloseTo(
        METADATA_WEIGHT_SUGGESTED / (RRF_K + suggested.index + 1),
        10,
      );
    });

    it("keeps a rejected label unfindable, and says it was rejected", async () => {
      await suggestTheTag();
      await prisma.fileLabel.updateMany({
        where: { resourceId: suggestedResourceId, labelId: suggestedTagId },
        data: { state: FileMetadataState.REJECTED },
      });

      const filtered = await retrieveFileCandidates({
        workspaceId,
        actor: actorFor(ownerId),
        query: null,
        filters: { tagLabelIds: [suggestedTagId], tagMatch: "any" },
        sortBy: "modified",
        sortOrder: "desc",
      });
      expect(filtered.candidates.map((entry) => entry.resourceId)).toEqual([]);

      const byName = await retrieveFileCandidates({
        workspaceId,
        actor: actorFor(ownerId),
        query: "zeppelin",
        filters: {},
        sortBy: "relevance",
        sortOrder: "desc",
      });
      expect(byName.candidates.map((entry) => entry.resourceId)).not.toContain(
        suggestedResourceId,
      );

      // Unfindable, but no longer invisible: the veto is reported so a client
      // can offer to withdraw it. It was filtered out of every response
      // before, which made a wrong removal uncorrectable from any UI.
      const [dto] = await hydrateResources({
        resources: await loadLiveResources({
          workspaceId,
          actor: actorFor(ownerId),
          resourceIds: [suggestedResourceId],
        }),
        query: null,
      });
      expect(dto.rejected.map((label) => label.labelId)).toEqual([
        suggestedTagId,
      ]);
      // And it is not smuggled into either of the other two arrays.
      expect(dto.tags).toEqual([]);
      expect(dto.suggestions).toEqual([]);
    });

    it("reports a model's tag as a tag, and still as a suggestion", async () => {
      /**
       * `tags` used to be CONFIRMED-only, and this case asserted it.
       *
       * `retrieval.ts` had already made a SUGGESTED label findable — by the
       * search box, by a tag filter and by a category filter — and this
       * partition then kept it out of the array the row renders. Nothing
       * promotes a label to CONFIRMED any more, so the dashed "Suggested: X"
       * chip was the permanent rendering of every tag the product produces,
       * first one only and the rest invisible.
       *
       * `suggestions` keeps the SUGGESTED subset, because the file detail
       * page's accept and dismiss controls read it, and the state stays on
       * every entry for ranking weight and the staleness marker.
       */
      await suggestTheTag();

      const [dto] = await hydrateResources({
        resources: await loadLiveResources({
          workspaceId,
          actor: actorFor(ownerId),
          resourceIds: [suggestedResourceId],
        }),
        query: null,
      });

      expect(dto.rejected).toEqual([]);
      expect(dto.tags.map((label) => label.labelId)).toEqual([suggestedTagId]);
      expect(dto.tags[0].state).toBe(FileMetadataState.SUGGESTED);
      expect(dto.suggestions.map((label) => label.labelId)).toEqual([
        suggestedTagId,
      ]);
      expect(dto.suggestions[0].state).toBe(FileMetadataState.SUGGESTED);
    });
  });
});
