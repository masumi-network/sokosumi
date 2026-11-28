// Base: 9ed8ced1b. Record only from the public layout on the base implementation.
import { readFileSync, writeFileSync } from "node:fs";
import { Hono } from "hono";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { expectCoreLog } from "@/test/core-log";
import { stubMasumiSyncHttp } from "@/test/masumi-sync-http";
import { copyPostgresTestDatabase } from "@/test/postgres-database-copy";
import { observing, statements } from "@/test/spend-comparison";
import { onSplitLayout } from "@/test/split-layout";

const state = vi.hoisted(() => ({
  network: "Mainnet" as "Mainnet" | "Preprod",
  preprodEnabled: false,
  testPreprodOperation: false,
  pools: [] as Pool[],
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
vi.mock("@vercel/functions", async (load) => {
  const actual = await load<typeof import("@vercel/functions")>();
  const { observePool } = await import("@/test/spend-comparison");
  return {
    ...actual,
    attachDatabasePool(pool: Pool) {
      state.pools.push(pool);
      observePool(pool);
      actual.attachDatabasePool(pool);
    },
  };
});

// Invoke the registered cron operation synchronously. Its lock and deferred
// scheduling have independent tests. The cursor and the registry diff are real.
vi.mock("@/routes/sync/handler.js", () => ({
  async handleSyncRequest(
    c: { json: (body: unknown) => Response },
    _lock: string,
    work: (context: object) => Promise<void>,
    options: { network?: "mainnet" },
  ) {
    const { createNetworkScope } = await import("@/lib/db/network-scope");
    const { createCoreLogger } = await import("@/lib/evlog");
    expect(options.network).toBe("mainnet");
    await work({
      scope: createNetworkScope(
        state.testPreprodOperation ? "preprod" : "mainnet",
      ),
      abortSignal: new AbortController().signal,
      shouldContinue: () => true,
      log: createCoreLogger({ operation: "cron_sync" }),
    });
    return c.json({ ok: true });
  },
}));

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";
const clock = Date.parse("2026-11-27T12:00:00.000Z");
const columns = { key: true, cursorId: true, lastSyncedAt: true } as const;
let database: Awaited<ReturnType<typeof copyPostgresTestDatabase>>;
async function testScope(network: "mainnet" | "preprod" = "mainnet") {
  const { createNetworkScope } = await import("@/lib/db/network-scope");
  return createNetworkScope(network);
}
if (enabled) {
  beforeAll(async () => {
    const source =
      process.env.POSTGRES_TEST_TEMPLATE_URL ?? process.env.DATABASE_URL;
    if (!source) throw new Error("Readiness comparison requires PostgreSQL");
    database = await copyPostgresTestDatabase(source, "catalog_test");
    vi.stubEnv("DATABASE_URL", database.url);
    vi.stubEnv("DATABASE_URL_UNPOOLED", database.url);
    await (await testScope()).sharedDb.syncMetadata.deleteMany();
  }, 60_000);
  afterEach(async () => {
    state.preprodEnabled = false;
    state.testPreprodOperation = false;
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await (await testScope()).sharedDb.syncMetadata.deleteMany();
  });
  afterAll(async () => {
    try {
      await Promise.all(state.pools.map((pool) => pool.end()));
    } finally {
      vi.unstubAllEnvs();
      await database?.drop();
    }
  }, 60_000);
}

it.skipIf(!enabled).each([
  ["Mainnet", "mainnet"],

  ...(onSplitLayout ? [["Preprod", "preprod"] as const] : []),
] as const)(
  "preserves readiness writes and reads on deployment %s, scope %s",
  async (network, scopeNetwork) => {
    state.network = network;
    state.preprodEnabled = scopeNetwork === "preprod";
    const scope = await testScope(scopeNetwork);
    const { cardanoV2ReadySources, x402ReadySources } = await import(
      "@/lib/agent-catalog/availability"
    );
    const { masumiClients } = await import("@/clients/masumi");
    const { payment } = masumiClients(scope.network);
    const { syncCardanoV2RailReadiness } = await import(
      "./agent-sync.readiness"
    );
    const { syncX402BuySideReadiness } = await import(
      "./agent-sync.x402-readiness"
    );
    const node = stubMasumiSyncHttp();
    const ticks = [];
    const sql: string[] = [];
    const snapshot = async () => ({
      rows: await scope.sharedDb.syncMetadata.findMany({
        select: columns,
        orderBy: { key: "asc" },
      }),
      cardano: await cardanoV2ReadySources(scope),
      x402: await x402ReadySources(scope),
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    for (const [index, phase] of [
      "ready",
      "unchanged",
      "offline",
      "sustained",
      "recovery",
      "empty",
    ].entries()) {
      vi.setSystemTime(clock + index * 31 * 60_000);
      node.offline = phase === "offline" || phase === "sustained";
      if (phase === "empty") {
        node.cardano = [];
        node.networks = [];
      }
      const { log, outcome } = await observing(async () => [
        await syncCardanoV2RailReadiness(scope, payment, {
          sleep: async () => {},
        }),
        await syncX402BuySideReadiness(scope, payment),
      ]);
      expect(outcome).toHaveLength(2);
      expect(log.length).toBeGreaterThan(0);
      // Each writer is sequential. Keep every SQL text in send order, including
      // BEGIN/COMMIT, substituting only the fixture's physical schema name.
      const queries = statements(log, { asSent: true });
      const sequence = log.map(({ text }) => {
        const query = text.replaceAll('"shared".', '"public".');
        if (!sql.includes(query)) sql.push(query);
        return sql.indexOf(query);
      });
      expect(
        queries.transactions.every((tx) => tx.at(-1)?.sql === "COMMIT"),
      ).toBe(true);
      ticks.push({ phase, outcome, sequence, ...(await snapshot()) });
    }
    expectCoreLog(
      "warn",
      "A Cardano V2 rail readiness check attempt failed",
      6,
    );
    expectCoreLog("warn", "The Cardano V2 rail readiness check failed", 2);
    expectCoreLog("warn", "The x402 buy-side readiness check failed", 2);
    expectCoreLog("warn", "No Cardano V2 payment source");
    expectCoreLog("warn", "No x402 network and asset");
    expect(ticks[0].cardano).toHaveLength(2);
    expect(ticks[0].x402).toHaveLength(1);
    const file = new URL(
      `./__tests__/fixtures/agent-sync-readiness-${network}.base.json`,
      import.meta.url,
    );
    const actual = JSON.stringify({ sql, ticks });
    if (process.env.RECORD_AGENT_READINESS_BASE === "true") {
      expect(onSplitLayout).toBe(false);
      writeFileSync(file, actual);
    }
    const base = JSON.parse(readFileSync(file, "utf8")) as {
      sql: string[];
      ticks: {
        rows: { key: string; cursorId: string | null; lastSyncedAt: string }[];
        cardano: unknown[];
        x402: unknown[];
      }[];
    };
    if (scopeNetwork === "preprod") {
      for (const tick of base.ticks) {
        for (const row of tick.rows) row.key = `preprod:${row.key}`;
      }
    }
    expect(JSON.parse(actual)).toEqual(base);
    // An old writer's exact strings in PostgreSQL, consumed by today's readers.
    const old = base.ticks[2];
    await scope.sharedDb.syncMetadata.deleteMany();
    await scope.sharedDb.syncMetadata.createMany({ data: old.rows });
    const restored = await snapshot();
    expect(JSON.parse(JSON.stringify(restored))).toEqual({
      rows: old.rows,
      cardano: old.cardano,
      x402: old.x402,
    });
  },
  60_000,
);

// Before PR 8 the registry sync read Network rates on the default client and stopped early on split.
it
  .skipIf(!enabled)
  .each(
    onSplitLayout ? (["Mainnet", "Preprod"] as const) : (["Mainnet"] as const),
  )(
  "resets the stored registry cursor only on a Cardano change on %s",
  async (network) => {
    // The original comparison used a separate SDK instance for each deployment.
    // Exercise the same cron operation with each scope while keeping the real registration on Mainnet.
    state.network = network;
    state.testPreprodOperation = network === "Preprod";
    state.preprodEnabled = state.testPreprodOperation;
    const { default: mount, AGENTS_SYNC_METADATA_KEY } = await import(
      "@/routes/sync/agents/get"
    );
    const scope = await testScope(
      state.testPreprodOperation ? "preprod" : "mainnet",
    );
    const key =
      scope.network === "mainnet"
        ? AGENTS_SYNC_METADATA_KEY
        : "preprod:" + AGENTS_SYNC_METADATA_KEY;
    const app = new Hono();
    mount(app);
    // After reading/resetting its cursor the registry sync now reaches the
    // registry on both layouts, including past the former default-client rate read.
    const node = stubMasumiSyncHttp();
    vi.useFakeTimers({ toFake: ["Date"], now: clock });
    const rows = scope.sharedDb.syncMetadata;
    const data = {
      cursorId: "registry-page",
      lastSyncedAt: new Date(clock - 60_000),
    };
    const calls = [];
    for (const phase of ["cardano-change", "unchanged", "x402-only"]) {
      await rows.upsert({
        where: { key },
        create: { key, ...data },
        update: data,
      });
      if (phase === "x402-only") node.networks = [];
      const response = await app.request("/agents");
      expect(response.status).toBe(200);
      const row = await rows.findUnique({ where: { key }, select: columns });
      calls.push({ phase, row, request: node.registryRequests.at(-1) });
    }
    expectCoreLog("warn", "No x402 network and asset");

    const file = new URL(
      `./__tests__/fixtures/agent-sync-readiness-cursor-${network}.base.json`,
      import.meta.url,
    );
    if (process.env.RECORD_AGENT_READINESS_BASE === "true") {
      expect(onSplitLayout).toBe(false);
      writeFileSync(file, JSON.stringify(calls));
    }
    const expected = JSON.parse(readFileSync(file, "utf8")) as typeof calls;
    if (scope.network === "preprod") {
      for (const call of expected) {
        if (call.row) call.row.key = `preprod:${call.row.key}`;
      }
    }
    for (const request of node.requests) {
      expect(new URL(request.url).origin).toBe(
        scope.network === "mainnet"
          ? "https://example.com"
          : "https://preprod.example.com",
      );
      expect(request.credential).toBe(
        scope.network +
          (request.url.includes("/payment/") ? " payment" : " registry"),
      );
    }
    if (network === "Mainnet")
      await expect(
        JSON.stringify(node.requests, null, 2) + "\n",
      ).toMatchFileSnapshot(
        "./__tests__/fixtures/masumi-mainnet-cron.http.json",
      );
    const actual = JSON.parse(JSON.stringify(calls)) as typeof calls;
    expect(actual.map(({ row }) => row)).toEqual(
      expected.map(({ row }) => row),
    );
    expect(node.registryRequests).toHaveLength(3);
    expect(actual).toEqual(expected);
  },
  60_000,
);
