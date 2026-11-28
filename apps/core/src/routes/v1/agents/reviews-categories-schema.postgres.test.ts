// Recorded on origin/main at 48866eb2b, with the same routes, seed and clock.
// RECORD_AGENT_CATALOG_PR2_BASE=true writes the public-layout recording.
import "@hono/zod-openapi";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { Hono } from "hono";
import type { Pool } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createPersonalWorkspace } from "@/helpers/personal-workspace";
import { createNetworkScope } from "@/lib/db/network-scope";
import { coreEvlogMiddleware } from "@/lib/evlog";
import { expectCoreLog } from "@/test/core-log";
import { observing, type Statement, statements } from "@/test/spend-comparison";
import { onSplitLayout } from "@/test/split-layout";
import {
  createApiKey,
  createCoreApp,
  createPasswordUser,
} from "@/test-fixtures/core-session";

/**
 * The file's own copy of the migrated database, made before Core's modules
 * load and open their pool: the comparison reads every Agent rate, so a rate
 * another file left in the worker's database would be one more than
 * recorded (the baseline below asserts there is none).
 */
const privateDatabase = await vi.hoisted(async () => {
  const source =
    process.env.POSTGRES_TEST_TEMPLATE_URL ?? process.env.DATABASE_URL;
  if (
    process.env.RUN_DATABASE_INTEGRATION_TESTS !== "true" ||
    !source?.startsWith("postgres")
  )
    return undefined;
  const { copyPostgresTestDatabase } = await import(
    "@/test/postgres-database-copy"
  );
  const copy = await copyPostgresTestDatabase(source, "catalog_test");
  vi.stubEnv("DATABASE_URL", copy.url);
  vi.stubEnv("DATABASE_URL_UNPOOLED", copy.url);
  return copy;
});

const state = vi.hoisted(() => ({
  network: "Mainnet" as "Mainnet" | "Preprod",
  preprodEnabled: false,
  pools: [] as Pool[],
  work: [] as Promise<unknown>[],
  sellerCalls: [] as { id: string; name: string; apiBaseUrl: string }[],
}));

vi.mock("@/config/env", async (load) => {
  const actual = await load<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      NETWORK: state.network,
      NETWORK_PREPROD_ENABLED: state.preprodEnabled,
    }),
  };
});

vi.mock("@sokosumi/masumi", async (load) => {
  const actual = await load<typeof import("@sokosumi/masumi")>();
  const { ok } = await import("neverthrow");
  return {
    ...actual,
    createAgentClient: () => ({
      fetchAgentInputSchema: async (agent: {
        id: string;
        name: string;
        apiBaseUrl: string;
      }) => {
        state.sellerCalls.push({
          id: agent.id,
          name: agent.name,
          apiBaseUrl: agent.apiBaseUrl,
        });
        return ok({
          input_data: [
            {
              id: "prompt",
              type: "string" as const,
              name: `Prompt for ${agent.apiBaseUrl}`,
            },
          ],
        });
      },
    }),
  };
});

vi.mock("@vercel/functions", async (load) => {
  const actual = await load<typeof import("@vercel/functions")>();
  const { observePool } = await import("@/test/spend-comparison");
  return {
    ...actual,
    waitUntil: (work: Promise<unknown>) => state.work.push(work),
    attachDatabasePool: (pool: Pool) => {
      state.pools.push(pool);
      observePool(pool);
      actual.attachDatabasePool(pool);
    },
  };
});

afterAll(async () => {
  try {
    await Promise.all(state.pools.map((pool) => pool.end()));
  } finally {
    vi.unstubAllEnvs();
    await privateDatabase?.drop();
  }
});

const createClock = new Date("2026-11-27T12:00:00.000Z");
const updateClock = new Date("2026-11-27T12:10:00.000Z");
const agentTime = new Date("2026-11-25T01:02:03.456Z");
const reviewTime1 = new Date("2026-11-26T08:00:00.000Z");
const reviewTime2 = new Date("2026-11-26T09:00:00.000Z");
const reviewTime3 = new Date("2026-11-26T10:00:00.000Z");
const reviewTime4 = new Date("2026-11-26T11:00:00.000Z");
const reviewTime5 = new Date("2026-11-26T11:30:00.000Z");
const v2Policy = "a".repeat(56);
const v2Address = "addr_test1_pr2_v2_contract";
const readinessKey = "cardano-v2-rail-readiness";
const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";
const recording = process.env.RECORD_AGENT_CATALOG_PR2_BASE === "true";

function replaceLabels(text: string, labels: ReadonlyMap<string, string>) {
  let out = text;
  for (const [raw, label] of [...labels].sort(
    ([a], [b]) => b.length - a.length,
  )) {
    out = out.replaceAll(raw, label);
  }
  return out;
}

function labelValues(
  values: unknown[],
  labels: ReadonlyMap<string, string>,
): unknown[] {
  return JSON.parse(
    replaceLabels(
      JSON.stringify(values, (_k, v) =>
        typeof v === "bigint" ? v.toString() : v,
      ),
      labels,
    ),
  ) as unknown[];
}

/*
 * Two exact SQL differences between origin/main (single-schema default client)
 * and the Network-scoped implementation:
 * 1. Inside POST /ratings's Network transaction, shared `sync_metadata` cannot
 *    be read with a NetworkDb delegate on the split layout; it runs as one
 *    qualified raw SELECT on the same transaction connection.
 * 2. Separating the cross-schema `UserAgentRating -> user` include skips
 *    Prisma's redundant `WHERE "user"."id" IN (NULL)` when an agent has zero
 *    commented reviews.
 */
const BASE_TX_READINESS_SQL =
  'SELECT "public"."sync_metadata"."id", "public"."sync_metadata"."key", "public"."sync_metadata"."lastSyncedAt", "public"."sync_metadata"."cursorId", "public"."sync_metadata"."updatedAt", "public"."sync_metadata"."createdAt" FROM "public"."sync_metadata" WHERE ("public"."sync_metadata"."key" = $1 AND 1=1) LIMIT $2 OFFSET $3';
const HEAD_TX_READINESS_SQL =
  'SELECT "cursorId" FROM "public"."sync_metadata" WHERE "key" = $1 LIMIT 1';
const BASE_EMPTY_USER_INCLUDE_SQL =
  'SELECT "public"."user"."id", "public"."user"."name", "public"."user"."image" FROM "public"."user" WHERE "public"."user"."id" IN (NULL) OFFSET $1';

interface RecordedSnapshot {
  sql: string[];
  results: {
    status: number;
    body: string;
    row?: unknown;
    count: number;
    transactions: [number, unknown[]][][];
    outside: [number, number][];
  }[];
  calls: Record<string, number>;
}

function expandRecorded(snapshot: RecordedSnapshot) {
  const expanded: Record<
    string,
    {
      status: number;
      body: string;
      row?: unknown;
      count: number;
      transactions: [string, unknown[]][][];
      outside: Record<string, number>;
    }
  > = {};
  for (const [callKey, index] of Object.entries(snapshot.calls)) {
    const entry = snapshot.results[index];
    if (!entry) throw new Error(`Missing recorded entry ${index}`);
    expanded[callKey] = {
      status: entry.status,
      body: entry.body,
      ...(entry.row === undefined ? {} : { row: entry.row }),
      count: entry.count,
      transactions: entry.transactions.map((tx) =>
        tx.map(([sqlIndex, values]) => [snapshot.sql[sqlIndex] ?? "", values]),
      ),
      outside: Object.fromEntries(
        entry.outside.map(([sqlIndex, count]) => [
          snapshot.sql[sqlIndex] ?? "",
          count,
        ]),
      ),
    };
  }
  return expanded;
}

function expectedFromBase(base: RecordedSnapshot) {
  const expanded = expandRecorded(base);
  for (const entry of Object.values(expanded)) {
    entry.transactions = entry.transactions.map((tx) =>
      tx.map(([statementSql, values]) => {
        if (statementSql !== BASE_TX_READINESS_SQL) {
          return [statementSql, values];
        }
        expect(values).toEqual([values[0], "1", "0"]);
        return [HEAD_TX_READINESS_SQL, [values[0]]];
      }),
    );
    if (entry.outside[BASE_EMPTY_USER_INCLUDE_SQL] === 1) {
      delete entry.outside[BASE_EMPTY_USER_INCLUDE_SQL];
      entry.count -= 1;
    }
  }
  return expanded;
}

it.skipIf(!enabled).each(["Mainnet", "Preprod"] as const)(
  "preserves reviews, ratings, categories and input schema with deployment NETWORK=%s",
  async (network) => {
    state.network = network;
    state.preprodEnabled = false;
    state.sellerCalls = [];
    const scope = createNetworkScope("mainnet");
    const shared = scope.sharedDb;
    const app = new Hono();
    app.use(coreEvlogMiddleware());
    app.use(async (c, next) => {
      c.set("requestId", "catalog-pr2-request");
      await next();
    });
    app.route("/", createCoreApp());

    const run = randomUUID().slice(0, 8);
    // Snapshot baseline state before any setup writes.
    const previousReadiness = await shared.syncMetadata.findUnique({
      where: { key: readinessKey },
    });
    const baselineRates = await scope.networkDb.creditCost.findMany({
      select: { id: true },
    });
    expect(baselineRates).toEqual([]);

    const createdUserIds: string[] = [];
    const createdAgentIds: string[] = [];
    const createdPricingIds: string[] = [];
    const createdFixedPricingIds: string[] = [];
    const createdCategoryIds: string[] = [];
    const createdRatingIds: string[] = [];
    const createdJobIds: string[] = [];
    const createdRateIds: string[] = [];
    const labels = new Map<string, string>();
    labels.set(run, "<run>");

    const sql: string[] = [];
    const results: string[] = [];
    const calls: Record<string, number> = {};
    function intern(table: string[], value: string) {
      const index = table.indexOf(value);
      return index === -1 ? table.push(value) - 1 : index;
    }

    async function makeAuthor(label: string, image?: string) {
      const id = randomUUID();
      await shared.user.create({
        data: {
          id,
          name: `PR2 ${label} ${run}`,
          email: `${id}@example.test`,
          emailVerified: true,
          termsAccepted: true,
          image: image ?? null,
          createdAt: agentTime,
          updatedAt: agentTime,
        },
      });
      createdUserIds.push(id);
      labels.set(id, `<user-${label}>`);
      return { id };
    }

    async function makeUser(label: string) {
      const user = await createPasswordUser(`PR2 ${label} ${run}`);
      createdUserIds.push(user.id);
      labels.set(user.id, `<user-${label}>`);
      const ws = await createPersonalWorkspace(user.id);
      labels.set(ws.id, `<ws-${label}>`);
      const token = await createApiKey(user.id);
      const keys = await shared.apikey.findMany({
        where: { referenceId: user.id },
        select: { id: true, key: true },
      });
      for (const k of keys) {
        labels.set(k.id, `<apikey-${label}>`);
        labels.set(k.key, `<apikey-hash-${label}>`);
      }
      return { id: user.id, workspaceId: ws.id, token };
    }

    try {
      const eligible = await makeUser("eligible");
      const ineligible = await makeUser("ineligible");
      const reviewer1 = await makeAuthor("reviewer-1", "ipfs://bafyreviewer1");
      const reviewer2 = await makeAuthor(
        "reviewer-2",
        "https://example.com/r2.png",
      );
      const reviewer3 = await makeAuthor("reviewer-3");
      const hiddenReviewer = await makeUser("reviewer-hidden");

      const agentAvailId = randomUUID();
      const agentV2Id = randomUUID();
      const agentHiddenId = randomUUID();
      const agentNoEndpointId = randomUUID();
      const agentMissingId = randomUUID();
      labels.set(agentAvailId, "<agent-avail>");
      labels.set(agentV2Id, "<agent-v2>");
      labels.set(agentHiddenId, "<agent-hidden>");
      labels.set(agentNoEndpointId, "<agent-no-endpoint>");
      labels.set(agentMissingId, "<agent-missing>");

      const catP0AlphaId = randomUUID();
      const catP0BetaId = randomUUID();
      const catP1AlphaId = randomUUID();
      const catHiddenOnlyId = randomUUID();
      labels.set(catP0AlphaId, "<cat-p0-alpha>");
      labels.set(catP0BetaId, "<cat-p0-beta>");
      labels.set(catP1AlphaId, "<cat-p1-alpha>");
      labels.set(catHiddenOnlyId, "<cat-hidden-only>");

      const reviewOldestId = randomUUID();
      const reviewMiddleId = randomUUID();
      const reviewNewestId = randomUUID();
      const reviewHiddenId = randomUUID();
      const reviewNoCommentId = randomUUID();
      labels.set(reviewOldestId, "<review-oldest>");
      labels.set(reviewMiddleId, "<review-middle>");
      labels.set(reviewNewestId, "<review-newest>");
      labels.set(reviewHiddenId, "<review-hidden>");
      labels.set(reviewNoCommentId, "<review-no-comment>");

      const jobId = randomUUID();
      labels.set(jobId, "<job-finished>");

      await scope.netTransaction(async (tx) => {
        for (const cat of [
          {
            id: catP1AlphaId,
            name: `Alpha ${run}`,
            slug: `alpha-1-${run}`,
            priority: 1,
          },
          {
            id: catP0BetaId,
            name: `Beta ${run}`,
            slug: `beta-0-${run}`,
            priority: 0,
          },
          {
            id: catP0AlphaId,
            name: `Alpha ${run}`,
            slug: `alpha-0-${run}`,
            priority: 0,
          },
          {
            id: catHiddenOnlyId,
            name: `Aaa Hidden ${run}`,
            slug: `hidden-0-${run}`,
            priority: 0,
          },
        ]) {
          await tx.category.create({
            data: { ...cat, createdAt: agentTime, updatedAt: agentTime },
          });
          createdCategoryIds.push(cat.id);
        }

        const pAvail = randomUUID();
        const pV2 = randomUUID();
        const fpV2 = randomUUID();
        const pHidden = randomUUID();
        const pNoEp = randomUUID();
        createdPricingIds.push(pAvail, pV2, pHidden, pNoEp);
        createdFixedPricingIds.push(fpV2);

        await tx.agent.create({
          data: {
            id: agentAvailId,
            name: `Avail ${run}`,
            description: "Available fixture",
            blockchainIdentifier: `pr2-avail-${run}`,
            createdAt: agentTime,
            updatedAt: agentTime,
            lastUptimeCheck: agentTime,
            uptimeCount: 1,
            uptimeCheckCount: 1,
            isShown: true,
            status: "ONLINE",
            type: "STANDARD",
            paymentType: "NONE",
            apiBaseUrl: "https://agent.example.com",
            pricing: { create: { id: pAvail, pricingType: "FREE" } },
            categories: {
              connect: [{ id: catP0AlphaId }, { id: catP1AlphaId }],
            },
          },
        });
        createdAgentIds.push(agentAvailId);

        await tx.agent.create({
          data: {
            id: agentV2Id,
            name: `V2 ${run}`,
            description: "Cardano V2 fixture",
            blockchainIdentifier: `${v2Policy}${run}`,
            createdAt: agentTime,
            updatedAt: agentTime,
            lastUptimeCheck: agentTime,
            uptimeCount: 1,
            uptimeCheckCount: 1,
            isShown: true,
            status: "ONLINE",
            type: "STANDARD",
            paymentType: "WEB3_CARDANO_V2",
            apiBaseUrl: "https://v2.example.com",
            pricing: {
              create: {
                id: pV2,
                pricingType: "FIXED",
                fixedPricing: {
                  create: {
                    id: fpV2,
                    amounts: {
                      create: { unit: "lovelace", amount: 2n },
                    },
                  },
                },
              },
            },
            paymentSources: {
              create: {
                sourceIndex: 0,
                chain: "Cardano",
                network,
                paymentSourceType: "Web3CardanoV2",
                address: v2Address,
                pricingType: "FIXED",
              },
            },
            categories: { connect: [{ id: catP0BetaId }] },
          },
        });
        createdAgentIds.push(agentV2Id);

        await tx.agent.create({
          data: {
            id: agentHiddenId,
            name: `Hidden ${run}`,
            description: "Hidden override fixture",
            blockchainIdentifier: `pr2-hidden-${run}`,
            createdAt: agentTime,
            updatedAt: agentTime,
            lastUptimeCheck: agentTime,
            uptimeCount: 1,
            uptimeCheckCount: 1,
            isShown: false,
            status: "ONLINE",
            type: "STANDARD",
            paymentType: "NONE",
            apiBaseUrl: null,
            metadataOverride: {
              create: {
                apiBaseUrl: "https://override.example.com",
              },
            },
            pricing: { create: { id: pHidden, pricingType: "FREE" } },
            categories: { connect: [{ id: catHiddenOnlyId }] },
          },
        });
        createdAgentIds.push(agentHiddenId);

        await tx.agent.create({
          data: {
            id: agentNoEndpointId,
            name: `NoEndpoint ${run}`,
            description: "No endpoint fixture",
            blockchainIdentifier: `pr2-noep-${run}`,
            createdAt: agentTime,
            updatedAt: agentTime,
            lastUptimeCheck: agentTime,
            uptimeCount: 1,
            uptimeCheckCount: 1,
            isShown: true,
            status: "ONLINE",
            type: "STANDARD",
            paymentType: "NONE",
            apiBaseUrl: null,
            pricing: { create: { id: pNoEp, pricingType: "FREE" } },
          },
        });
        createdAgentIds.push(agentNoEndpointId);

        for (const r of [
          {
            id: reviewOldestId,
            userId: reviewer1.id,
            agentId: agentAvailId,
            rating: 3,
            comment: "Oldest comment",
            isHidden: false,
            createdAt: reviewTime1,
            updatedAt: reviewTime1,
          },
          {
            id: reviewMiddleId,
            userId: reviewer2.id,
            agentId: agentAvailId,
            rating: 4,
            comment: "Middle comment",
            isHidden: false,
            createdAt: reviewTime2,
            updatedAt: reviewTime2,
          },
          {
            id: reviewNewestId,
            userId: reviewer3.id,
            agentId: agentAvailId,
            rating: 5,
            comment: "Newest comment",
            isHidden: false,
            createdAt: reviewTime3,
            updatedAt: reviewTime3,
          },
          {
            id: reviewHiddenId,
            userId: hiddenReviewer.id,
            agentId: agentAvailId,
            rating: 1,
            comment: "Hidden comment",
            isHidden: true,
            createdAt: reviewTime4,
            updatedAt: reviewTime4,
          },
          {
            id: reviewNoCommentId,
            userId: ineligible.id,
            agentId: agentAvailId,
            rating: 2,
            comment: null,
            isHidden: false,
            createdAt: reviewTime5,
            updatedAt: reviewTime5,
          },
        ]) {
          await tx.userAgentRating.create({ data: r });
          createdRatingIds.push(r.id);
        }

        await tx.job.create({
          data: {
            id: jobId,
            ownerId: eligible.id,
            creatorUserId: eligible.id,
            workspaceId: eligible.workspaceId,
            agentId: agentAvailId,
            agentJobId: `agent-job-${run}`,
            jobType: "FREE",
            events: {
              create: {
                status: "COMPLETED",
                createdAt: agentTime,
                updatedAt: agentTime,
              },
            },
            purchase: {
              create: {
                externalId: `purchase-${run}`,
                onChainStatus: null,
              },
            },
          },
        });
        createdJobIds.push(jobId);
      }, "Fixture conflict");

      const readiness = {
        cursorId: JSON.stringify([
          { policyId: v2Policy, smartContractAddress: v2Address },
        ]),
        lastSyncedAt: agentTime,
      };
      await shared.syncMetadata.upsert({
        where: { key: readinessKey },
        create: { key: readinessKey, ...readiness },
        update: readiness,
      });

      // Warm auth/workspace rows before recording statement counts.
      for (const token of [
        eligible.token,
        ineligible.token,
        hiddenReviewer.token,
      ]) {
        for (let warm = 0; warm < 2; warm++) {
          await app.request("/v1/users/me", {
            headers: { authorization: `Bearer ${token}` },
          });
          await Promise.all(state.work.splice(0));
        }
      }

      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(createClock);

      function recordObservation(
        label: string,
        header: string,
        status: number,
        rawBody: string,
        log: readonly { connection: number; text: string; values: unknown[] }[],
        extra?: unknown,
      ) {
        expect(log.length, `${label}/${header} must run SQL`).toBeGreaterThan(
          0,
        );
        const grouped = statements(log);
        const record = {
          status,
          body: replaceLabels(rawBody, labels),
          ...(extra === undefined ? {} : { extra }),
          count: log.length,
          transactions: grouped.transactions.map((tx: Statement[]) =>
            tx.map((s) => [intern(sql, s.sql), labelValues(s.values, labels)]),
          ),
          outside: Object.entries(grouped.outsideTransactions).map(
            ([text, count]) => [intern(sql, text), count],
          ),
        };
        calls[`${label}/${header}`] = intern(results, JSON.stringify(record));
      }

      async function compare(
        label: string,
        path: string,
        options: {
          token?: string;
          method?: "GET" | "POST";
          jsonBody?: unknown;
          status?: number;
          checkRaw?: (parsed: unknown, header: string) => void;
        } = {},
      ) {
        const {
          token,
          method = "GET",
          jsonBody,
          status = 200,
          checkRaw,
        } = options;
        for (const header of ["absent", "mainnet"]) {
          const { outcome, log } = await observing(async () => {
            const response = await app.request(path, {
              method,
              headers: {
                ...(token && { authorization: `Bearer ${token}` }),
                ...(jsonBody !== undefined && {
                  "content-type": "application/json",
                }),
                ...(header === "mainnet" && { "X-Sokosumi-Network": header }),
              },
              ...(jsonBody !== undefined && {
                body: JSON.stringify(jsonBody),
              }),
            });
            const body = await response.text();
            await Promise.all(state.work.splice(0));
            return { status: response.status, body };
          });
          if ("threw" in outcome) {
            throw new Error(JSON.stringify(outcome.threw));
          }
          expect(outcome.status, `${label}/${header}`).toBe(status);
          if (checkRaw) {
            checkRaw(JSON.parse(outcome.body), header);
          }
          recordObservation(label, header, outcome.status, outcome.body, log);
        }
      }

      // 1. Empty rates: availability-gated routes 500; input-schema still 200.
      expectCoreLog("error", "A request failed with a server error", 10);
      await compare(
        "empty-rates/reviews",
        `/v1/agents/${agentAvailId}/reviews`,
        {
          token: eligible.token,
          status: 500,
        },
      );
      await compare(
        "empty-rates/reviews-me",
        `/v1/agents/${agentAvailId}/reviews/me`,
        { token: eligible.token, status: 500 },
      );
      await compare(
        "empty-rates/eligibility",
        `/v1/agents/${agentAvailId}/ratings/eligibility`,
        { token: eligible.token, status: 500 },
      );
      await compare(
        "empty-rates/rating-write",
        `/v1/agents/${agentAvailId}/ratings`,
        {
          token: eligible.token,
          method: "POST",
          jsonBody: { rating: 5, comment: "No rates yet" },
          status: 500,
        },
      );
      await compare("empty-rates/categories", "/v1/categories", {
        status: 500,
      });
      await compare(
        "empty-rates/input-schema",
        `/v1/agents/${agentAvailId}/input-schema`,
        { token: eligible.token, status: 200 },
      );

      // 2. Seed rate table and test all routes.
      const rateId = randomUUID();
      await scope.networkDb.creditCost.create({
        data: { id: rateId, unit: "lovelace", centsPerUnit: 10_000_000_000n },
      });
      createdRateIds.push(rateId);

      // Reviews: raw order with distinct times + distribution + IPFS avatar.
      await compare("reviews/available", `/v1/agents/${agentAvailId}/reviews`, {
        token: eligible.token,
        checkRaw: (parsed) => {
          const data = (
            parsed as {
              data: {
                distribution: Record<string, number>;
                ratingsWithComments: { id: string; createdAt: string }[];
              };
            }
          ).data;
          expect(data.distribution).toEqual({
            "1": 0,
            "2": 1,
            "3": 1,
            "4": 1,
            "5": 1,
          });
          expect(data.ratingsWithComments.map((r) => r.id)).toEqual([
            reviewNewestId,
            reviewMiddleId,
            reviewOldestId,
          ]);
          expect(data.ratingsWithComments.map((r) => r.createdAt)).toEqual([
            reviewTime3.toISOString(),
            reviewTime2.toISOString(),
            reviewTime1.toISOString(),
          ]);
        },
      });
      await compare(
        "reviews/limited",
        `/v1/agents/${agentAvailId}/reviews?limit=2`,
        {
          token: eligible.token,
          checkRaw: (parsed) => {
            const list = (
              parsed as { data: { ratingsWithComments: { id: string }[] } }
            ).data.ratingsWithComments;
            expect(list.map((r) => r.id)).toEqual([
              reviewNewestId,
              reviewMiddleId,
            ]);
          },
        },
      );
      await compare("reviews/v2-available", `/v1/agents/${agentV2Id}/reviews`, {
        token: eligible.token,
      });
      await compare(
        "reviews/unavailable",
        `/v1/agents/${agentHiddenId}/reviews`,
        { token: eligible.token, status: 404 },
      );

      // My review: hidden own review still visible, unrated returns null, unavailable 404.
      await compare(
        "reviews-me/hidden-own",
        `/v1/agents/${agentAvailId}/reviews/me`,
        { token: hiddenReviewer.token },
      );
      await compare(
        "reviews-me/none",
        `/v1/agents/${agentAvailId}/reviews/me`,
        {
          token: eligible.token,
        },
      );
      await compare(
        "reviews-me/unavailable",
        `/v1/agents/${agentHiddenId}/reviews/me`,
        { token: eligible.token, status: 404 },
      );

      // Eligibility: eligible true, ineligible false, unavailable 404.
      await compare(
        "eligibility/eligible",
        `/v1/agents/${agentAvailId}/ratings/eligibility`,
        { token: eligible.token },
      );
      await compare(
        "eligibility/ineligible",
        `/v1/agents/${agentAvailId}/ratings/eligibility`,
        { token: ineligible.token },
      );
      await compare(
        "eligibility/unavailable",
        `/v1/agents/${agentHiddenId}/ratings/eligibility`,
        { token: eligible.token, status: 404 },
      );

      // Rating write refusals.
      await compare(
        "rating-write/ineligible",
        `/v1/agents/${agentAvailId}/ratings`,
        {
          token: ineligible.token,
          method: "POST",
          jsonBody: { rating: 4, comment: "Not eligible" },
          status: 403,
        },
      );
      await compare(
        "rating-write/unavailable",
        `/v1/agents/${agentHiddenId}/ratings`,
        {
          token: eligible.token,
          method: "POST",
          jsonBody: { rating: 4, comment: "Hidden agent" },
          status: 404,
        },
      );

      // Rating write create + update: keep raw createdAt and updatedAt relations.
      for (const header of ["absent", "mainnet"]) {
        vi.setSystemTime(createClock);
        const createObs = await observing(async () => {
          const response = await app.request(
            `/v1/agents/${agentAvailId}/ratings`,
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${eligible.token}`,
                "content-type": "application/json",
                ...(header === "mainnet" && { "X-Sokosumi-Network": header }),
              },
              body: JSON.stringify({ rating: 4, comment: "Initial rating" }),
            },
          );
          const body = await response.text();
          await Promise.all(state.work.splice(0));
          return { status: response.status, body };
        });
        if ("threw" in createObs.outcome) {
          throw new Error(JSON.stringify(createObs.outcome.threw));
        }
        const createOutcome = createObs.outcome;
        expect(createOutcome.status).toBe(201);
        const createdRow = await scope.networkDb.userAgentRating.findUnique({
          where: {
            userId_agentId: { userId: eligible.id, agentId: agentAvailId },
          },
        });
        expect(createdRow).not.toBeNull();
        if (!createdRow) throw new Error("Expected created rating row");
        createdRatingIds.push(createdRow.id);
        expect(createdRow.updatedAt.toISOString()).toBe(
          createClock.toISOString(),
        );

        const upsertLabels = new Map(labels);
        upsertLabels.set(createdRow.id, "<upserted-rating>");
        expect(createdRow.createdAt.toISOString()).toBe(
          createClock.toISOString(),
        );

        // Update the same rating at a later timestamp: createdAt must stay, updatedAt must advance.
        vi.setSystemTime(updateClock);
        const updateObs = await observing(async () => {
          const response = await app.request(
            `/v1/agents/${agentAvailId}/ratings`,
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${eligible.token}`,
                "content-type": "application/json",
                ...(header === "mainnet" && { "X-Sokosumi-Network": header }),
              },
              body: JSON.stringify({ rating: 5, comment: "Updated rating" }),
            },
          );
          const body = await response.text();
          await Promise.all(state.work.splice(0));
          return { status: response.status, body };
        });
        if ("threw" in updateObs.outcome) {
          throw new Error(JSON.stringify(updateObs.outcome.threw));
        }
        const updateOutcome = updateObs.outcome;
        expect(updateOutcome.status).toBe(201);
        const updatedRow = await scope.networkDb.userAgentRating.findUnique({
          where: {
            userId_agentId: { userId: eligible.id, agentId: agentAvailId },
          },
        });
        expect(updatedRow).not.toBeNull();
        if (!updatedRow) throw new Error("Expected updated rating row");

        // Raw assertions before any normalization.
        expect(updatedRow.id).toBe(createdRow.id);
        expect(updatedRow.createdAt.toISOString()).toBe(
          createdRow.createdAt.toISOString(),
        );
        expect(updatedRow.updatedAt.toISOString()).toBe(
          updateClock.toISOString(),
        );
        expect(updatedRow.updatedAt.getTime()).toBeGreaterThan(
          createdRow.updatedAt.getTime(),
        );

        // Record both create and update with explicit upserted-row timestamps.
        for (const [label, obs, outcome, row] of [
          ["rating-write/create", createObs, createOutcome, createdRow],
          ["rating-write/update", updateObs, updateOutcome, updatedRow],
        ] as const) {
          expect(obs.log.length, `${label}/${header}`).toBeGreaterThan(0);
          const grouped = statements(obs.log);
          const record = {
            status: outcome.status,
            body: replaceLabels(outcome.body, upsertLabels),
            row: {
              id: replaceLabels(row.id, upsertLabels),
              rating: row.rating,
              comment: row.comment,
              createdAt: row.createdAt.toISOString(),
              updatedAt: row.updatedAt.toISOString(),
            },
            count: obs.log.length,
            transactions: grouped.transactions.map((tx: Statement[]) =>
              tx.map((s) => {
                const rawValues =
                  label === "rating-write/update" &&
                  s.sql.startsWith('INSERT INTO "public"."UserAgentRating"') &&
                  typeof s.values[0] === "string"
                    ? ["<upsert-candidate-id>", ...s.values.slice(1)]
                    : s.values;
                return [
                  intern(sql, s.sql),
                  labelValues(rawValues, upsertLabels),
                ];
              }),
            ),
            outside: Object.entries(grouped.outsideTransactions).map(
              ([text, count]) => [intern(sql, text), count],
            ),
          };
          calls[`${label}/${header}`] = intern(results, JSON.stringify(record));
        }

        // Remove the upserted row by remembered id so the next header starts identical.
        await scope.networkDb.userAgentRating.delete({
          where: { id: createdRow.id },
        });
        createdRatingIds.pop();
      }
      vi.setSystemTime(createClock);

      // Categories: public route, raw priority asc + name asc order, excludes hidden-only.
      await compare("categories/public", "/v1/categories", {
        checkRaw: (parsed) => {
          const list = (parsed as { data: { id: string }[] }).data;
          expect(list.map((c) => c.id)).toEqual([
            catP0AlphaId,
            catP0BetaId,
            catP1AlphaId,
          ]);
        },
      });

      // Input schema: available, hidden with override URL, no endpoint (422), missing (404).
      state.sellerCalls = [];
      await compare(
        "input-schema/available",
        `/v1/agents/${agentAvailId}/input-schema`,
        { token: eligible.token },
      );
      await compare(
        "input-schema/hidden-override",
        `/v1/agents/${agentHiddenId}/input-schema`,
        { token: eligible.token },
      );
      const callsBeforeErrors = state.sellerCalls.length;
      await compare(
        "input-schema/no-endpoint",
        `/v1/agents/${agentNoEndpointId}/input-schema`,
        { token: eligible.token, status: 422 },
      );
      await compare(
        "input-schema/missing",
        `/v1/agents/${agentMissingId}/input-schema`,
        { token: eligible.token, status: 404 },
      );
      expect(state.sellerCalls.length).toBe(callsBeforeErrors);

      const path = new URL(
        `./reviews-categories-schema-${network.toLowerCase()}.base.json`,
        import.meta.url,
      );
      const result = {
        sql,
        results: results.map((row) => JSON.parse(row)),
        calls,
      } as RecordedSnapshot;
      if (recording) {
        expect(onSplitLayout).toBe(false);
        writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);
      } else {
        const base = JSON.parse(readFileSync(path, "utf8")) as RecordedSnapshot;
        expect(expandRecorded(result)).toEqual(expectedFromBase(base));
      }

      // Allowed behaviour change: naming Preprod while Preprod is off returns
      // 403 preprod_off on every route before any catalog read or seller call.
      const sellerBeforeRefusal = state.sellerCalls.length;
      const catalogTablePattern =
        /"(Agent|CreditCost|Category|UserAgentRating|Job|sync_metadata)"/;
      for (const [label, path, opts] of [
        [
          "preprod-off/reviews",
          `/v1/agents/${agentAvailId}/reviews`,
          { token: eligible.token },
        ],
        [
          "preprod-off/reviews-me",
          `/v1/agents/${agentAvailId}/reviews/me`,
          { token: eligible.token },
        ],
        [
          "preprod-off/eligibility",
          `/v1/agents/${agentAvailId}/ratings/eligibility`,
          { token: eligible.token },
        ],
        [
          "preprod-off/rating-write",
          `/v1/agents/${agentAvailId}/ratings`,
          {
            token: eligible.token,
            method: "POST" as const,
            jsonBody: { rating: 5, comment: "Refused" },
          },
        ],
        ["preprod-off/categories", "/v1/categories", {}],
        [
          "preprod-off/input-schema",
          `/v1/agents/${agentAvailId}/input-schema`,
          { token: eligible.token },
        ],
      ] as const) {
        const obs = await observing(async () => {
          const response = await app.request(path, {
            method: "method" in opts ? opts.method : "GET",
            headers: {
              ...("token" in opts && opts.token
                ? { authorization: `Bearer ${opts.token}` }
                : {}),
              ...("jsonBody" in opts
                ? { "content-type": "application/json" }
                : {}),
              "X-Sokosumi-Network": "preprod",
            },
            ...("jsonBody" in opts
              ? { body: JSON.stringify(opts.jsonBody) }
              : {}),
          });
          const body = await response.text();
          await Promise.all(state.work.splice(0));
          return { status: response.status, body };
        });
        if ("threw" in obs.outcome) {
          throw new Error(JSON.stringify(obs.outcome.threw));
        }
        expect(obs.outcome.status, label).toBe(403);
        expect(JSON.parse(obs.outcome.body), label).toMatchObject({
          error: "Forbidden",
          kind: "preprod_off",
        });
        const catalogStatements = obs.log.filter((entry) =>
          catalogTablePattern.test(entry.text),
        );
        expect(
          catalogStatements,
          `${label} must send zero catalog SQL`,
        ).toEqual([]);
        if (label === "preprod-off/categories") {
          expect(obs.log, `${label} must send zero SQL`).toEqual([]);
        }
      }
      expect(state.sellerCalls.length).toBe(sellerBeforeRefusal);
    } finally {
      vi.useRealTimers();
      await scope.netTransaction(async (tx) => {
        if (createdRatingIds.length > 0) {
          await tx.userAgentRating.deleteMany({
            where: { id: { in: createdRatingIds } },
          });
        }
        if (createdJobIds.length > 0) {
          await tx.job.deleteMany({ where: { id: { in: createdJobIds } } });
        }
        if (createdAgentIds.length > 0) {
          await tx.agent.deleteMany({ where: { id: { in: createdAgentIds } } });
        }
        if (createdFixedPricingIds.length > 0) {
          await tx.agentFixedPricing.deleteMany({
            where: { id: { in: createdFixedPricingIds } },
          });
        }
        if (createdPricingIds.length > 0) {
          await tx.agentPricing.deleteMany({
            where: { id: { in: createdPricingIds } },
          });
        }
        if (createdCategoryIds.length > 0) {
          await tx.category.deleteMany({
            where: { id: { in: createdCategoryIds } },
          });
        }
        if (createdRateIds.length > 0) {
          await tx.creditCost.deleteMany({
            where: { id: { in: createdRateIds } },
          });
        }
      }, "Fixture conflict");
      if (createdJobIds.length > 0) {
        await shared.history.deleteMany({
          where: { entityId: { in: createdJobIds } },
        });
      }
      if (previousReadiness) {
        await shared.syncMetadata.update({
          where: { key: readinessKey },
          data: previousReadiness,
        });
      } else {
        await shared.syncMetadata.deleteMany({ where: { key: readinessKey } });
      }
      if (createdUserIds.length > 0) {
        await shared.apikey.deleteMany({
          where: { referenceId: { in: createdUserIds } },
        });
        await shared.subscription.deleteMany({
          where: { referenceId: { in: createdUserIds } },
        });
        await shared.user.deleteMany({
          where: { id: { in: createdUserIds } },
        });
      }
    }
  },
  60_000,
);

describe.runIf(enabled && onSplitLayout)(
  "Preprod scope isolation and refusals on the split layout",
  () => {
    it("serves Preprod reviews, ratings, categories and input schema on the Preprod schema and refuses unauthorized callers before any catalog read", async () => {
      state.network = "Mainnet";
      state.preprodEnabled = true;
      state.sellerCalls = [];

      const mainnet = createNetworkScope("mainnet");
      const preprod = createNetworkScope("preprod");
      const shared = preprod.sharedDb;
      const app = new Hono();
      app.use(coreEvlogMiddleware());
      app.use(async (c, next) => {
        c.set("requestId", "catalog-pr2-preprod");
        await next();
      });
      app.route("/", createCoreApp());

      const run = randomUUID().slice(0, 8);
      const preprodReadinessKey = `preprod:${readinessKey}`;
      const previousPreprodReadiness = await shared.syncMetadata.findUnique({
        where: { key: preprodReadinessKey },
      });
      const createdUserIds: string[] = [];
      const createdAgentIds: string[] = [];
      const createdPricingIds: string[] = [];
      const createdCategoryIds: string[] = [];
      const createdJobIds: string[] = [];
      const createdRatingIds: string[] = [];
      const createdRateIds: string[] = [];

      try {
        const optedIn = await createPasswordUser(`PR2 Preprod OptIn ${run}`);
        createdUserIds.push(optedIn.id);
        await shared.user.update({
          where: { id: optedIn.id },
          data: { preprodEnabled: true },
        });
        const optedInWs = await createPersonalWorkspace(optedIn.id);
        const preprodKey = await createApiKey(optedIn.id, "soko_preprod_");
        const mainnetKey = await createApiKey(optedIn.id, "soko_mainnet_");

        const plain = await createPasswordUser(`PR2 Preprod Plain ${run}`);
        createdUserIds.push(plain.id);
        await createPersonalWorkspace(plain.id);
        const plainKey = await createApiKey(plain.id, "soko_preprod_");

        const agentId = randomUUID();
        const pricingId = randomUUID();
        const categoryId = randomUUID();
        const jobId = randomUUID();
        const seededRatingId = randomUUID();
        createdAgentIds.push(agentId);
        createdPricingIds.push(pricingId);
        createdCategoryIds.push(categoryId);
        createdJobIds.push(jobId);
        createdRatingIds.push(seededRatingId);

        await preprod.netTransaction(async (tx) => {
          const existingRate = await tx.creditCost.findFirst({
            where: { unit: "lovelace" },
            select: { id: true },
          });
          if (!existingRate) {
            const rateId = randomUUID();
            await tx.creditCost.create({
              data: {
                id: rateId,
                unit: "lovelace",
                centsPerUnit: 10_000_000_000n,
              },
            });
            createdRateIds.push(rateId);
          }
          await tx.category.create({
            data: {
              id: categoryId,
              name: `Preprod Cat ${run}`,
              slug: `preprod-cat-${run}`,
              priority: 0,
              createdAt: agentTime,
              updatedAt: agentTime,
            },
          });
          await tx.agent.create({
            data: {
              id: agentId,
              name: `Preprod Agent ${run}`,
              description: "Preprod fixture",
              blockchainIdentifier: `pr2-preprod-${run}`,
              createdAt: agentTime,
              updatedAt: agentTime,
              lastUptimeCheck: agentTime,
              uptimeCount: 1,
              uptimeCheckCount: 1,
              isShown: true,
              status: "ONLINE",
              type: "STANDARD",
              paymentType: "NONE",
              apiBaseUrl: "https://preprod-agent.example.com",
              pricing: { create: { id: pricingId, pricingType: "FREE" } },
              categories: { connect: [{ id: categoryId }] },
            },
          });
          await tx.userAgentRating.create({
            data: {
              id: seededRatingId,
              userId: plain.id,
              agentId,
              rating: 5,
              comment: "Preprod review",
              createdAt: reviewTime1,
              updatedAt: reviewTime1,
            },
          });
          await tx.job.create({
            data: {
              id: jobId,
              ownerId: optedIn.id,
              creatorUserId: optedIn.id,
              workspaceId: optedInWs.id,
              agentId,
              agentJobId: `preprod-job-${run}`,
              jobType: "FREE",
              events: {
                create: {
                  status: "COMPLETED",
                  createdAt: agentTime,
                  updatedAt: agentTime,
                },
              },
              purchase: {
                create: {
                  externalId: `preprod-purchase-${run}`,
                  onChainStatus: null,
                },
              },
            },
          });
        }, "Preprod fixture conflict");

        await shared.syncMetadata.upsert({
          where: { key: preprodReadinessKey },
          create: {
            key: preprodReadinessKey,
            cursorId: "[]",
            lastSyncedAt: agentTime,
          },
          update: { cursorId: "[]", lastSyncedAt: agentTime },
        });

        const catalogTablePattern =
          /"(Agent|CreditCost|Category|UserAgentRating|Job|sync_metadata)"/;

        // Unauthorized / mismatched callers get 403 with zero catalog SQL.
        for (const [label, path, headers, expectedKind, method, body] of [
          [
            "anon categories preprod",
            "/v1/categories",
            { "X-Sokosumi-Network": "preprod" },
            "preprod_access_required",
            "GET",
            undefined,
          ],
          [
            "plain user reviews preprod",
            `/v1/agents/${agentId}/reviews`,
            {
              authorization: `Bearer ${plainKey}`,
              "X-Sokosumi-Network": "preprod",
            },
            "preprod_access_required",
            "GET",
            undefined,
          ],
          [
            "mismatched key reviews preprod",
            `/v1/agents/${agentId}/reviews`,
            {
              authorization: `Bearer ${mainnetKey}`,
              "X-Sokosumi-Network": "preprod",
            },
            "api_key_network_mismatch",
            "GET",
            undefined,
          ],
          [
            "mismatched key categories preprod",
            "/v1/categories",
            {
              authorization: `Bearer ${mainnetKey}`,
              "X-Sokosumi-Network": "preprod",
            },
            "api_key_network_mismatch",
            "GET",
            undefined,
          ],
          [
            "mismatched key rating write preprod",
            `/v1/agents/${agentId}/ratings`,
            {
              authorization: `Bearer ${mainnetKey}`,
              "X-Sokosumi-Network": "preprod",
              "content-type": "application/json",
            },
            "api_key_network_mismatch",
            "POST",
            JSON.stringify({ rating: 5 }),
          ],
          [
            "mismatched key input-schema preprod",
            `/v1/agents/${agentId}/input-schema`,
            {
              authorization: `Bearer ${mainnetKey}`,
              "X-Sokosumi-Network": "preprod",
            },
            "api_key_network_mismatch",
            "GET",
            undefined,
          ],
        ] as const) {
          const obs = await observing(async () => {
            const response = await app.request(path, {
              method,
              headers,
              ...(body ? { body } : {}),
            });
            const text = await response.text();
            await Promise.all(state.work.splice(0));
            return { status: response.status, text };
          });
          if ("threw" in obs.outcome) {
            throw new Error(JSON.stringify(obs.outcome.threw));
          }
          expect(obs.outcome.status, label).toBe(403);
          expect(JSON.parse(obs.outcome.text), label).toMatchObject({
            kind: expectedKind,
          });
          expect(
            obs.log.filter((entry) => catalogTablePattern.test(entry.text)),
            `${label} must send zero catalog SQL`,
          ).toEqual([]);
        }

        // Allowed Preprod caller reads and writes on the Preprod schema.
        const preprodHeaders = {
          authorization: `Bearer ${preprodKey}`,
          "X-Sokosumi-Network": "preprod",
        };
        const reviewsRes = await app.request(`/v1/agents/${agentId}/reviews`, {
          headers: preprodHeaders,
        });
        expect(reviewsRes.status).toBe(200);
        expect(await reviewsRes.json()).toMatchObject({
          data: {
            distribution: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 1 },
            ratingsWithComments: [{ id: seededRatingId }],
          },
        });

        const eligRes = await app.request(
          `/v1/agents/${agentId}/ratings/eligibility`,
          { headers: preprodHeaders },
        );
        expect(eligRes.status).toBe(200);
        expect(await eligRes.json()).toMatchObject({
          data: { eligible: true },
        });

        const postRes = await app.request(`/v1/agents/${agentId}/ratings`, {
          method: "POST",
          headers: {
            ...preprodHeaders,
            "content-type": "application/json",
          },
          body: JSON.stringify({ rating: 4, comment: "On Preprod" }),
        });
        expect(postRes.status).toBe(201);
        const posted = (await postRes.json()) as {
          data: { id: string; rating: number; comment: string };
        };
        createdRatingIds.push(posted.data.id);

        // The rating exists in Preprod and NOT in Mainnet.
        expect(
          await preprod.networkDb.userAgentRating.findUnique({
            where: { id: posted.data.id },
          }),
        ).not.toBeNull();
        expect(
          await mainnet.networkDb.userAgentRating.findUnique({
            where: { id: posted.data.id },
          }),
        ).toBeNull();

        const myReviewRes = await app.request(
          `/v1/agents/${agentId}/reviews/me`,
          { headers: preprodHeaders },
        );
        expect(myReviewRes.status).toBe(200);
        expect(await myReviewRes.json()).toMatchObject({
          data: { id: posted.data.id, rating: 4, comment: "On Preprod" },
        });

        const categoriesRes = await app.request("/v1/categories", {
          headers: preprodHeaders,
        });
        expect(categoriesRes.status).toBe(200);
        expect(
          ((await categoriesRes.json()) as { data: { id: string }[] }).data.map(
            (c) => c.id,
          ),
        ).toContain(categoryId);

        const schemaRes = await app.request(
          `/v1/agents/${agentId}/input-schema`,
          { headers: preprodHeaders },
        );
        expect(schemaRes.status).toBe(200);
        expect(await schemaRes.json()).toMatchObject({
          data: {
            input_data: [
              { name: "Prompt for https://preprod-agent.example.com" },
            ],
          },
        });

        // Mainnet does not see Preprod's agent.
        const mainnetSchemaRes = await app.request(
          `/v1/agents/${agentId}/input-schema`,
          { headers: { authorization: `Bearer ${mainnetKey}` } },
        );
        expect(mainnetSchemaRes.status).toBe(404);
        await Promise.all(state.work.splice(0));
      } finally {
        await preprod.netTransaction(async (tx) => {
          await tx.userAgentRating.deleteMany({
            where: { id: { in: createdRatingIds } },
          });
          await tx.job.deleteMany({ where: { id: { in: createdJobIds } } });
          await tx.agent.deleteMany({
            where: { id: { in: createdAgentIds } },
          });
          await tx.agentPricing.deleteMany({
            where: { id: { in: createdPricingIds } },
          });
          await tx.category.deleteMany({
            where: { id: { in: createdCategoryIds } },
          });
          await tx.creditCost.deleteMany({
            where: { id: { in: createdRateIds } },
          });
        }, "Preprod cleanup conflict");
        await shared.history.deleteMany({
          where: { entityId: { in: createdJobIds } },
        });
        if (previousPreprodReadiness) {
          await shared.syncMetadata.update({
            where: { key: preprodReadinessKey },
            data: previousPreprodReadiness,
          });
        } else {
          await shared.syncMetadata.deleteMany({
            where: { key: preprodReadinessKey },
          });
        }
        await shared.apikey.deleteMany({
          where: { referenceId: { in: createdUserIds } },
        });
        await shared.subscription.deleteMany({
          where: { referenceId: { in: createdUserIds } },
        });
        await shared.user.deleteMany({
          where: { id: { in: createdUserIds } },
        });
        state.preprodEnabled = false;
      }
    }, 60_000);
  },
);

// Checked by tsc without issuing a query.
export function _pr2CatalogReadersRequireScope(
  requireAgent: typeof import("@/lib/agent-catalog/availability").requireAvailableAgent,
  listCategories: typeof import("@/lib/agent-catalog/categories").listCategoriesInUse,
  getEndpoint: typeof import("@/lib/agent-catalog/endpoint").getAgentEndpoint,
) {
  // @ts-expect-error An availability check must supply its scope.
  requireAgent(undefined, "agent-1");
  // @ts-expect-error A categories reader must supply its scope.
  listCategories(undefined);
  // @ts-expect-error An endpoint reader must supply its scope.
  getEndpoint(undefined, "agent-1");
}
