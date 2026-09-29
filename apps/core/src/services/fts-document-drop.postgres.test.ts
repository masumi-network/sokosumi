/**
 * REPRODUCTION ARTIFACT — the full-text leg drops documents and misreports it.
 *
 * Written by the reviewer, not the implementer. This is the failing evidence a
 * fix has to satisfy; it contains no fix and touches no product code.
 *
 * **To run:** drop this file into `apps/core/src/services/`, add it to
 * `optInPostgresFiles` in `apps/core/vitest.config.ts` if you want an
 * abbreviated filter to select it, then
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgres://... \
 *     pnpm --filter core test .postgres.test.ts
 *
 * The CI step's substring filter picks it up with no further wiring.
 *
 * **Defect under test** — `apps/core/src/lib/files/retrieval.ts:337-369` and
 * `430-434`. Two defects share those lines:
 *
 * 1. The `hits` CTE computes `ROW_NUMBER() OVER (PARTITION BY fr.id ORDER BY
 *    ts_rank ... DESC)` and *then* applies `LIMIT CANDIDATE_BUDGET_FTS_CHUNKS`
 *    with no `ORDER BY` at the CTE level. Postgres evaluates window functions
 *    before `LIMIT`, and the `row_number()` partition forces a sort on
 *    `fr.id`, so the output is grouped by resource id and the limit consumes
 *    whole documents in id order. `FileResource.id` is `@default(uuid(7))` —
 *    time ordered — so the documents dropped are the most recently uploaded.
 *
 * 2. `truncated` (line 433) compares `ftsRows.length`, which is a **document**
 *    count (one row per document after `chunk_rank = 1`), against
 *    `CANDIDATE_BUDGET_FTS_CHUNKS`, which is a **chunk** budget. The two are
 *    only equal when every matching document has exactly one matching chunk.
 *
 * **Measured on PostgreSQL 18.6 against the branch at 9278e406b:**
 *
 *   A. 30 documents x 5 matching chunks
 *        returned 20 of 30; dropped creation positions [21..30] — the ten
 *        newest, exactly; recall.fullText = 20; truncated = false
 *   B. one 400-chunk document + 29 one-chunk documents
 *        returned 1 of 30; the 400-chunk document was kept and 0 of 29
 *        others survived; recall.fullText = 1; truncated = false
 *   C. 150 documents x 1 matching chunk
 *        returned 100; recall.fullText = 100; truncated = TRUE
 *        (the only shape where the flag's units coincide)
 *   D. 121 documents x 2 matching chunks
 *        returned 50 of 121; recall.fullText = 50; truncated = false
 *
 * B is reachable with a single ordinary upload: `FILE_CHUNK_MAX_PER_VERSION`
 * is 400 and the budget is 100, and nothing upstream prevents one document's
 * chunks from filling it.
 *
 * **All four cases fail against the shipped chunk-budget query and pass
 * against the document-budget fix.** C used to pass in both directions,
 * because it was asserted against a constant whose value happened to be the
 * chunk budget; it is now asserted against `CANDIDATE_BUDGET_FTS_DOCUMENTS`
 * and reads 100 against 120 on the old query. It is kept because it is still
 * the one shape where a document count and a chunk count coincide, which is
 * what made the unit error survivable for so long.
 */
import { randomUUID } from "node:crypto";
import {
  FileResourceLifecycle,
  FileSourceKind,
  FileSourceScope,
} from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import prisma from "@/lib/db/prisma";
import { ensureEvidenceScope } from "@/lib/files/evidence-scope";
import {
  CANDIDATE_BUDGET_FTS_DOCUMENTS,
  retrieveFileCandidates,
} from "@/lib/files/retrieval";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const suffix = randomUUID().slice(0, 8);
/** A token that appears in chunk text and in no filename, so only the
 *  full-text leg can match it. */
const TERM = "zarquon";

let ownerId = "";
let workspaceId = "";
let scopeId = "";
const actor = {
  userId: "",
  organizationId: null,
  kind: "interactive" as const,
};

/**
 * One document whose every chunk contains TERM.
 *
 * Created through Prisma so `id` gets the production `uuid(7)` default —
 * the time ordering is load-bearing for case A.
 */
async function seedDoc(name: string, chunks: number): Promise<string> {
  const resource = await prisma.fileResource.create({
    data: {
      workspaceId,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope: FileSourceScope.USER,
      sourceId: `users/${ownerId}/${name}`,
      ownerUserId: ownerId,
      displayName: name,
      normalizedName: name,
      lifecycle: FileResourceLifecycle.ACTIVE,
      contentRevision: 1,
    },
    select: { id: true },
  });
  const version = await prisma.fileVersion.create({
    data: {
      resourceId: resource.id,
      revision: 1,
      objectKey: name,
      extractionState: "INDEXED",
    },
    select: { id: true },
  });
  for (let i = 1; i <= chunks; i += 1) {
    const text = `passage ${i} mentioning ${TERM} in ${name}`;
    // `search_vector` is not a generated column; the indexer writes it, so
    // the fixture has to as well, with the same configuration.
    await prisma.$executeRaw(PrismaRaw.sql`
      INSERT INTO file_chunk (id,"createdAt","versionId","chunkId",ordinal,text,
        "evidenceScopeId","scopeVersion","inputDigest",search_vector)
      VALUES (gen_random_uuid(), now(), ${version.id}::uuid, ${`c${i}`}, ${i},
        ${text}, ${scopeId}::uuid, 1, 'repro',
        to_tsvector('simple', ${text}))`);
  }
  return resource.id;
}

async function clearDocs(): Promise<void> {
  await prisma.fileResource.deleteMany({ where: { workspaceId } });
}

async function search() {
  return retrieveFileCandidates({
    workspaceId,
    actor,
    query: TERM,
    filters: {},
    sortBy: "relevance",
    sortOrder: "desc",
  });
}

describe.skipIf(!enabled)(
  "the full-text leg must return every matching document, or say it did not",
  () => {
    beforeAll(async () => {
      const owner = await prisma.user.create({
        data: {
          name: "FTS repro owner",
          email: `fts-repro-${suffix}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      ownerId = owner.id;
      actor.userId = owner.id;
      const ws = await prisma.workspace.create({
        data: { userId: ownerId },
        select: { id: true },
      });
      workspaceId = ws.id;
      scopeId = (
        await ensureEvidenceScope({
          workspaceId,
          sourceKind: FileSourceKind.DRIVE_UPLOAD,
          sourceScope: FileSourceScope.USER,
          sourceId: ownerId,
        })
      ).id;
    }, 120_000);

    afterAll(async () => {
      await prisma.fileResource.deleteMany({ where: { workspaceId } });
      await prisma.fileEvidenceScope.deleteMany({ where: { workspaceId } });
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
      await prisma.user.deleteMany({ where: { id: ownerId } });
    });

    /** DEFECT 1. Measured: 20 of 30, and the ten dropped are [21..30]. */
    it("A. returns all 30 documents that match, and does not drop the newest", async () => {
      await clearDocs();
      const ids: string[] = [];
      for (let d = 1; d <= 30; d += 1) {
        ids.push(await seedDoc(`doc-a-${String(d).padStart(2, "0")}`, 5));
      }

      const result = await search();
      const returned = new Set(result.candidates.map((c) => c.resourceId));
      // `ids` is in creation order, which for uuid v7 is also id order.
      const droppedPositions = ids
        .map((id, index) => (returned.has(id) ? null : index + 1))
        .filter((position): position is number => position !== null);

      expect(
        droppedPositions,
        "documents were dropped, and their creation positions show the cut " +
          "is by id order (newest last) rather than by rank",
      ).toEqual([]);
      expect(returned.size).toBe(30);
    }, 300_000);

    /**
     * DEFECT 1, pathological. Measured: 1 of 30 returned — one upload's
     * 400 chunks consumed the whole 100-chunk budget and starved the other
     * 29 documents entirely.
     */
    it("B. one large document does not starve every other match", async () => {
      await clearDocs();
      const hog = await seedDoc("doc-b-hog", 400);
      const others: string[] = [];
      for (let d = 1; d <= 29; d += 1) {
        others.push(await seedDoc(`doc-b-${String(d).padStart(2, "0")}`, 1));
      }

      const result = await search();
      const returned = new Set(result.candidates.map((c) => c.resourceId));

      expect(
        others.filter((id) => returned.has(id)).length,
        "a single 400-chunk document consumed the chunk budget and the " +
          "other 29 matching documents did not appear at all",
      ).toBe(29);
      expect(returned.has(hog)).toBe(true);
    }, 300_000);

    /**
     * DEFECT 2, the one shape where the flag's units coincide: every
     * matching document has exactly one matching chunk, so the document
     * count and the chunk count are the same number. Passes today. A fix
     * must keep it passing.
     */
    it("C. reports truncation when document count happens to equal chunk count", async () => {
      await clearDocs();
      for (let d = 1; d <= 150; d += 1) {
        await seedDoc(`doc-c-${String(d).padStart(3, "0")}`, 1);
      }

      const result = await search();

      expect(result.recall.fullText).toBe(CANDIDATE_BUDGET_FTS_DOCUMENTS);
      expect(result.truncated).toBe(true);
    }, 300_000);

    /**
     * DEFECT 2. One matching document past the budget, so a cut genuinely
     * happens and the flag has something true to report.
     *
     * Seeded at 121 rather than at the budget, deliberately. At exactly the
     * budget nothing is cut, and asserting `truncated` there could only pass
     * if the comparison used `>=` — reporting a cut that did not happen,
     * which is the original lie pointed the other way. 121 is the smallest
     * corpus where both halves are true at once: the flag is set because a
     * document really was dropped, and the page is the budget.
     *
     * Measured against the shipped chunk-budget query: 50 of 121 came back
     * with `truncated = false`, because 242 matching chunks were cut to 100
     * and the flag then compared a document count of 50 against a chunk
     * budget of 100. Fixing the limit alone does not close that: the count
     * of documents returned is still not the count of chunks budgeted.
     */
    it("D. does not claim a complete result set while dropping matches", async () => {
      await clearDocs();
      for (let d = 1; d <= 121; d += 1) {
        await seedDoc(`doc-d-${String(d).padStart(3, "0")}`, 2);
      }

      const result = await search();

      expect(
        result.truncated,
        `${result.candidates.length} of 121 matching documents came back and ` +
          "truncated was false, so nothing told the caller the set was cut",
      ).toBe(true);
      expect(
        result.candidates.length,
        "one document past the budget was dropped, so the page is the budget",
      ).toBe(CANDIDATE_BUDGET_FTS_DOCUMENTS);
    }, 300_000);
  },
);
