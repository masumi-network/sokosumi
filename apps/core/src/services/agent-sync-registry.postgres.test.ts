// Record with the writers at de314fe8c on today's layout.
import { readFileSync, writeFileSync } from "node:fs";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  registrySyncRevision,
  stubMasumiSyncHttp,
} from "@/test/masumi-sync-http";
import { copyPostgresTestDatabase } from "@/test/postgres-database-copy";
import { observing, statementDigest } from "@/test/spend-comparison";
import { onSplitLayout } from "@/test/split-layout";

const state = vi.hoisted(() => ({
  network: "Mainnet" as "Mainnet" | "Preprod",
  pools: [] as Pool[],
}));
vi.mock("@/config/env", async (load) => {
  const actual = await load<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      NETWORK: state.network,
      SHOW_AGENTS_BY_DEFAULT: state.network === "Mainnet",
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
  }, 60_000);
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
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

it.skipIf(!enabled).each(["Mainnet", "Preprod"] as const)(
  "preserves registry writes, consolidation and summaries on deployment %s",
  async (network) => {
    state.network = network;
    const { createNetworkScope } = await import("@/lib/db/network-scope");
    const scope = createNetworkScope("mainnet");
    const db = scope.networkDb;
    const shared = scope.sharedDb;
    const { agentSyncService: service } = await import("./agent-sync.service");
    const { paymentClient } = await import("@/clients/masumi-payment.client");
    const { AGENTS_SYNC_METADATA_KEY: key } = await import(
      "@/routes/sync/agents/get"
    );
    const { registryClient } = await import("@/clients/masumi-registry.client");
    const { createRegistryClient } = await import("@sokosumi/masumi/clients");
    const { getEnv } = await import("@/config/env");
    const env = getEnv();
    vi.spyOn(registryClient, "getAgentsDiff").mockImplementation(
      createRegistryClient(network, env.REGISTRY_API_URL, env.REGISTRY_API_KEY)
        .getAgentsDiff,
    );
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
      cursor: await shared.syncMetadata.findUnique({ where: { key } }),
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
    await service.syncCardanoV2RailReadiness(scope, paymentClient());
    const ticks: {
      phase: string;
      requests: typeof node.registryRequests;
      queries: { sql: string; values: unknown[]; pending?: number[] }[];
      rows: Awaited<ReturnType<typeof snapshot>>;
    }[] = [];
    const registry = () => service.syncRegistryAgents(key, options);
    const tick = async (phase: string, run: () => Promise<void>) => {
      vi.setSystemTime(clock + (ticks.length + 1) * 60_000);
      const { log, outcome } = await observing(run, { trackResponses: true });
      expect(outcome).toBeUndefined();
      expect(log.length).toBeGreaterThan(0);
      ticks.push({
        phase,
        requests: node.registryRequests.splice(0),
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
    await tick("summaries", () => service.syncAgentSummaries(options));
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
    if (process.env.RECORD_AGENT_REGISTRY_BASE === "true") {
      expect(onSplitLayout).toBe(false);
      writeFileSync(file, JSON.stringify(actual));
    }
    expect(actual).toEqual(JSON.parse(readFileSync(file, "utf8")));
  },
  60_000,
);
