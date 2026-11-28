// The public-layout recording commit ran the writers at de314fe8c.
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import type { Pool } from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import {
  registrySyncRevision,
  stubMasumiSyncHttp,
} from "@/test/masumi-sync-http";
import { copyPostgresTestDatabase } from "@/test/postgres-database-copy";
import {
  observing,
  statementDigest,
  statements,
} from "@/test/spend-comparison";
import { onSplitLayout } from "@/test/split-layout";

const state = vi.hoisted(() => ({
  network: "Mainnet" as "Mainnet" | "Preprod",
  pools: [] as Pool[],
  preprodEnabled: false,
}));
vi.mock("@/config/env", async (load) => {
  const actual = await load<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      NETWORK: state.network,
      NETWORK_PREPROD_ENABLED: state.preprodEnabled,
      SHOW_AGENTS_BY_DEFAULT: state.network === "Mainnet",
    }),
  };
});
vi.mock("@vercel/functions", async (load) => {
  const actual = await load<typeof import("@vercel/functions")>();
  const { observePool } = await import("@/test/spend-comparison");
  return {
    ...actual,
    waitUntil: vi.fn(),
    attachDatabasePool(pool: Pool) {
      state.pools.push(pool);
      observePool(pool);
      actual.attachDatabasePool(pool);
    },
  };
});
vi.mock("@/clients/openrouter.client", () => ({
  openrouterClient: {
    generateAgentSummary: async (description: string) =>
      description === "Decline"
        ? { kind: "declined" }
        : { kind: "summary", text: "Generated summary" },
  },
}));

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";
let database: Awaited<ReturnType<typeof copyPostgresTestDatabase>>;
if (enabled) {
  beforeAll(async () => {
    const source =
      process.env.POSTGRES_TEST_TEMPLATE_URL ?? process.env.DATABASE_URL;
    if (!source) throw new Error("Registry comparison requires PostgreSQL");
    database = await copyPostgresTestDatabase(source, "catalog_test");
    vi.stubEnv("DATABASE_URL", database.url);
    vi.stubEnv("DATABASE_URL_UNPOOLED", database.url);
    const { createNetworkScope } = await import("@/lib/db/network-scope");
    const shared = createNetworkScope("mainnet").sharedDb;
    expect(await shared.$queryRaw`SELECT current_database() AS name`).toEqual([
      { name: database.name },
    ]);
  }, 60_000);
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (onSplitLayout && state.preprodEnabled) {
      const { createNetworkScope } = await import("@/lib/db/network-scope");
      const preprod = createNetworkScope("preprod");
      await preprod.networkDb
        .$executeRaw`TRUNCATE ${preprod.networkTable("Agent")}, ${preprod.networkTable("AgentPricing")}, ${preprod.networkTable("AgentFixedPricing")}, ${preprod.networkTable("Tag")}, ${preprod.networkTable("Category")} CASCADE`;
      state.preprodEnabled = false;
    }
    const { withFixtureSchemas } = await import("@/test/split-layout");
    await withFixtureSchemas(
      (tx) =>
        tx.$executeRaw`TRUNCATE "Agent", "AgentPricing", "AgentFixedPricing", "Tag", "Category", "sync_metadata", "notification", "task_x402_payment_action", "user" CASCADE`,
    );
  });
  afterAll(async () => {
    try {
      await Promise.all(state.pools.splice(0).map((pool) => pool.end()));
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      await database?.drop();
    }
  }, 60_000);
}

it
  .skipIf(!enabled)
  .each(
    onSplitLayout ? (["Mainnet", "Preprod"] as const) : (["Mainnet"] as const),
  )(
  "preserves registry writes, consolidation and summaries on deployment %s",
  async (network) => {
    state.network = network;
    state.preprodEnabled = network === "Preprod";
    if (state.preprodEnabled) {
      const { getEnv } = await import("@/config/env");
      const { configureSqlTables } = await import(
        "@sokosumi/database/sql-tables"
      );
      const env = getEnv();
      onTestFinished(
        configureSqlTables({
          shared: env.DATABASE_SCHEMA_SHARED,
          mainnet: env.DATABASE_SCHEMA_MAINNET,
          preprod: env.DATABASE_SCHEMA_PREPROD,
          preprodOn: true,
        }),
      );
    }
    const { createNetworkScope } = await import("@/lib/db/network-scope");
    const scope = createNetworkScope(
      network === "Preprod" ? "preprod" : "mainnet",
    );
    const db = scope.networkDb;
    const shared = scope.sharedDb;
    const { agentSyncService: service } = await import("./agent-sync.service");
    const { masumiClients } = await import("@/clients/masumi");
    const { AGENTS_SYNC_METADATA_KEY: key } = await import(
      "@/routes/sync/agents/get"
    );
    const { openrouterClient } = await import("@/clients/openrouter.client");
    const { payment: paymentNode, registry: registryClient } = masumiClients(
      scope.network,
    );
    const storedKey = scope.network === "preprod" ? "preprod:" + key : key;
    const node = stubMasumiSyncHttp();
    const options = {
      abortSignal: new AbortController().signal,
      shouldContinue: () => true,
    };
    const byId = { id: "asc" } as const;
    const snapshot = async () => ({
      agents: await db.agent.findMany({
        orderBy: byId,
        include: {
          tags: { orderBy: byId },
          categories: { orderBy: byId },
          metadataOverride: true,
        },
      }),
      pricing: await db.agentPricing.findMany({ orderBy: byId }),
      fixed: await db.agentFixedPricing.findMany({ orderBy: byId }),
      amounts: await db.unitValue.findMany({ orderBy: byId }),
      sources: await db.agentPaymentSource.findMany({ orderBy: byId }),
      sourceAmounts: await db.agentPaymentSourceAmount.findMany({
        orderBy: byId,
      }),
      outputs: await db.exampleOutput.findMany({ orderBy: byId }),
      jobs: await db.job.findMany({
        select: {
          id: true,
          agentId: true,
          agentBlockchainIdentifier: true,
          agentApiBaseUrl: true,
        },
        orderBy: byId,
      }),
      payments: await db.taskX402Payment.findMany({
        select: { id: true, agentId: true },
        orderBy: byId,
      }),
      actions: await db.taskX402PaymentAction.findMany({
        select: { id: true, agentId: true },
        orderBy: byId,
      }),
      ratings: await db.userAgentRating.findMany({ orderBy: byId }),
      notifications: await shared.notification.findMany({
        select: { id: true, metadata: true, network: true },
        orderBy: byId,
      }),
      cursor: await shared.syncMetadata.findUnique({
        where: { key: storedKey },
      }),
    });
    const before = await snapshot();
    expect(before.agents).toHaveLength(0);
    expect(before.cursor).toBeNull();
    // Fix the clock and the UUIDv7 generator's entropy input, so PostgreSQL
    // returns the actual generated IDs in order on both versions.
    const clock = Date.UTC(network === "Mainnet" ? 2110 : 2111, 0);
    vi.useFakeTimers({ toFake: ["Date"], now: clock });
    vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(42);
      return array;
    });
    await service.syncCardanoV2RailReadiness(scope, paymentNode);
    const ticks: {
      phase: string;
      requests: typeof node.registryRequests;
      transactions: unknown[][];
      queries: { sql: string; values: unknown[]; pending?: number[] }[];
      rows: Awaited<ReturnType<typeof snapshot>>;
    }[] = [];
    const registry = () =>
      service.syncRegistryAgents(scope, registryClient, key, options);
    const tick = async (phase: string, run: () => Promise<void>) => {
      vi.setSystemTime(clock + (ticks.length + 1) * 60_000);
      const { log, outcome } = await observing(run, { trackResponses: true });
      expect(outcome).toBeUndefined();
      expect(log.length).toBeGreaterThan(0);
      ticks.push({
        phase,
        requests: node.registryRequests.splice(0),
        // Identify each transaction by the indexes of its actual sends on the
        // same connection. The queries below keep their original bindings.
        transactions: statements(
          log.map((query, index) => ({ ...query, values: [index] })),
        ).transactions.map((tx) => tx.map((query) => query.values[0])),
        queries: log.map((q) => ({
          sql: statementDigest(q.text),
          values: q.values,
          pending: q.pendingAtSend,
        })),
        rows: await snapshot(),
      });
    };
    const first = registrySyncRevision(1);
    node.registryEntries = [first];
    await tick("create", registry);
    const canonical = await db.agent.findUniqueOrThrow({
      where: { blockchainIdentifier: first.agentIdentifier },
    });
    expect(canonical.isShown).toBe(network === "Mainnet");
    const second = registrySyncRevision(2);
    const duplicate = "rollback-copy";
    const agent = {
      name: "Rollback",
      apiBaseUrl: first.apiBaseUrl,
      lastUptimeCheck: first.lastUptimeCheck,
      uptimeCount: 0,
      uptimeCheckCount: 0,
      isShown: true,
      pricing: { create: { pricingType: "FREE" as const } },
    };
    await db.agent.create({
      data: {
        ...agent,
        id: duplicate,
        blockchainIdentifier: second.agentIdentifier.toUpperCase(),
        categories: {
          create: { name: "Rollback", slug: "rollback", priority: 1 },
        },
        metadataOverride: { create: { description: "Describe" } },
      },
    });
    const decline = await db.agent.create({
      data: {
        ...agent,
        id: "decline",
        blockchainIdentifier: "decline",
        description: "Decline",
      },
    });
    const workspaceId = "00000000-0000-4000-a000-000000000008";
    for (const userId of ["newer", "equal", "only-copy"]) {
      await shared.user.create({
        data: {
          id: userId,
          name: userId,
          email: userId + "@example.org",
          ...(userId === "newer" && {
            workspace: { create: { id: workspaceId } },
          }),
          emailVerified: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      if (userId !== "only-copy")
        await db.userAgentRating.create({
          data: {
            id: userId + "-canonical",
            userId,
            agentId: canonical.id,
            rating: 4,
            updatedAt: first.statusUpdatedAt,
          },
        });
      await db.userAgentRating.create({
        data: {
          id: userId + "-copy",
          userId,
          agentId: duplicate,
          rating: 2,
          updatedAt:
            userId === "newer" ? second.statusUpdatedAt : first.statusUpdatedAt,
        },
      });
    }
    await db.job.create({
      data: {
        id: "job",
        agentId: duplicate,
        ownerId: "newer",
        agentJobId: "seller-job",
        jobType: "FREE",
        workspaceId,
      },
    });
    await shared.task.create({
      data: { id: "task", ownerId: "newer", workspaceId, name: "Task" },
    });
    await db.transaction.create({
      data: { id: "charge", userId: "newer", amount: -10n },
    });
    const payment = {
      taskId: "task",
      agentId: duplicate,
      caip2Network: "eip155:8453",
      asset: "USDC",
      amount: "10",
    };
    await db.taskX402Payment.create({
      data: {
        ...payment,
        id: "payment",
        transactionId: "charge",
        payTo: "seller",
        idempotencyKey: "payment",
      },
    });
    await db.taskX402PaymentAction.create({
      data: {
        ...payment,
        id: "action",
        paymentId: "payment",
        action: "failure",
        operatorId: "operator",
        reason: "fixture",
        cents: 10n,
        chargedUserId: "newer",
      },
    });
    const match = JSON.stringify({ agentId: duplicate, other: 1 });
    for (const [index, metadata] of [
      match,
      match,
      match,
      '{"agentId":"other"}',
      "{invalid",
      null,
    ].entries()) {
      const id = "notification-" + index;
      await shared.notification.create({
        data: {
          id,
          userId: "newer",
          kind: "JOB",
          referenceId: id,
          eventId: id,
          messageKey: id,
          messageParams: "{}",
          network: [null, "mainnet", "preprod"][index % 3],
          metadata,
        },
      });
    }
    node.registryEntries = [second];
    await tick("promote and consolidate", registry);
    expect(
      await db.userAgentRating.findMany({
        select: { id: true },
        orderBy: byId,
      }),
    ).toEqual([
      { id: "equal-canonical" },
      { id: "newer-copy" },
      { id: "only-copy-copy" },
    ]);
    expect(
      await db.agentPaymentSource.count({ where: { agentId: canonical.id } }),
    ).toBe(2);
    expect(
      await db.exampleOutput.count({ where: { agentId: canonical.id } }),
    ).toBe(2);
    // Publish the old Preprod fixture too, so both deployments exercise summary generation.
    await db.agent.update({
      where: { id: canonical.id },
      data: { isShown: true },
    });
    await tick("summaries", () =>
      service.syncAgentSummaries(scope, openrouterClient, options),
    );
    const declined = await db.agent.findUniqueOrThrow({
      where: { id: decline.id },
    });
    expect(declined.summaryDeclinedAt).not.toBeNull();
    expect(declined.updatedAt).toEqual(decline.updatedAt);
    await tick("unchanged revision", registry);
    node.registryEntries = [];
    await tick("resume from cursor", registry);
    const actual = JSON.parse(
      JSON.stringify(ticks, (_, v) =>
        typeof v === "bigint" ? v.toString() : v,
      ),
    );
    const file = new URL(
      `./__tests__/fixtures/agent-sync-registry-${network}.base.json`,
      import.meta.url,
    );
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
    if (scope.network === "preprod") {
      const mainnet = masumiClients("mainnet");
      const sends = node.requests.length;
      const { syncX402BuySideReadiness } = await import(
        "./agent-sync.x402-readiness"
      );
      for (const crossed of [
        () => service.syncRegistryAgents(scope, mainnet.registry, key, options),
        () => service.syncCardanoV2RailReadiness(scope, mainnet.payment),
        () => syncX402BuySideReadiness(scope, mainnet.payment),
      ])
        await expect(crossed()).rejects.toThrow("does not belong");
      expect(node.requests).toHaveLength(sends);
    }
    expect(actual).toEqual(JSON.parse(readFileSync(file, "utf8")));
  },
  60_000,
);

it.skipIf(!enabled)(
  "keeps overlapping registry ticks on the shared cron lock and resumes from the committed cursor",
  async () => {
    const { default: mount } = await import("@/routes/sync/agents/get");
    const { waitUntil } = await import("@vercel/functions");
    const app = new Hono();
    mount(app);
    const arrived = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const node = stubMasumiSyncHttp(async () => {
      arrived.resolve();
      await release.promise;
    });
    node.registryEntries = [registrySyncRevision(1)];
    const request = () =>
      app.request("/agents", {
        headers: { authorization: "Bearer test-cron-secret" },
      });
    try {
      expect((await request()).status).toBe(200);
      await arrived.promise;
      const second = await request();
      expect(second.status).toBe(409);
      expect(node.registryRequests).toHaveLength(1);
    } finally {
      release.resolve();
      await Promise.all(
        vi.mocked(waitUntil).mock.calls.map(([promise]) => promise),
      );
    }
    node.registryEntries = [];
    expect((await request()).status).toBe(200);
    await Promise.all(
      vi.mocked(waitUntil).mock.calls.map(([promise]) => promise),
    );
    expect(node.registryRequests[1]).toMatchObject({
      cursorId: "registry-1",
      statusUpdatedAfter: registrySyncRevision(1).statusUpdatedAt.toISOString(),
    });
  },
  30_000,
);

it.skipIf(!enabled || !onSplitLayout)(
  "adopts and summarizes only the named Network's legacy row",
  async () => {
    const { configureSqlTables } = await import(
      "@sokosumi/database/sql-tables"
    );
    const { getEnv } = await import("@/config/env");
    const env = getEnv();
    const restore = configureSqlTables({
      shared: env.DATABASE_SCHEMA_SHARED,
      mainnet: env.DATABASE_SCHEMA_MAINNET,
      preprod: env.DATABASE_SCHEMA_PREPROD,
      preprodOn: true,
    });
    state.preprodEnabled = true;
    try {
      const { createNetworkScope } = await import("@/lib/db/network-scope");
      const { agentSyncService: service } = await import(
        "./agent-sync.service"
      );
      const { masumiClients } = await import("@/clients/masumi");
      const { openrouterClient } = await import("@/clients/openrouter.client");

      const { AGENTS_SYNC_METADATA_KEY: key } = await import(
        "@/routes/sync/agents/get"
      );
      const main = createNetworkScope("mainnet");
      const preprod = createNetworkScope("preprod");
      const entry = registrySyncRevision(1);
      const node = stubMasumiSyncHttp();
      node.registryEntries = [entry];
      for (const scope of [main, preprod]) {
        await scope.networkDb.agent.create({
          data: {
            id: scope.network,
            blockchainIdentifier: entry.agentIdentifier.toUpperCase(),
            name: "Legacy",
            description: "Describe",
            lastUptimeCheck: entry.lastUptimeCheck,
            uptimeCount: 0,
            uptimeCheckCount: 0,
            isShown: true,
            pricing: { create: { pricingType: "FREE" } },
          },
        });
      }
      const options = {
        abortSignal: new AbortController().signal,
        shouldContinue: () => true,
      };
      await service.syncCardanoV2RailReadiness(
        preprod,
        masumiClients(preprod.network).payment,
      );
      await service.syncRegistryAgents(
        preprod,
        masumiClients(preprod.network).registry,
        key,
        options,
      );
      await service.syncAgentSummaries(preprod, openrouterClient, options);
      expect(
        await main.networkDb.agent.findMany({
          select: { id: true, summary: true, registryVersion: true },
        }),
      ).toEqual([{ id: "mainnet", summary: null, registryVersion: 0 }]);
      expect(
        await preprod.networkDb.agent.findMany({
          select: { id: true, summary: true, registryVersion: true },
        }),
      ).toEqual([
        { id: "preprod", summary: "Generated summary", registryVersion: 1 },
      ]);
      expect(
        await main.sharedDb.syncMetadata.findUnique({ where: { key } }),
      ).toBeNull();
      expect(
        await preprod.sharedDb.syncMetadata.findUnique({
          where: { key: "preprod:" + key },
        }),
      ).toMatchObject({
        cursorId: entry.id,
        lastSyncedAt: entry.statusUpdatedAt,
      });
    } finally {
      state.preprodEnabled = false;
      restore();
    }
  },
);
