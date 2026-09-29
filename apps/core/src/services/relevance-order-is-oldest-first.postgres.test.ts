/**
 * REPRODUCTION ARTIFACT — for a single-term query, the relevance order the
 * reader sees is oldest-upload-first, and the response calls it relevance.
 *
 * Written by the reviewer, not the implementer. Red at `9b23197fb`.
 *
 * **To run:** drop this file into `apps/core/src/services/`, then
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgres://... \
 *     pnpm --filter core test .postgres.test.ts --no-file-parallelism
 *
 * **This is the order, where B-1 is the cut.** `REPRO-fts-cut-drops-newest`
 * shows that unnormalized `ts_rank` yields one distinct value across 130
 * varied documents, so `ORDER BY rank DESC, resource_id ASC` in the `best`
 * CTE is decided entirely by the `uuid(7)` tiebreak, which is oldest-first.
 * That artifact draws the consequence for which documents survive the cut at
 * 120. This one draws it for the order of the ones that do.
 *
 * The chain, traced and then measured:
 *
 * 1. `ftsPage` arrives in `resource_id ASC` order.
 * 2. Each row contributes `1 / (RRF_K + index + 1)` to `fusedScore`, so the
 *    fused scores are strictly decreasing in that index — every one distinct.
 * 3. `orderFusedCandidates` sorts by `fusedScore DESC`, then `updatedAt DESC`,
 *    then id. The recency tiebreak is exactly the right intent and it never
 *    fires, because step 2 leaves no two scores equal. The fused order is the
 *    SQL order.
 * 4. `rerankFileCandidates` returns `input.candidates` untouched on every
 *    deterministic path, and on the model path returns
 *    `[...protectedHead, ...reordered, ...tail]` where
 *    `head = rankable.slice(0, SEARCH_RERANK_CANDIDATES)` — six.
 *
 * **Measured at `9b23197fb`**, 130 documents of varied prose, one matching
 * chunk each, `limit: 20`, reporting creation positions:
 *
 *   model off : rankingMode "deterministic", fallback "disabled"
 *               [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]
 *   model on  : rankingMode "model", fallback null
 *               [2,4,5,1,3,6, 7,8,9,10,11,12,13,14,15,16,17,18,19,20]
 *
 * So with the model off the page is the twenty oldest matching documents in
 * ascending upload order. With the model on, the model permutes the six
 * oldest and everything from position seven is still ascending upload order.
 *
 * **One change closes both this and B-1.** Measured with `resource_id ASC`
 * flipped to `resource_id DESC` in both `ORDER BY` clauses of the full-text
 * leg, nothing else touched:
 *
 *   model off : [130,129,128,...,111]
 *   model on  : [129,127,125,130,128,126,124,123,...,111]
 *
 * That is not offered as the fix to adopt — it is here because it means this
 * finding probably needs no separate change, only its own evidence.
 *
 * **Deliberately asserted as "not ascending by upload", not as an ordering.**
 * Any tiebreak that is not oldest-first satisfies this, and so does a change
 * that gives `ts_rank` a real spread. Case 3 does not object to
 * `SEARCH_RERANK_CANDIDATES` being six — that is a cost decision. It objects
 * to the fourteen positions the model never sees being in upload order under
 * a heading that says the model ranked them.
 */
import { randomUUID } from "node:crypto";
import {
  FileResourceLifecycle,
  FileSourceKind,
  FileSourceScope,
} from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { env } = vi.hoisted(() => ({
  env: {
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
    AI_GATEWAY_API_KEY: "test-key" as string | undefined,
    FILES_JEV_ENABLED: true,
    INSTANCE_ID: "instance-under-test",
    BETTER_AUTH_SECRET: "cursor-signing-secret",
    BLOB_READ_WRITE_TOKEN: undefined as string | undefined,
  },
}));
vi.mock("@/config/env", () => ({ getEnv: () => env }));
vi.mock("@sentry/node", () => ({
  captureMessage: () => {},
  captureException: () => {},
}));

import prisma from "@/lib/db/prisma";
import { ensureEvidenceScope } from "@/lib/files/evidence-scope";
import { SEARCH_RERANK_CANDIDATES } from "@/lib/files/jev-ranking";
import { resetJevScheduler } from "@/lib/files/jev-scheduler";
import { searchFiles } from "@/services/file-search.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const TERM = "zarquon";
const SEEDED = 130;
const PAGE = 20;
const suffix = randomUUID().slice(0, 8);

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

/** Prose that genuinely differs per document. See B-1 for why that matters. */
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
  return `${lead} ${"context ".repeat(3 + (d % 23))}${TERM} ${tail} item ${d}`;
}

let call = 0;

/**
 * A healthy Jev reply that actually reorders. Every rung inside one call is
 * answered the same way, so the ladder stays monotone and `readLadder`
 * accepts it; the answer alternates between calls so the model produces a
 * real permutation rather than a uniform verdict.
 */
function installFetch() {
  call = 0;
  vi.stubGlobal("fetch", async (_url: string, init: { body?: string }) => {
    const body = JSON.parse(init.body ?? "{}") as {
      questions: Record<string, unknown>;
    };
    call += 1;
    const probability = call % 2 === 0 ? 0.95 : 0.05;
    const answers: Record<string, unknown> = {};
    for (const id of Object.keys(body.questions)) {
      answers[id] = { type: "boolean", probability };
    }
    return new Response(
      JSON.stringify({
        model: "typesafe-ai/jev",
        answers,
        usage: { inputTokens: 10, outputTokens: 2 },
        providerMetadata: { gateway: { cost: "0.0001", generationId: "g" } },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
}

interface Page {
  rankingMode: string;
  rankingFallback: string | null;
  positions: number[];
}

async function firstPage(): Promise<Page> {
  const position = new Map(ids.map((id, index) => [id, index + 1]));
  await prisma.fileResultWindow.deleteMany({ where: { workspaceId } });
  const page = await searchFiles({
    workspaceId,
    actor,
    query: TERM,
    filters: {},
    sortBy: "relevance",
    sortOrder: "desc",
    cursor: null,
    limit: PAGE,
  });
  return {
    rankingMode: page.search.rankingMode,
    rankingFallback: page.search.rankingFallback,
    positions: page.items.map((item) => position.get(item.id) ?? -1),
  };
}

describe.skipIf(!enabled)(
  "a relevance page must not simply be the oldest uploads in order",
  () => {
    let distinctRanks = 0;
    let withoutModel: Page;
    let withModel: Page;

    beforeAll(async () => {
      const owner = await prisma.user.create({
        data: {
          name: "Relevance order owner",
          email: `order-${suffix}@example.test`,
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

      for (let d = 1; d <= SEEDED; d += 1) {
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
          INSERT INTO file_chunk (id,"createdAt","versionId","chunkId",ordinal,
            text,"evidenceScopeId","scopeVersion","inputDigest",search_vector)
          VALUES (gen_random_uuid(), now(), ${version.id}::uuid, 'c1', 1,
            ${text}, ${scopeId}::uuid, 1, 'repro',
            to_tsvector('simple', ${text}))`);
        ids.push(resource.id);
      }

      const spread = await prisma.$queryRaw<{ n: bigint }[]>(PrismaRaw.sql`
        SELECT COUNT(DISTINCT ts_rank(fc.search_vector,
                 websearch_to_tsquery('simple', ${TERM}))) AS n
        FROM file_chunk fc
        JOIN file_version fv ON fv.id = fc."versionId"
        JOIN file_resource fr ON fr.id = fv."resourceId"
        WHERE fr."workspaceId" = ${workspaceId}::uuid`);
      distinctRanks = Number(spread[0].n);

      resetJevScheduler();
      env.FILES_JEV_ENABLED = false;
      env.AI_GATEWAY_API_KEY = undefined;
      withoutModel = await firstPage();

      resetJevScheduler();
      env.FILES_JEV_ENABLED = true;
      env.AI_GATEWAY_API_KEY = "test-key";
      installFetch();
      withModel = await firstPage();
      vi.unstubAllGlobals();
    }, 900_000);

    afterAll(async () => {
      if (!enabled) return;
      vi.unstubAllGlobals();
      resetJevScheduler();
      await prisma.fileResource.deleteMany({ where: { workspaceId } });
      await prisma.fileResultWindow.deleteMany({ where: { workspaceId } });
      await prisma.fileAuthorizationAdmission.deleteMany({
        where: { workspaceId },
      });
      await prisma.fileEvidenceScope.deleteMany({ where: { workspaceId } });
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
      await prisma.user.deleteMany({ where: { id: ownerId } });
    });

    const ascending = (from: number, count: number) =>
      Array.from({ length: count }, (_unused, offset) => from + offset);

    /** The premise: there is no relevance signal to order these documents by. */
    it("1. the ranking cannot separate these documents at all", () => {
      expect(
        distinctRanks,
        "if this is greater than 1 the order is being decided by rank and " +
          "the cases below are not measuring the tiebreak",
      ).toBe(1);
      expect(withoutModel.rankingMode).toBe("deterministic");
      expect(
        withModel.rankingMode,
        `the model stage did not apply (fallback ${String(withModel.rankingFallback)}), ` +
          "so case 3 would pass for the wrong reason",
      ).toBe("model");
    });

    /**
     * FAILS TODAY. Measured: [1..20] — the twenty oldest matching documents,
     * in ascending upload order, reported as a relevance ordering.
     */
    it("2. with no model, a relevance page is not the oldest uploads in order", () => {
      expect(
        withoutModel.positions,
        "the page is the oldest matching documents in ascending upload " +
          'order. `rankingMode` says "deterministic" and ' +
          `\`rankingFallback\` says "${String(withoutModel.rankingFallback)}", ` +
          "neither of which tells the reader that the deterministic order " +
          "carries no relevance signal for this query. The recency tiebreak " +
          "in `orderFusedCandidates` cannot help: RRF gives every candidate " +
          "a distinct fused score, so it never fires. Positions: " +
          `${JSON.stringify(withoutModel.positions)}`,
      ).not.toEqual(ascending(1, PAGE));
    });

    /**
     * FAILS TODAY. Measured: the model permutes the six oldest and positions
     * seven onward are [7..20], ascending upload order, under
     * `rankingMode: "model"`.
     */
    it("3. with the model, the positions it never saw are not in upload order", () => {
      const tail = withModel.positions.slice(SEARCH_RERANK_CANDIDATES);

      expect(
        tail,
        `positions ${SEARCH_RERANK_CANDIDATES + 1}..${PAGE} of a page ` +
          'reported as rankingMode "model" are the next oldest uploads in ' +
          "ascending order. The model saw only " +
          `\`rankable.slice(0, ${SEARCH_RERANK_CANDIDATES})\`, and because ` +
          "the fused order is the SQL order, that head was the six oldest " +
          "matching documents. Whole page: " +
          `${JSON.stringify(withModel.positions)}`,
      ).not.toEqual(
        ascending(
          SEARCH_RERANK_CANDIDATES + 1,
          PAGE - SEARCH_RERANK_CANDIDATES,
        ),
      );
    });
  },
);
