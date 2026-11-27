// Recorded on origin/main at 18d849492, with the same routes, seed and clock.
// RECORD_AGENT_CATALOG_BASE=true writes the public-layout recording.
import "@hono/zod-openapi";
import { readFileSync, writeFileSync } from "node:fs";
import { Hono } from "hono";
import type { Pool } from "pg";
import { afterAll, expect, it, vi } from "vitest";
import { createPersonalWorkspace } from "@/helpers/personal-workspace";
import { createNetworkScope } from "@/lib/db/network-scope";
import { coreEvlogMiddleware } from "@/lib/evlog";
import { coreLogEvents, expectCoreLog } from "@/test/core-log";
import { observing, statements } from "@/test/spend-comparison";
import { onSplitLayout } from "@/test/split-layout";
import {
  createApiKey,
  createCoreApp,
  createPasswordUser,
} from "@/test-fixtures/core-session";

const state = vi.hoisted(() => ({
  network: "Mainnet" as "Mainnet" | "Preprod",
  pools: [] as Pool[],
  work: [] as Promise<unknown>[],
}));
vi.mock("@/config/env", async (load) => {
  const actual = await load<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({ ...actual.getEnv(), NETWORK: state.network }),
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
  await Promise.all(state.pools.map((pool) => pool.end()));
});

const clock = new Date("2026-11-27T12:00:00.000Z");
const createdAt = new Date("2026-11-25T01:02:03.456Z");
const updatedAt = new Date("2026-11-26T04:05:06.789Z");
const ids = [
  "catalog-a",
  "catalog-b",
  "catalog-c",
  "catalog-d",
  "catalog-hidden",
];
const key = "x402-buy-side-readiness";
const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";
const recording = process.env.RECORD_AGENT_CATALOG_BASE === "true";

it.skipIf(!enabled).each(["Mainnet", "Preprod"] as const)(
  "preserves catalog responses and SQL with deployment NETWORK=%s",
  async (network) => {
    state.network = network;
    const scope = createNetworkScope("mainnet");
    const shared = scope.sharedDb;
    const app = new Hono();
    app.use(coreEvlogMiddleware());
    app.use(async (c, next) => {
      c.set("requestId", "catalog-request");
      await next();
    });
    app.route("/", createCoreApp());

    const chain = network === "Mainnet" ? "eip155:8453" : "eip155:84532";
    const asset =
      network === "Mainnet"
        ? "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
        : "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
    const payTo = "0x1111111111111111111111111111111111111111";
    const previous = await shared.syncMetadata.findUnique({ where: { key } });
    const owner = await createPasswordUser("Catalog comparison");
    let createdAgents = false;
    let createdRate = false;
    const sql: string[] = [];
    const results: string[] = [];
    const calls: Record<string, number> = {};
    // Intern identical statements and answers, including the two header forms.
    function intern(table: string[], value: string) {
      const index = table.indexOf(value);
      return index === -1 ? table.push(value) - 1 : index;
    }
    try {
      await createPersonalWorkspace(owner.id);
      const token = await createApiKey(owner.id);
      await scope.netTransaction(async (tx) => {
        await tx.category.create({
          data: {
            id: "catalog-category",
            name: "Catalog",
            slug: "catalog-test",
            priority: 1,
            createdAt,
            updatedAt,
          },
        });
        for (const id of ids) {
          const x402 = id === "catalog-b" || id === "catalog-c";
          await tx.agent.create({
            data: {
              id,
              name: id,
              description: "Catalog fixture",
              blockchainIdentifier: id,
              createdAt,
              updatedAt,
              jobCount: 5,
              lastUptimeCheck: createdAt,
              uptimeCount: 1,
              uptimeCheckCount: 1,
              isShown: id !== "catalog-hidden",
              apiBaseUrl: x402 ? null : "https://agent.example.com",
              type: x402 ? "X402" : "STANDARD",
              x402ResourcesUrl: x402
                ? id === "catalog-c"
                  ? "invalid"
                  : "https://agent.example.com/x402"
                : null,
              pricing: {
                create: {
                  id: `${id}-pricing`,
                  pricingType: x402 ? "UNKNOWN" : "FREE",
                },
              },
              ...(id === "catalog-a" && {
                categories: { connect: { id: "catalog-category" } },
              }),
              ...(id === "catalog-b" && {
                paymentSources: {
                  create: {
                    id: "catalog-source",
                    sourceIndex: 0,
                    chain: "EVM",
                    network: chain,
                    scheme: "exact",
                    payTo,
                    address: asset,
                    pricingType: "FIXED",
                    amounts: {
                      create: {
                        id: "catalog-amount",
                        unit: asset,
                        amount: 2_000_000n,
                        decimals: 6,
                      },
                    },
                  },
                },
              }),
            },
          });
        }
      }, "Fixture conflict");
      createdAgents = true;
      const readiness = {
        cursorId: JSON.stringify([
          {
            caip2Network: chain,
            asset,
            decimals: 6,
            evmWalletId: "catalog-wallet",
            evmWalletAddress: payTo,
          },
        ]),
        lastSyncedAt: createdAt,
      };
      await shared.syncMetadata.upsert({
        where: { key },
        create: { key, ...readiness },
        update: readiness,
      });
      // Warm the bearer’s workspace and auth before counting database reads.
      for (let warm = 0; warm < 2; warm++) {
        await app.request("/v1/users/me", {
          headers: { authorization: `Bearer ${token}` },
        });
        await Promise.all(state.work.splice(0));
      }
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(clock);
      async function compare(label: string, path: string, status = 200) {
        let cursor: string | null = null;
        for (const header of ["absent", "mainnet"]) {
          const start = coreLogEvents().length;
          const { outcome, log } = await observing(async () => {
            const response = await app.request(path, {
              headers: {
                authorization: `Bearer ${token}`,
                ...(header === "mainnet" && { "X-Sokosumi-Network": header }),
              },
            });
            const body = await response.text();
            await Promise.all(state.work.splice(0));
            return { status: response.status, body };
          });
          if ("threw" in outcome)
            throw new Error(JSON.stringify(outcome.threw));
          expect(outcome.status, path).toBe(status);
          cursor =
            JSON.parse(outcome.body).meta?.pagination?.nextCursor ?? null;
          const drops = coreLogEvents()
            .slice(start)
            .flatMap((e) => (e.x402Listing ? [e.x402Listing] : []));
          const grouped = statements(log);
          const record = {
            ...outcome,
            drops,
            count: log.length,
            transactions: grouped.transactions.map((tx) =>
              tx.map((s) => [intern(sql, s.sql), s.values]),
            ),
            outside: Object.entries(grouped.outsideTransactions).map(
              ([text, count]) => [intern(sql, text), count],
            ),
          };
          calls[`${label}/${header}`] = intern(results, JSON.stringify(record));
        }
        return cursor;
      }
      await compare("empty rates list", "/v1/agents?kind=cardano");
      expectCoreLog("error", "A request failed with a server error", 2);
      await compare("empty rates detail", "/v1/agents/catalog-a", 500);
      await scope.networkDb.creditCost.create({
        data: {
          id: "catalog-rate",
          unit: `${chain}/erc20:${asset}`,
          centsPerUnit: 10_000_000_000n,
        },
      });
      createdRate = true;
      const cursor = await compare("page one", "/v1/agents?limit=2");
      expect(cursor).toBe("catalog-c");
      await compare("page two", `/v1/agents?limit=2&cursor=${cursor}`);
      await compare("cardano", "/v1/agents?kind=cardano");
      await compare("category", "/v1/agents?category=catalog-test");
      await compare("x402", "/v1/agents?kind=x402");
      await compare("detail", "/v1/agents/catalog-a");
      await compare("unavailable", "/v1/agents/catalog-hidden", 404);
      const path = new URL(
        `./catalog-${network.toLowerCase()}.base.json`,
        import.meta.url,
      );
      const result = {
        sql,
        results: results.map((row) => JSON.parse(row)),
        calls,
      };
      if (recording) {
        expect(onSplitLayout).toBe(false);
        writeFileSync(path, JSON.stringify(result, null, 2) + "\n");
      } else {
        expect(result).toEqual(JSON.parse(readFileSync(path, "utf8")));
      }
    } finally {
      vi.useRealTimers();
      await scope.netTransaction(async (tx) => {
        if (createdAgents) {
          await tx.agent.deleteMany({ where: { id: { in: ids } } });
          await tx.agentPricing.deleteMany({
            where: { id: { in: ids.map((id) => `${id}-pricing`) } },
          });
          await tx.category.deleteMany({ where: { id: "catalog-category" } });
        }
        if (createdRate)
          await tx.creditCost.deleteMany({ where: { id: "catalog-rate" } });
      }, "Fixture conflict");
      if (previous)
        await shared.syncMetadata.update({ where: { key }, data: previous });
      else await shared.syncMetadata.deleteMany({ where: { key } });
      await shared.apikey.deleteMany({ where: { referenceId: owner.id } });
      await shared.subscription.deleteMany({
        where: { referenceId: owner.id },
      });
      await shared.user.delete({ where: { id: owner.id } });
    }
  },
  60_000,
);

// Checked by tsc without issuing a query.
export function _availabilityRequiresScope(
  detail: typeof import("@/lib/agent-catalog/detail").getAvailableAgent,
  list: typeof import("@/lib/agent-catalog/list").listAvailableAgents,
) {
  // @ts-expect-error A detail reader must supply its scope.
  detail(undefined, "catalog-a");
  // @ts-expect-error A list reader must supply its scope.
  list(undefined, { kinds: ["cardano"], take: 1 });
}
