import { randomUUID } from "node:crypto";

import {
  FileResourceLifecycle,
  FileSourceKind,
  FileSourceScope,
} from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import prisma from "@/lib/db/prisma";
import type { FileActor } from "@/lib/files/actor";
import { ensureEvidenceScope } from "@/lib/files/evidence-scope";
import {
  CANDIDATE_BUDGET_FTS_DOCUMENTS,
  retrieveFileCandidates,
} from "@/lib/files/retrieval";

/**
 * The recency tiebreak, at each of the two places it is written.
 *
 * ## Why this exists next to two reviewer artifacts that look like it
 *
 * `fts-cut-drops-newest.postgres.test.ts` and
 * `relevance-order-is-oldest-first.postgres.test.ts` already cover this
 * ground and are not duplicated here — do not delete this file as
 * redundant. They catch the *combined* flip and nothing less. Measured,
 * on all three states:
 *
 *   both sites  -> ASC   3 of their 9 cases go red
 *   inner only  -> ASC   all 9 stay green
 *   outer only  -> ASC   all 9 stay green
 *
 * So either site can regress on its own and every existing guard passes.
 *
 * ## Why the two mask each other
 *
 * `retrieval.ts` orders by the tiebreak twice, and they do different
 * jobs. The inner one, inside the `best` CTE, decides *which* documents
 * survive `LIMIT CANDIDATE_BUDGET_FTS_DOCUMENTS + 1` — it is the cut. The
 * outer one re-sorts the survivors, and because RRF scores by position
 * every fused score is distinct, so the recency tiebreak in
 * `orderFusedCandidates` never fires and the fused order is this order —
 * it is what the reader sees.
 *
 * Flip the inner one alone and the outer `DESC` re-sorts the surviving
 * rows, so the dropped set stops being exactly the newest ten and an
 * assertion of the form "the dropped are not the newest ten" is satisfied
 * — for a reason it did not intend. A negative assertion passing by
 * accident is the defect class this branch has spent its length on.
 *
 * ## What separates them
 *
 * Set identity over the survivors, because all three states return
 * different sets. With 130 documents and a budget of 120:
 *
 *   correct      positions  11..130   the newest 120
 *   inner -> ASC positions   2..121   the cut took the oldest, then the
 *                                      outer sort kept the newest of those
 *   outer -> ASC positions  10..129   the cut took the newest 121, then
 *                                      the slice kept the oldest 120 of them
 *
 * A count cannot tell those apart; all three are 120. Identity can.
 *
 * Ordering by `ts_rank` sorts nothing here, which is the premise and is
 * asserted: called without a normalization flag it does not divide by
 * document length, so a one-occurrence single-term match scores the same
 * constant in every document. The tiebreak is then the only thing
 * ordering the result, which is the ordinary case for a single-term
 * query rather than a contrived one.
 */

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const suffix = randomUUID().slice(0, 8);
/** In chunk text and in no filename, so only the full-text leg matches. */
const TERM = "brancaster";
/** Ten past the budget, so exactly ten documents have to lose. */
const SEEDED = CANDIDATE_BUDGET_FTS_DOCUMENTS + 10;

let ownerId = "";
let workspaceId = "";
let scopeId = "";
/** Creation order, which for `uuid(7)` is also id order. */
const ids: string[] = [];

function actor(): FileActor {
  return { userId: ownerId, organizationId: null, kind: "interactive" };
}

/** Prose that genuinely differs per document, and still ties on rank. */
function prose(d: number): string {
  const lead = [
    "handover notes for the regional desk",
    "a short account of the outage",
    "supplier correspondence, redacted",
    "planning input for the next cycle",
    "observations from the site visit",
  ][d % 5];
  const filler = "detail ".repeat(4 + (d % 19));
  return `${lead} ${filler}${TERM} entry ${d}`;
}

async function seedDoc(d: number): Promise<string> {
  // The term must appear in no filename, or the exact-name and metadata
  // legs match too and fusion reorders what the full-text leg returned —
  // which is a different query shape than the one under test. Caught by
  // running it: with the term in the name the page came back reordered
  // and the mutation below failed for the wrong reason.
  const name = `document-${String(d).padStart(3, "0")}.txt`;
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
      ${scopeId}::uuid, 1, 'tiebreak', to_tsvector('simple', ${text}))`);
  return resource.id;
}

/** Creation positions, 1-based, in the order the query returned them. */
function positionsOf(resourceIds: string[]): number[] {
  return resourceIds.map((id) => ids.indexOf(id) + 1);
}

describe.skipIf(!enabled)(
  "both tiebreak sites in the full-text leg are load-bearing",
  () => {
    let distinctRanks = 0;
    let returnedOrder: number[] = [];
    let truncated = false;

    beforeAll(async () => {
      const owner = await prisma.user.create({
        data: {
          name: "Tiebreak owner",
          email: `tiebreak-${suffix}@example.test`,
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

      for (let d = 1; d <= SEEDED; d += 1) ids.push(await seedDoc(d));

      const result = await retrieveFileCandidates({
        workspaceId,
        actor: actor(),
        query: TERM,
        filters: {},
        sortBy: "relevance",
        sortOrder: "desc",
      });
      returnedOrder = positionsOf(
        result.candidates.map((candidate) => candidate.resourceId),
      );
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
     * The premise. If rank ever gains a spread here the tiebreak stops
     * being the only thing ordering the result, and the two cases below
     * would be measuring something else. The fixture, not the product,
     * is what would need revisiting.
     */
    it("1. rank cannot separate these documents at all", () => {
      expect(
        distinctRanks,
        `${distinctRanks} distinct ts_rank values across ${SEEDED} ` +
          "documents of differing prose; the tiebreak is no longer the " +
          "only thing deciding the order",
      ).toBe(1);
      expect(returnedOrder).toHaveLength(CANDIDATE_BUDGET_FTS_DOCUMENTS);
      expect(truncated, "nothing was cut, so there is nothing to test").toBe(
        true,
      );
    });

    /**
     * The inner site, `ORDER BY rank DESC, resource_id DESC` inside the
     * `best` CTE, which decides which documents survive the cut.
     *
     * Asserted as the set that survived, not as the set that was dropped.
     * "The dropped are not the newest ten" passes when the inner site
     * alone is flipped, because the outer sort rearranges the survivors
     * and the dropped set becomes {1} plus {122..130} — not the newest
     * ten, and not right either.
     */
    it("2. the survivors are exactly the newest documents", () => {
      const survivors = [...returnedOrder].sort((a, b) => a - b);
      const newest = Array.from(
        { length: CANDIDATE_BUDGET_FTS_DOCUMENTS },
        (_unused, index) => SEEDED - CANDIDATE_BUDGET_FTS_DOCUMENTS + index + 1,
      );

      expect(
        survivors,
        "the cut kept a different set of documents than the newest " +
          `${CANDIDATE_BUDGET_FTS_DOCUMENTS}. A reader cannot find the file ` +
          `they uploaded this morning. Survivors: ${JSON.stringify(survivors.slice(0, 6))}…`,
      ).toEqual(newest);
    });

    /**
     * The outer site, `ORDER BY best.rank DESC, best.resource_id DESC`,
     * which is the order fusion consumes and therefore the order the
     * reader sees.
     *
     * Separate from the case above because the two mask each other: the
     * survivor set alone does not say what order they arrived in, and a
     * page of the right documents in upload order is still a relevance
     * page that is not sorted by anything relevant.
     */
    it("3. the survivors arrive newest first", () => {
      const descending = [...returnedOrder].sort((a, b) => b - a);

      expect(
        returnedOrder,
        "the page is in ascending upload order under a heading that says " +
          `relevance. First six: ${JSON.stringify(returnedOrder.slice(0, 6))}`,
      ).toEqual(descending);
      expect(returnedOrder[0]).toBe(SEEDED);
    });
  },
);
