/**
 * REPRODUCTION ARTIFACT — re-indexing a native table empties it, in public,
 * while the version row still reports INDEXED with full coverage.
 *
 * Written by the reviewer, not the implementer. Red at `bbd037236`.
 *
 * **To run:** drop this file into `apps/core/src/services/`, then
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgres://... \
 *     pnpm --filter core test .postgres.test.ts --no-file-parallelism
 *
 * **The defect.** `indexDataTable` in `file-table-index.service.ts` upserts the
 * version row to `extractionState: INDEXED, extractionCoverage: 1`, then runs
 *
 *     await prisma.fileChunk.deleteMany({ where: { versionId: version.id } });
 *     if (text.length > 0) { await writeVersionChunks({ ... }); }
 *
 * with no `$transaction` around the pair. The delete commits on its own. Every
 * other connection immediately sees a document that the version row calls
 * fully indexed and that has no text at all. The window lasts for the whole
 * insert, which `writeVersionChunks` does one chunk at a time.
 *
 * `processStaleTableIndexes` calls this from `runExtractionNudge`
 * (`in-process-indexer.ts`), so it runs on ordinary request traffic, not only
 * from a cron. Every edit to a table reopens the window.
 *
 * **What a reader sees.** The table is still in the Drive listing, still says
 * it is indexed, and searching for a value that is in it returns nothing.
 * There is no error, no PARTIAL state and no coverage shortfall — the two
 * fields that exist to say "this document's text is incomplete" both say the
 * opposite.
 *
 * **How the window is observed.** `writeVersionChunks` is wrapped through
 * `vi.mock` with `importOriginal`, so the real function still runs and the
 * product is unchanged; the wrapper just looks at the database first. That is
 * the only moment between the delete and the insert, and it needs no timing.
 *
 * The observation reads through the ordinary `prisma` client, and this is the
 * load-bearing detail: because today there is no transaction, the delete is
 * already committed and what the observer sees is what every other connection
 * sees. Once the pair is wrapped in a transaction the same observer — outside
 * it — sees the previous chunks under MVCC, and both cases below go green
 * without the assertions changing.
 *
 * **Measured on PostgreSQL 18.6 against the branch at bbd037236**, at the
 * moment the insert begins, re-indexing a table that was already searchable:
 *
 *   chunks for the version                     : 0
 *   version.extractionState                    : INDEXED
 *   version.extractionCoverage                 : 1
 *   full-text search for a value in the table  : no match
 *   the file is still listed in Drive          : yes
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** One observation of the database, taken between the delete and the insert. */
interface Window {
  chunkCount: number;
  extractionState: string | null;
  extractionCoverage: number | null;
  foundByContentSearch: boolean;
  listedInDrive: boolean;
}

const windows: Window[] = [];
let observing = false;

vi.mock("@/services/file-index.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/file-index.service")>();
  return {
    ...actual,
    async writeVersionChunks(
      input: Parameters<typeof actual.writeVersionChunks>[0],
    ) {
      if (observing) windows.push(await observeWindow(input.versionId));
      return actual.writeVersionChunks(input);
    },
  };
});

import { createDataTable, type TableActor } from "@/helpers/data-table";
import prisma from "@/lib/db/prisma";
import type { FileActor } from "@/lib/files/actor";
import { retrieveFileCandidates } from "@/lib/files/retrieval";
import { indexDataTable } from "@/services/file-table-index.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const suffix = randomUUID().slice(0, 8);
/** A cell value, so only the table's indexed text can match it. */
const CELL = `northwind${suffix}`;

let ownerId = "";
let workspaceId = "";
let resourceId = "";

const fileActor = (): FileActor => ({
  userId: ownerId,
  organizationId: null,
  kind: "interactive",
});

const tableActor = (): TableActor => ({
  workspaceId,
  userId: ownerId,
  actorId: ownerId,
  actorKind: "user",
});

async function observeWindow(versionId: string): Promise<Window> {
  const [chunkCount, version, hit, listing] = await Promise.all([
    prisma.fileChunk.count({ where: { versionId } }),
    prisma.fileVersion.findUnique({
      where: { id: versionId },
      select: { extractionState: true, extractionCoverage: true },
    }),
    retrieveFileCandidates({
      workspaceId,
      actor: fileActor(),
      query: CELL,
      filters: {},
      sortBy: "relevance",
      sortOrder: "desc",
    }),
    retrieveFileCandidates({
      workspaceId,
      actor: fileActor(),
      query: null,
      filters: {},
      sortBy: "modified",
      sortOrder: "desc",
    }),
  ]);
  return {
    chunkCount,
    extractionState: version?.extractionState ?? null,
    extractionCoverage: version?.extractionCoverage ?? null,
    foundByContentSearch: hit.candidates.some(
      (candidate) => candidate.resourceId === resourceId,
    ),
    listedInDrive: listing.candidates.some(
      (candidate) => candidate.resourceId === resourceId,
    ),
  };
}

describe.skipIf(!enabled)(
  "re-indexing a native table must not empty it in public",
  () => {
    beforeAll(async () => {
      const owner = await prisma.user.create({
        data: {
          name: "Table reindex owner",
          email: `table-reindex-${suffix}@example.test`,
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

      // A real table, created and indexed the way `/sync/drive-index` does.
      const table = await createDataTable(tableActor(), {
        key: `tbl-${randomUUID().slice(0, 8)}`,
        title: `Suppliers ${suffix}`,
        description: "",
        columns: [
          { name: "Supplier", type: "text", description: "", options: [] },
          { name: "City", type: "text", description: "", options: [] },
        ],
        rows: [],
      });
      await prisma.tableRow.createMany({
        data: [
          {
            tableId: table.id,
            values: {
              [table.columns[0].id]: CELL,
              [table.columns[1].id]: "Rotterdam",
            },
          },
        ],
      });

      // First index: this is the state a reader already has, a searchable
      // table. Not observed — there is nothing to lose yet.
      const first = await indexDataTable(tableActor(), table.id);
      resourceId = first.resourceId;

      // The premise: it really is findable by its contents before the
      // re-index, so the window below is a loss and not an absence.
      const before = await retrieveFileCandidates({
        workspaceId,
        actor: fileActor(),
        query: CELL,
        filters: {},
        sortBy: "relevance",
        sortOrder: "desc",
      });
      if (!before.candidates.some((c) => c.resourceId === resourceId)) {
        throw new Error(
          "fixture is not exercising the defect: the table was not findable " +
            "by its own cell value before the re-index",
        );
      }

      // The re-index. Every edit to the table runs this.
      observing = true;
      await indexDataTable(tableActor(), table.id);
      observing = false;
    }, 300_000);

    afterAll(async () => {
      if (!enabled) return;
      await prisma.fileResource.deleteMany({ where: { workspaceId } });
      await prisma.dataTable.deleteMany({ where: { workspaceId } });
      await prisma.fileEvidenceScope.deleteMany({ where: { workspaceId } });
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
      await prisma.user.deleteMany({ where: { id: ownerId } });
    });

    it("1. the re-index was observed", () => {
      expect(
        windows.length,
        "writeVersionChunks was not reached, so nothing was observed and " +
          "the cases below would pass for the wrong reason",
      ).toBeGreaterThan(0);
    });

    /**
     * FAILS TODAY. Measured: chunks 0, state INDEXED, coverage 1 — the two
     * fields that exist to report incomplete text both report complete text
     * over a document that has none.
     */
    it("2. no committed state has zero chunks while the version says INDEXED", () => {
      const lying = windows.filter(
        (window) =>
          window.chunkCount === 0 &&
          window.extractionState === "INDEXED" &&
          window.extractionCoverage === 1,
      );

      expect(
        lying,
        "during the re-index the document had no text at all while its " +
          "version row reported INDEXED with coverage 1. The delete is " +
          "committed on its own, so this is what every other connection " +
          `sees. Observed: ${JSON.stringify(windows)}`,
      ).toEqual([]);
    });

    /**
     * FAILS TODAY. The same window said as a reader experiences it: the file
     * is in the listing and searching for what is in it finds nothing.
     */
    it("3. the table stays findable by its contents throughout the re-index", () => {
      const lost = windows.filter(
        (window) => window.listedInDrive && !window.foundByContentSearch,
      );

      expect(
        lost,
        "mid-re-index the table was still listed in Drive and a search for a " +
          "value in it returned nothing, with no error and no coverage " +
          `shortfall to explain it. Observed: ${JSON.stringify(windows)}`,
      ).toEqual([]);
    });
  },
);
