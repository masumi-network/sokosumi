/**
 * REPRODUCTION ARTIFACT — the full-text cut still drops the newest matching
 * documents, above the budget.
 *
 * Written by the reviewer, not the implementer. Red at `093bde2d2`.
 *
 * **To run:** drop this file into `apps/core/src/services/`, then
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgres://... \
 *     pnpm --filter core test .postgres.test.ts --no-file-parallelism
 *
 * **What `047dd43d8` fixed and what it left.** That commit replaced a chunk
 * budget with a document budget, so a corpus *under* 120 matching documents
 * now comes back whole — `REPRO-fts-document-drop` passes at this head, all
 * four cases. What it did not change is which documents survive the cut when
 * there are more than 120, and there it chose
 *
 *     ORDER BY rank DESC, resource_id ASC
 *
 * `FileResource.id` is `uuid(7)`, time-ordered, so `resource_id ASC` is
 * oldest-first. Whenever ranks tie, the documents dropped are the newest —
 * the same symptom, in the same direction, as the defect the commit is named
 * after.
 *
 * **Ranks tie as the normal case, not an edge case.** Measured on 130
 * documents of genuinely different prose — different lead and tail phrases,
 * 8 to 30 words of filler, the term at a different position in each, one
 * chunk apiece:
 *
 *   distinct ts_rank values across all 130 : 1
 *   documents sharing the top rank         : 130
 *   returned                               : 120
 *   truncated                              : true
 *   creation positions dropped             : [121..130]
 *
 * `ts_rank` with no normalization flag does not divide by document length,
 * and for a one-occurrence single-term match the value is the same constant
 * whatever the document. So for any single-term query, `rank DESC` sorts
 * nothing and `resource_id ASC` decides the whole order. A two-term query has
 * as many distinct ranks as there are match-count buckets — measured at 2
 * over 5 documents — so ties still decide the cut inside the largest bucket.
 *
 * **Nothing else can rescue the dropped documents.** For a text query
 * `retrieveFileCandidates` runs the exact-name, full-text and metadata legs;
 * the browse leg is an early return on the no-query path. A document that
 * matches only on chunk text and is cut here does not appear at all.
 *
 * **The ordering is unpinned.** Replacing `ORDER BY rank DESC, resource_id
 * ASC` with `ORDER BY resource_id ASC` leaves all 396 Files unit tests and
 * all 113 Postgres tests green at this head. That is consistent with the
 * measurement above rather than a separate complaint: with ranks tied the
 * rank term is unobservable, so the expensive global sort that establishes it
 * decides nothing.
 *
 * **Asserted as a direction, not as a tiebreak.** The test does not require
 * `resource_id DESC` or any other clause. It requires that when a cut has to
 * happen among documents the ranking cannot separate, a reader's most recent
 * uploads are not the ones that disappear. `truncated` is already true here
 * and is not the subject: it says something was cut, not that what was cut
 * was everything new.
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
/** In chunk text and in no filename, so only the full-text leg matches it. */
const TERM = "zarquon";
/** Ten past the budget, so exactly ten documents have to lose. */
const SEEDED = CANDIDATE_BUDGET_FTS_DOCUMENTS + 10;

let ownerId = "";
let workspaceId = "";
let scopeId = "";
const actor = {
  userId: "",
  organizationId: null,
  kind: "interactive" as const,
};
/** Creation order, which for `uuid(7)` is also id order. */
const ids: string[] = [];

/**
 * Ordinary prose that differs per document: different opening, different
 * closing, a different amount of filler, the term in a different place.
 * Deliberately not a template with only the number changed — the point is
 * that documents which genuinely differ still tie.
 */
function prose(d: number): string {
  const lead = [
    "quarterly review of regional operations",
    "notes from the supplier meeting",
    "draft policy on remote working",
    "summary of the incident and its handling",
    "background reading for the board",
    "an account of the migration weekend",
    "minutes, with actions assigned",
  ][d % 7];
  const tail = [
    "and the figures attached below",
    "pending confirmation from finance",
    "to be circulated before Friday",
    "with appendices removed for length",
    "superseding the earlier draft",
  ][d % 5];
  const filler = "context ".repeat(3 + (d % 23));
  return `${lead} ${filler}${TERM} ${tail} item ${d}`;
}

async function seedDoc(d: number): Promise<string> {
  const name = `prose-${String(d).padStart(3, "0")}.txt`;
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
  const text = prose(d);
  await prisma.$executeRaw(PrismaRaw.sql`
    INSERT INTO file_chunk (id,"createdAt","versionId","chunkId",ordinal,text,
      "evidenceScopeId","scopeVersion","inputDigest",search_vector)
    VALUES (gen_random_uuid(), now(), ${version.id}::uuid, 'c1', 1, ${text},
      ${scopeId}::uuid, 1, 'repro', to_tsvector('simple', ${text}))`);
  return resource.id;
}

describe.skipIf(!enabled)(
  "the full-text cut must not always fall on the newest documents",
  () => {
    let distinctRanks = 0;
    let returned = new Set<string>();
    let truncated = false;

    beforeAll(async () => {
      const owner = await prisma.user.create({
        data: {
          name: "FTS cut owner",
          email: `fts-cut-${suffix}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      ownerId = owner.id;
      actor.userId = owner.id;
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
      for (let d = 1; d <= SEEDED; d += 1) ids.push(await seedDoc(d));

      const result = await retrieveFileCandidates({
        workspaceId,
        actor,
        query: TERM,
        filters: {},
        sortBy: "relevance",
        sortOrder: "desc",
      });
      returned = new Set(result.candidates.map((c) => c.resourceId));
      truncated = result.truncated;

      const spread = await prisma.$queryRaw<{ n: bigint }[]>(PrismaRaw.sql`
        SELECT COUNT(DISTINCT ts_rank(fc.search_vector,
                 websearch_to_tsquery('simple', ${TERM}))) AS n
        FROM file_chunk fc
        JOIN file_version fv ON fv.id = fc."versionId"
        JOIN file_resource fr ON fr.id = fv."resourceId"
        WHERE fr."workspaceId" = ${workspaceId}::uuid`);
      distinctRanks = Number(spread[0].n);
    }, 600_000);

    afterAll(async () => {
      if (!enabled) return;
      await prisma.fileResource.deleteMany({ where: { workspaceId } });
      await prisma.fileEvidenceScope.deleteMany({ where: { workspaceId } });
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
      await prisma.user.deleteMany({ where: { id: ownerId } });
    });

    /**
     * The premise, and the part worth reading before the failure below: the
     * ranking has nothing to order these documents by. If a future change
     * gives `ts_rank` a spread here, this case fails and the fixture, not
     * the product, is what needs revisiting.
     */
    it("1. the ranking cannot separate these documents at all", () => {
      expect(
        distinctRanks,
        `${distinctRanks} distinct ts_rank values across ${SEEDED} documents ` +
          "of different prose. If this is greater than 1 the cut is being " +
          "decided by rank and case 2 is not measuring the tiebreak.",
      ).toBe(1);
      expect(returned.size).toBe(CANDIDATE_BUDGET_FTS_DOCUMENTS);
      expect(truncated, "nothing was cut, so there is nothing to test").toBe(
        true,
      );
    });

    /**
     * FAILS TODAY. Measured: the ten dropped are creation positions
     * [121..130] — the ten newest, exactly.
     */
    it("2. the documents dropped are not simply the newest ten", () => {
      const dropped = ids
        .map((id, index) => (returned.has(id) ? null : index + 1))
        .filter((position): position is number => position !== null);
      const newestTen = Array.from(
        { length: SEEDED - CANDIDATE_BUDGET_FTS_DOCUMENTS },
        (_unused, offset) => CANDIDATE_BUDGET_FTS_DOCUMENTS + offset + 1,
      );

      expect(
        dropped,
        "every document the cut dropped is one of the most recent uploads, " +
          "by creation position. `ORDER BY rank DESC, resource_id ASC` in " +
          "the `best` CTE orders by a rank that is identical for all of " +
          "them, so the tiebreak decides, and `uuid(7)` ascending is " +
          "oldest-first. A reader cannot find the file they uploaded this " +
          `morning and nothing says why. Dropped: ${JSON.stringify(dropped)}`,
      ).not.toEqual(newestTen);
    });
  },
);
