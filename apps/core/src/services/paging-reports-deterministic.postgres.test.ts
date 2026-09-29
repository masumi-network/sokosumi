/**
 * REPRODUCTION ARTIFACT — page two of a model-ranked search reports that the
 * ranking was deterministic.
 *
 * Written by the reviewer, not the implementer. Red at `bbd037236`.
 *
 * **To run:** drop this file into `apps/core/src/services/`, then
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgres://... \
 *     pnpm --filter core test .postgres.test.ts --no-file-parallelism
 *
 * **The defect.** `file-search.service.ts` initialises
 * `rankingMode = "deterministic"` and assigns it only inside the
 * `if (!windowId)` branch that builds a fresh window. A cursor request loads
 * the window from `file_result_window` and never reaches that branch, so it
 * serves the model's order while reporting that no model was involved. The
 * window row carries the entries and not the mode, so nothing on the cursor
 * path can recompute it: the fix has to persist it beside the window.
 *
 * **Scoped to `rankingMode`, deliberately.** The reviewer's ruling was to
 * persist the mode *and* the fallback, and only the first half is asserted
 * here. `rankingFallback` has a defensible reading as it stands, and the code
 * states it: "A cursor page reuses a stored window and ranks nothing, so it
 * reports null rather than inventing a cause." Read as "what this page
 * attempted", null is true. `rankingMode` has no such reading — it describes
 * how the order being served was produced, and that order came from the model.
 * So this test asserts one thing only: that page two reports the same mode as
 * page one. Whether the fallback should also be carried across is a judgement
 * call the test stays out of, and a fix that carries both still passes.
 */
import { randomUUID } from "node:crypto";
import {
  FileResourceLifecycle,
  FileSourceKind,
  FileSourceScope,
} from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/config/env", () => ({
  getEnv: () => ({
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
    AI_GATEWAY_API_KEY: "test-key",
    FILES_JEV_ENABLED: true,
    INSTANCE_ID: "instance-under-test",
    BETTER_AUTH_SECRET: "cursor-signing-secret",
    BLOB_READ_WRITE_TOKEN: undefined,
  }),
}));
vi.mock("@sentry/node", () => ({
  captureMessage: () => {},
  captureException: () => {},
}));

import prisma from "@/lib/db/prisma";
import { ensureEvidenceScope } from "@/lib/files/evidence-scope";
import { resetJevScheduler } from "@/lib/files/jev-scheduler";
import { searchFiles } from "@/services/file-search.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const suffix = randomUUID().slice(0, 8);
const TERM = "zarquon";
let ownerId = "";
let workspaceId = "";

const actor = {
  userId: "",
  organizationId: null,
  kind: "interactive" as const,
};

/**
 * A healthy Jev reply. Every rung answered true, which is monotone, so
 * `readLadder` reads it as the top of the scale rather than refusing it.
 */
function installFetch() {
  vi.stubGlobal("fetch", async (_url: string, init: { body?: string }) => {
    const body = JSON.parse(init.body ?? "{}") as {
      questions: Record<string, unknown>;
    };
    const answers: Record<string, unknown> = {};
    for (const id of Object.keys(body.questions)) {
      answers[id] = { type: "boolean", probability: 0.99 };
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

async function seedDoc(name: string): Promise<void> {
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
  const scope = await ensureEvidenceScope({
    workspaceId,
    sourceKind: FileSourceKind.DRIVE_UPLOAD,
    sourceScope: FileSourceScope.USER,
    sourceId: ownerId,
  });
  const text = `passage mentioning ${TERM} in ${name}`;
  await prisma.$executeRaw(PrismaRaw.sql`
    INSERT INTO file_chunk (id,"createdAt","versionId","chunkId",ordinal,text,
      "evidenceScopeId","scopeVersion","inputDigest",search_vector)
    VALUES (gen_random_uuid(), now(), ${version.id}::uuid, 'c1', 1, ${text},
      ${scope.id}::uuid, 1, 'repro', to_tsvector('simple', ${text}))`);
}

describe.skipIf(!enabled)(
  "a paged search reports the ranking it actually served",
  () => {
    beforeAll(async () => {
      installFetch();
      const owner = await prisma.user.create({
        data: {
          name: "Paging owner",
          email: `paging-${suffix}@example.test`,
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
      for (let d = 1; d <= 25; d += 1) {
        await seedDoc(`page-${String(d).padStart(2, "0")}-${suffix}`);
      }
    }, 300_000);

    afterAll(async () => {
      vi.unstubAllGlobals();
      resetJevScheduler();
      await prisma.fileResource.deleteMany({ where: { workspaceId } });
      await prisma.fileResultWindow.deleteMany({ where: { workspaceId } });
      await prisma.fileEvidenceScope.deleteMany({ where: { workspaceId } });
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
      await prisma.user.deleteMany({ where: { id: ownerId } });
    });

    it("reports the same ranking mode on page two as on page one", async () => {
      resetJevScheduler();

      const first = await searchFiles({
        workspaceId,
        actor,
        query: TERM,
        filters: {},
        sortBy: "relevance",
        sortOrder: "desc",
        cursor: null,
        limit: 10,
      });

      // The premise: page one really was reranked and really has a page two.
      expect(
        first.search.rankingMode,
        "the model stage did not apply, so this test is not exercising the " +
          `defect. fallback: ${String(first.search.rankingFallback)}`,
      ).toBe("model");
      expect(first.search.nextCursor).not.toBeNull();

      const second = await searchFiles({
        workspaceId,
        actor,
        query: TERM,
        filters: {},
        sortBy: "relevance",
        sortOrder: "desc",
        cursor: first.search.nextCursor,
        limit: 10,
      });

      expect(
        second.search.rankingMode,
        `page one reported "${first.search.rankingMode}" and page two ` +
          `reported "${second.search.rankingMode}" for the same window. Both ` +
          "pages serve positions out of one stored order, and that order was " +
          "produced by the model; page two's field says it was not. For " +
          "reference and not as an assertion, `rankingFallback` reads " +
          `${String(second.search.rankingFallback)} on page two.`,
      ).toBe(first.search.rankingMode);
    }, 300_000);
  },
);
