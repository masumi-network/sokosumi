import { Hono } from "hono";
import type { Pool } from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { NetworkScope } from "@/lib/db/network-scope";
import { coreLogEvents, expectCoreLog } from "@/test/core-log";
import {
  registrySyncRevision,
  stubMasumiSyncHttp,
} from "@/test/masumi-sync-http";
import { copyPostgresTestDatabase } from "@/test/postgres-database-copy";
import { observing } from "@/test/spend-comparison";
import { onSplitLayout, withFixtureSchemas } from "@/test/split-layout";

const state = vi.hoisted(() => ({
  preprod: false,
  configured: true,
  pools: [] as Pool[],
  summary: vi.fn(async (description: string) => ({
    kind: "summary" as const,
    text: "Summary for " + description,
  })),
}));
vi.mock("@/clients/openrouter.client", () => ({
  openrouterClient: { generateAgentSummary: state.summary },
}));
vi.mock("@/config/env", async (load) => {
  const actual = await load<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      NETWORK_PREPROD_ENABLED: state.preprod,
      PREPROD_REGISTRY_API_KEY: state.configured
        ? actual.getEnv().PREPROD_REGISTRY_API_KEY
        : undefined,
      OPENROUTER_DEFAULT_API_KEY: state.configured
        ? "fixture-model-key"
        : undefined,
      SHOW_AGENTS_BY_DEFAULT: true,
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
    },
  };
});

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";
const cursor = "agents-sync-metadata:dynamic-pricing-v1";
const preprodCursor = "preprod:" + cursor;
const headers = { authorization: "Bearer test-cron-secret" };
const baseline = new Date("2026-11-01T00:00:00.000Z");
let database: Awaited<ReturnType<typeof copyPostgresTestDatabase>>;
let app: Hono;
let mainnet: NetworkScope;
let control: typeof import("@/helpers/preprod-control");

async function request(path: string, auth = true) {
  const { waitUntil } = await import("@vercel/functions");
  const previous = vi.mocked(waitUntil).mock.calls.length;
  const response = await app.request("/sync" + path, auth ? { headers } : {});
  return {
    status: response.status,
    body: await response.json(),
    done: Promise.all(
      vi
        .mocked(waitUntil)
        .mock.calls.slice(previous)
        .map(([task]) => task),
    ),
  };
}

async function tick(path: string) {
  const { status, body, done } = await request(path);
  await done;
  return { status, body };
}

async function setControl(key: string, cursorId: string) {
  await mainnet.sharedDb.syncMetadata.upsert({
    where: { key },
    create: { key, cursorId, lastSyncedAt: baseline },
    update: { cursorId },
  });
}

async function agents(scope: NetworkScope) {
  return scope.networkDb.agent.findMany({
    orderBy: { id: "asc" },
    include: {
      pricing: {
        include: {
          fixedPricing: { include: { amounts: { orderBy: { unit: "asc" } } } },
        },
      },
      paymentSources: {
        include: { amounts: { orderBy: { unit: "asc" } } },
        orderBy: { sourceIndex: "asc" },
      },
      exampleOutput: { orderBy: { name: "asc" } },
      tags: { orderBy: { name: "asc" } },
    },
  });
}

async function seedAgent(
  scope: NetworkScope,
  id: string,
  name: string,
  amount: number,
  data = {},
) {
  return scope.networkDb.agent.create({
    data: {
      id,
      blockchainIdentifier: id,
      name,
      description: name,
      status: "ONLINE",
      isShown: true,
      lastUptimeCheck: baseline,
      uptimeCount: 0,
      uptimeCheckCount: 0,
      pricing: {
        create: {
          pricingType: "FIXED",
          fixedPricing: {
            create: { amounts: { create: { unit: "lovelace", amount } } },
          },
        },
      },
      ...data,
    },
  });
}

function writeGate() {
  const reached = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  return {
    reached: reached.promise,
    release: release.resolve,
    async wait() {
      reached.resolve();
      await release.promise;
    },
  };
}

if (enabled) {
  beforeAll(async () => {
    const source =
      process.env.POSTGRES_TEST_TEMPLATE_URL ?? process.env.DATABASE_URL;
    if (!source) throw new Error("Agent cron tests require PostgreSQL");
    database = await copyPostgresTestDatabase(source, "cron_test");
    vi.stubEnv("DATABASE_URL", database.url);
    vi.stubEnv("DATABASE_URL_UNPOOLED", database.url);
    const { createNetworkScope } = await import("@/lib/db/network-scope");
    const { default: mountAgents } = await import("./get");
    const { default: mountSummaries } = await import("../agents-summary/get");
    control = await import("@/helpers/preprod-control");
    mainnet = createNetworkScope("mainnet");
    if (onSplitLayout) {
      const { configureSqlTables } = await import(
        "@sokosumi/database/sql-tables"
      );
      const { getEnv } = await import("@/config/env");
      const env = getEnv();
      configureSqlTables({
        shared: env.DATABASE_SCHEMA_SHARED,
        mainnet: env.DATABASE_SCHEMA_MAINNET,
        preprod: env.DATABASE_SCHEMA_PREPROD,
        preprodOn: true,
      });
    }
    const routes = new Hono();
    mountAgents(routes);
    mountSummaries(routes);
    app = new Hono().route("/sync", routes);
  }, 60_000);

  beforeEach(() => {
    state.summary.mockClear();
  });

  afterEach(async () => {
    if (onSplitLayout) {
      const { netTable } = await import("@sokosumi/database/sql-tables");
      await mainnet.networkDb
        .$executeRaw`TRUNCATE ${netTable("preprod", "Agent")}, ${netTable("preprod", "AgentPricing")}, ${netTable("preprod", "AgentFixedPricing")}, ${netTable("preprod", "Tag")} CASCADE`;
    }
    await withFixtureSchemas(
      (tx) =>
        tx.$executeRaw`TRUNCATE "Agent", "AgentPricing", "AgentFixedPricing", "Tag", "sync_metadata", "Lock", "notification", "user" CASCADE`,
    );
    state.preprod = false;
    state.configured = true;
    vi.unstubAllGlobals();
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

it.skipIf(!enabled)(
  "authenticates both Preprod paths and skips off without database or provider calls",
  async () => {
    const node = stubMasumiSyncHttp();
    const locks = () =>
      mainnet.sharedDb.lock.findMany({ orderBy: { key: "asc" } });
    const before = await locks();
    const { log, outcome } = await observing(async () => {
      for (const path of ["/preprod/agents", "/preprod/agents-summary"]) {
        expect((await request(path, false)).status).toBe(401);
        expect(await tick(path)).toEqual({
          status: 200,
          body: { message: "Sync skipped", reason: "off" },
        });
      }
    });
    expect(outcome).toBeUndefined();
    expect(log).toEqual([]);
    expect(node.requests).toEqual([]);
    expect(state.summary).not.toHaveBeenCalled();
    expect(await locks()).toEqual(before);
  },
);

describe.runIf(enabled && onSplitLayout)(
  "Agent crons on the split layout",
  () => {
    let preprod: NetworkScope;

    beforeEach(async () => {
      state.preprod = true;
      const { createNetworkScope } = await import("@/lib/db/network-scope");
      preprod = createNetworkScope("preprod");
      await setControl(control.PREPROD_PAUSE_KEY, "open");
    });

    const invalidations = [
      "pause",
      "generation raise",
      "lease takeover",
    ] as const;

    async function expectRefusedTick<T>(
      cron: "agents" | "agents-summary",
      gate: ReturnType<typeof writeGate>,
      invalidation: (typeof invalidations)[number],
      snapshot: () => Promise<T>,
    ) {
      const lockKey = `preprod:${cron}-sync`;
      const stale = await request(`/preprod/${cron}`);
      let before: T;
      try {
        expect(stale).toMatchObject({
          status: 200,
          body: { message: "Syncing started" },
        });
        await Promise.race([
          gate.reached,
          stale.done.then(() => {
            throw new Error("The cron finished before reaching the write gate");
          }),
        ]);
        before = await snapshot();
        switch (invalidation) {
          case "pause":
            await setControl(control.PREPROD_PAUSE_KEY, "paused");
            break;
          case "generation raise":
            await control.raisePreprodGeneration();
            break;
          case "lease takeover":
            await mainnet.sharedDb.lock.update({
              where: { key: lockKey },
              data: { lockedBy: "successor" },
            });
            expectCoreLog("warn", "A scheduled sync's lock was not released");
            break;
        }
      } finally {
        gate.release();
        await stale.done;
      }
      expect(await snapshot()).toEqual(before);
      expect(coreLogEvents()).toContainEqual(
        expect.objectContaining({
          operation: "cron_sync",
          sync: expect.objectContaining({ lockKey, outcome: "skipped" }),
        }),
      );
    }

    it.each(invalidations)(
      "preserves an existing Preprod Agent revision and its prices after %s",
      async (invalidation) => {
        const { resolveRegistryAgentVersion } = await import(
          "@/services/agent-sync.projection"
        );
        stubMasumiSyncHttp();
        await tick("/preprod/agents");
        await setControl(preprodCursor, "last-committed-entry");
        const first = registrySyncRevision(1);
        await seedAgent(preprod, "existing", first.name, 52, {
          blockchainIdentifier: first.agentIdentifier,
          registryIdentity: resolveRegistryAgentVersion(first).registryIdentity,
          registryVersion: 1,
        });

        const gate = writeGate();
        const node = stubMasumiSyncHttp(gate.wait);
        node.registryEntries = [{ ...registrySyncRevision(2), tags: [] }];
        await expectRefusedTick("agents", gate, invalidation, async () => ({
          agents: await agents(preprod),
          cursor: await mainnet.sharedDb.syncMetadata.findUniqueOrThrow({
            where: { key: preprodCursor },
          }),
        }));
      },
    );

    describe.each([
      ["Cardano", "/payment/rail-readiness"],
      ["x402", "/payment/x402/networks/available"],
    ])("%s readiness", (_rail, path) => {
      it.each(invalidations)(
        "preserves Preprod readiness and failure markers after %s",
        async (invalidation) => {
          const keys = [
            "preprod:cardano-v2-rail-readiness",
            "preprod:x402-buy-side-readiness",
          ].flatMap((key) => [key, key + "-failure"]);
          for (const key of keys) {
            await setControl(key, key.endsWith("-failure") ? "failed" : "[]");
          }
          const gate = writeGate();
          const node = stubMasumiSyncHttp();
          node.beforePaymentReply = async (pathname) => {
            if (pathname === path) await gate.wait();
          };
          await expectRefusedTick("agents", gate, invalidation, () =>
            mainnet.sharedDb.syncMetadata.findMany({
              where: { key: { in: [...keys, preprodCursor] } },
              orderBy: { key: "asc" },
            }),
          );
        },
      );
    });

    it.each(invalidations)(
      "preserves a Preprod Agent's missing summary after %s",
      async (invalidation) => {
        await seedAgent(preprod, "pending", "Preprod description", 52);
        const gate = writeGate();
        state.summary.mockImplementationOnce(async () => {
          await gate.wait();
          return { kind: "summary", text: "Generated Preprod summary" };
        });
        await expectRefusedTick("agents-summary", gate, invalidation, () =>
          agents(preprod),
        );
      },
    );

    it("projects, consolidates and replays only the selected Network", async () => {
      const { resolveRegistryAgentVersion } = await import(
        "@/services/agent-sync.projection"
      );
      const first = registrySyncRevision(1);
      const second = registrySyncRevision(2);
      for (const [scope, amount] of [
        [mainnet, 41],
        [preprod, 52],
      ] as const) {
        await seedAgent(scope, "equal", scope.network, amount, {
          blockchainIdentifier: first.agentIdentifier,
          registryIdentity: resolveRegistryAgentVersion(first).registryIdentity,
          registryVersion: 1,
        });
        await seedAgent(scope, "duplicate", scope.network + " copy", amount, {
          blockchainIdentifier: second.agentIdentifier.toUpperCase(),
        });
      }
      await mainnet.sharedDb.user.create({
        data: {
          id: "reader",
          name: "Reader",
          email: "reader@example.test",
          emailVerified: false,
          createdAt: baseline,
          updatedAt: baseline,
        },
      });
      for (const network of [null, "mainnet", "preprod"]) {
        const id = network ?? "legacy";
        await mainnet.sharedDb.notification.create({
          data: {
            id,
            network,
            userId: "reader",
            kind: "JOB",
            referenceId: id,
            eventId: id,
            messageKey: id,
            messageParams: "{}",
            metadata: '{"agentId":"duplicate","fixture":1}',
          },
        });
      }
      const notifications = () =>
        mainnet.sharedDb.notification.findMany({ orderBy: { id: "asc" } });
      const olderNotifications = await notifications();
      const mainBefore = await agents(mainnet);
      const preprodBefore = await agents(preprod);
      expect(mainBefore[1].pricing.fixedPricing?.amounts[0].amount).toBe(41n);
      expect(preprodBefore[1].pricing.fixedPricing?.amounts[0].amount).toBe(
        52n,
      );

      const node = stubMasumiSyncHttp();
      node.registryEntries = [{ ...second, name: "Mainnet revision" }];
      await tick("/agents");
      expect(await agents(preprod)).toEqual(preprodBefore);
      const mainAfter = await agents(mainnet);
      expect(mainAfter.find(({ id }) => id === "equal")).toMatchObject({
        name: "Mainnet revision",
        status: "ONLINE",
      });
      const afterMainnet = await notifications();
      expect(afterMainnet[0].metadata).toBe(
        '{"agentId": "equal", "fixture": 1}',
      );
      expect(afterMainnet[1].metadata).toBe(afterMainnet[0].metadata);
      expect(afterMainnet[2]).toEqual(olderNotifications[2]);
      // Give Preprod a matching Mainnet deep link to preserve in this direction too.
      await mainnet.sharedDb.notification.updateMany({
        where: { id: { in: ["legacy", "mainnet"] } },
        data: { metadata: olderNotifications[0].metadata },
      });
      const beforePreprodNotifications = await notifications();
      const mainCursor = await mainnet.sharedDb.syncMetadata.findUniqueOrThrow({
        where: { key: cursor },
      });

      const preprodOnly = {
        ...registrySyncRevision(3),
        agentIdentifier: registrySyncRevision(3).agentIdentifier.replace(
          "67ab",
          "cfab",
        ),
        name: "Preprod only",
      };
      node.requests.length = 0;
      node.registryEntries = [
        { ...second, name: "Preprod revision", status: "Deregistered" },
        preprodOnly,
      ];
      await tick("/preprod/agents");
      const preprodAfter = await agents(preprod);
      expect(preprodAfter.find(({ id }) => id === "equal")).toMatchObject({
        name: "Preprod revision",
        status: "DEREGISTERED",
      });
      expect(preprodAfter.map(({ name }) => name)).toContain("Preprod only");
      expect(await agents(mainnet)).toEqual(mainAfter);
      expect((await notifications()).slice(0, 2)).toEqual(
        beforePreprodNotifications.slice(0, 2),
      );
      expect((await notifications())[2].metadata).toBe(
        afterMainnet[0].metadata,
      );
      expect(node.requests.length).toBeGreaterThan(0);
      expect(
        node.requests.every(({ credential }) =>
          credential.startsWith("preprod "),
        ),
      ).toBe(true);
      const locks = await mainnet.sharedDb.lock.findMany({
        select: { key: true },
        orderBy: { key: "asc" },
      });
      expect(locks).toEqual([
        { key: "agents-sync" },
        { key: "preprod:agents-sync" },
      ]);
      const progress = await mainnet.sharedDb.syncMetadata.findMany({
        where: { key: { contains: "agents-sync-metadata" } },
        select: { key: true, cursorId: true, lastSyncedAt: true },
        orderBy: { key: "asc" },
      });
      expect(progress).toEqual([
        {
          key: cursor,
          cursorId: second.id,
          lastSyncedAt: second.statusUpdatedAt,
        },
        {
          key: preprodCursor,
          cursorId: preprodOnly.id,
          lastSyncedAt: preprodOnly.statusUpdatedAt,
        },
      ]);

      await mainnet.sharedDb.syncMetadata.update({
        where: { key: preprodCursor },
        data: { cursorId: null },
      });
      node.registryEntries = [];
      await tick("/preprod/agents");
      expect(node.registryRequests.at(-1)).toEqual({
        statusUpdatedAfter: preprodOnly.statusUpdatedAt.toISOString(),
        network: "Preprod",
        limit: 50,
      });
      await tick("/preprod/agents?replay=true");
      expect(node.registryRequests.at(-1)).toEqual({
        statusUpdatedAfter: new Date(0).toISOString(),
        network: "Preprod",
        limit: 50,
      });
      expect(
        await mainnet.sharedDb.syncMetadata.findUnique({
          where: { key: preprodCursor },
        }),
      ).toBeNull();
      expect(
        await mainnet.sharedDb.syncMetadata.findUnique({
          where: { key: cursor },
        }),
      ).toEqual(mainCursor);
    }, 60_000);

    it("reads and writes only Preprod summaries for an Agent ID present on both Networks", async () => {
      const { PrismaRaw } = await import("@sokosumi/database/client");
      const { getEnv } = await import("@/config/env");
      await seedAgent(mainnet, "equal", "Mainnet description", 41);
      await seedAgent(preprod, "equal", "Preprod description", 52);
      const mainBefore = await agents(mainnet);
      const schema = PrismaRaw.raw(`"${getEnv().DATABASE_SCHEMA_MAINNET}"`);
      // Neither the lookup nor the write can reach Mainnet during this tick.
      await mainnet.sharedDb
        .$executeRaw`ALTER SCHEMA ${schema} RENAME TO "held_mainnet_summary"`;
      const { log, outcome } = await observing(() =>
        tick("/preprod/agents-summary"),
      ).finally(
        () =>
          mainnet.sharedDb
            .$executeRaw`ALTER SCHEMA "held_mainnet_summary" RENAME TO ${schema}`,
      );
      expect(outcome).toMatchObject({ body: { message: "Syncing started" } });
      expect(log.length).toBeGreaterThan(0);
      expect(
        state.summary.mock.calls.map(([description]) => description),
      ).toEqual(["Preprod description"]);
      expect(await agents(mainnet)).toEqual(mainBefore);
      expect((await agents(preprod))[0]).toMatchObject({
        id: "equal",
        summary: "Summary for Preprod description",
      });
      expect(
        await mainnet.sharedDb.lock.findMany({ select: { key: true } }),
      ).toEqual([{ key: "preprod:agents-summary-sync" }]);
    });

    it("skips unconfigured and unavailable control before either lock", async () => {
      expectCoreLog(
        "error",
        "Could not read the Preprod pause and generation",
        2,
      );
      const node = stubMasumiSyncHttp();
      for (const [configured, reason] of [
        [false, "unconfigured"],
        [true, "unavailable"],
      ] as const) {
        state.configured = configured;
        if (configured)
          await setControl(control.PREPROD_GENERATION_KEY, "invalid");
        for (const path of ["/preprod/agents", "/preprod/agents-summary"]) {
          expect(await tick(path)).toEqual({
            status: 200,
            body: { message: "Sync skipped", reason },
          });
        }
      }
      expect(await mainnet.sharedDb.lock.count()).toBe(0);
      expect(node.requests).toEqual([]);
      expect(state.summary).not.toHaveBeenCalled();
    });

    it("skips both Preprod crons when PostgreSQL cannot read the control table", async () => {
      expectCoreLog(
        "error",
        "Could not read the Preprod pause and generation",
        2,
      );
      const { sharedTable } = await import("@sokosumi/database/sql-tables");
      const { PrismaRaw } = await import("@sokosumi/database/client");
      const { getEnv } = await import("@/config/env");
      const unavailable = PrismaRaw.raw(
        `"${getEnv().DATABASE_SCHEMA_SHARED}"."held_preprod_control"`,
      );
      const node = stubMasumiSyncHttp();
      const db = mainnet.sharedDb;
      await db.$executeRaw`ALTER TABLE ${sharedTable("sync_metadata")} RENAME TO "held_preprod_control"`;
      try {
        for (const path of ["/preprod/agents", "/preprod/agents-summary"]) {
          expect(await tick(path)).toEqual({
            status: 200,
            body: { message: "Sync skipped", reason: "unavailable" },
          });
        }
        expect(await db.lock.count()).toBe(0);
        expect(node.requests).toEqual([]);
        expect(state.summary).not.toHaveBeenCalled();
      } finally {
        await db.$executeRaw`ALTER TABLE ${unavailable} RENAME TO "sync_metadata"`;
      }
    });

    it("keeps three full Mainnet batches moving while Preprod is paused", async () => {
      await setControl(control.PREPROD_PAUSE_KEY, "paused");
      let firstRequest = true;
      const node = stubMasumiSyncHttp(async () => {
        if (!firstRequest) node.registryEntries = [];
        firstRequest = false;
      });
      for (let index = 1; index <= 3; index++) {
        const batch = Array.from({ length: 50 }, (_, i) => {
          const entry = registrySyncRevision(index * 50 + i);
          return {
            ...entry,
            agentIdentifier: entry.agentIdentifier.replace(
              "67ab",
              (i + 1).toString(16).padStart(4, "0"),
            ),
          };
        });
        firstRequest = true;
        node.registryEntries = batch;
        expect(await tick("/preprod/agents")).toEqual({
          status: 200,
          body: { message: "Sync skipped", reason: "paused" },
        });
        expect((await tick("/agents")).status).toBe(200);
        expect(
          await mainnet.sharedDb.syncMetadata.findUnique({
            where: { key: cursor },
          }),
        ).toMatchObject({
          cursorId: batch[49].id,
          lastSyncedAt: batch[49].statusUpdatedAt,
        });
      }
      expect(await mainnet.networkDb.agent.count()).toBe(150);
      expect(await preprod.networkDb.agent.count()).toBe(0);
      expect(
        await mainnet.sharedDb.lock.findMany({ select: { key: true } }),
      ).toEqual([{ key: "agents-sync" }]);
      expect(
        node.requests.every(({ credential }) =>
          credential.startsWith("mainnet "),
        ),
      ).toBe(true);
    }, 60_000);

    it("keeps Mainnet moving during a stuck Preprod run and refuses a write after a generation raise", async () => {
      stubMasumiSyncHttp();
      await tick("/preprod/agents");
      await setControl(preprodCursor, "last-committed-entry");
      const savedProgress =
        await mainnet.sharedDb.syncMetadata.findUniqueOrThrow({
          where: { key: preprodCursor },
        });
      const reached = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let calls = 0;
      const node = stubMasumiSyncHttp(async () => {
        if (++calls === 1) {
          reached.resolve();
          await release.promise;
        }
      });
      const stale = await request("/preprod/agents");
      try {
        await reached.promise;
        expect(stale).toMatchObject({
          status: 200,
          body: { message: "Syncing started" },
        });
        expect((await tick("/preprod/agents")).status).toBe(409);
        node.registryEntries = [registrySyncRevision(1)];
        expect((await tick("/agents")).status).toBe(200);
        expect(await mainnet.networkDb.agent.count()).toBe(1);
        await control.raisePreprodGeneration();
      } finally {
        release.resolve();
        await stale.done;
      }
      expect(await preprod.networkDb.agent.count()).toBe(0);
      expect(await preprod.networkDb.tag.count()).toBe(0);
      expect(
        await mainnet.sharedDb.syncMetadata.findUnique({
          where: { key: preprodCursor },
        }),
      ).toEqual(savedProgress);
    }, 30_000);
  },
);

it.skipIf(!enabled)(
  "leaves registry progress to the new owner after the old tick resumes",
  async () => {
    expectCoreLog("warn", "A scheduled sync's lock was not released");
    const arrived = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const first = registrySyncRevision(1);
    const later = registrySyncRevision(2);
    let calls = 0;
    const node = stubMasumiSyncHttp(async () => {
      if (++calls === 1) {
        arrived.resolve();
        await release.promise;
        node.registryEntries = [first];
      }
    });
    const stale = await request("/agents");
    try {
      await arrived.promise;
      expect(stale.status).toBe(200);
      await mainnet.sharedDb.lock.update({
        where: { key: "agents-sync" },
        data: { lockedAt: new Date(0) },
      });
      node.registryEntries = [later];
      expect((await tick("/agents")).status).toBe(200);
      expect(
        await mainnet.sharedDb.syncMetadata.findUniqueOrThrow({
          where: { key: cursor },
        }),
      ).toMatchObject({
        cursorId: later.id,
        lastSyncedAt: later.statusUpdatedAt,
      });
    } finally {
      release.resolve();
      await stale.done;
    }
    expect(
      await mainnet.sharedDb.syncMetadata.findUniqueOrThrow({
        where: { key: cursor },
      }),
    ).toMatchObject({
      cursorId: later.id,
      lastSyncedAt: later.statusUpdatedAt,
    });
  },
  30_000,
);
