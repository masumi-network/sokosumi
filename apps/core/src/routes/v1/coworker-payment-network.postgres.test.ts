/**
 * A Coworker's three payments (a Task event's charge, an x402 payment, usage)
 * and the Network each is for, on a real PostgreSQL at the HTTP seam, with a
 * real Coworker key.
 *
 * With Preprod off, on a deployment whose `NETWORK` is Mainnet and on one whose
 * `NETWORK` is Preprod (the old Preprod), every request answers as on
 * `origin/main` before ticket 21's third slice: status, body, rows and the
 * statement count are compared with `coworker-payment-network.base.json`,
 * which this file wrote while it ran on `origin/main`'s code:
 * RECORD_COWORKER_PAYMENT_BASE=true RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter core test src/routes/v1/coworker-payment-network.postgres.test.ts
 * Without `RECORD_COWORKER_PAYMENT_BASE` the same command compares.
 */
// First: schemas built before this module loads have no `.openapi`, and the
// `/v1` router needs it on the ones `@sokosumi/utils` exports.
import "@hono/zod-openapi";

import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { convertCreditsToCents } from "@sokosumi/utils";
import { err } from "neverthrow";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { onSplitLayout } from "@/test/split-layout";

const pools = vi.hoisted(() => [] as Pool[]);
/** Statements Core's pool sent: the database client decides what a read is. */
const sent = vi.hoisted(() => ({ statements: 0 }));
/** Work a request hands to `waitUntil`, awaited as part of that request. */
const background = vi.hoisted(() => [] as Promise<unknown>[]);
/** The low-balance alert a charge asks for, and the payment node's x402 call. */
const outside = vi.hoisted(() => ({
  lowBalanceAlert: vi.fn(async (_billed: unknown) => undefined),
  payX402: vi.fn(),
}));
vi.mock("@vercel/functions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vercel/functions")>();
  return {
    ...actual,
    waitUntil: vi.fn((work: Promise<unknown>) => {
      background.push(work);
    }),
    attachDatabasePool: (pool: Pool) => {
      pools.push(pool);
      pool.on("connect", (client: PoolClient) => {
        const query = client.query.bind(client) as (...a: unknown[]) => unknown;
        (client as { query: unknown }).query = (...args: unknown[]) => {
          sent.statements += 1;
          return query(...args);
        };
      });
      actual.attachDatabasePool(pool);
    },
  };
});
// setup.ts mocks this module for every file; its factory result survives
// vi.resetModules(), so a reload with another environment would keep the first.
vi.unmock("@/lib/db/prisma");
// What a payment reaches outside the database. The alert's own reads are
// ticket 27's; here only whom it is asked for is recorded.
vi.mock("@/helpers/billing-notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/billing-notifications")>()),
  notifyLowBalanceAfterCharge: outside.lowBalanceAlert,
}));
vi.mock("@/lib/ably/publish", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ably/publish")>()),
  publishTaskEventData: vi.fn(),
}));
vi.mock("@/helpers/calendar-invalidation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/calendar-invalidation")>()),
  deliverCalendarInvalidationsNow: vi.fn(),
}));
vi.mock("@/helpers/task-notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/task-notifications")>()),
  notifyTaskParticipantsAdded: vi.fn(),
  notifyTaskStatusEvent: vi.fn(),
}));
// The purchase at the payment node runs after the response; the claim it
// would process is written by the request and stays PENDING here.
vi.mock("@/services/task-payment-claim.service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/services/task-payment-claim.service")
  >()),
  processTaskPaymentClaim: async () => ({
    status: "purchased",
    purchaseId: "fixture-purchase",
  }),
}));
vi.mock("@/clients/masumi-payment.client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/clients/masumi-payment.client")>()),
  paymentClient: () => ({ payX402: outside.payX402 }),
}));

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const ORIGIN = "https://example.com";
/**
 * A suite's setup reloads Core's modules: the first fresh import of the whole
 * app took 3.9 s alone on a 12-core machine and 14 s with the suite run on 24
 * workers, past Vitest's 10 s hook limit, as on CI's runner.
 */
const SETUP_TIMEOUT = 60_000;
/** A test that sends many requests, past Vitest's 5 s default on a loaded machine. */
const MANY_REQUESTS = 60_000;
const HEADER = "X-Sokosumi-Network";

const BASE_FILE = fileURLToPath(
  new URL("./coworker-payment-network.base.json", import.meta.url),
);
const recording = process.env.RECORD_COWORKER_PAYMENT_BASE === "true";

function recorded(): Record<string, unknown> {
  return existsSync(BASE_FILE)
    ? (JSON.parse(readFileSync(BASE_FILE, "utf8")) as Record<string, unknown>)
    : {};
}

/** Compares with what `origin/main` answered, or records it while run there. */
function expectAsOnBase(key: string, observed: unknown) {
  if (recording) {
    writeFileSync(
      BASE_FILE,
      `${JSON.stringify({ ...recorded(), [key]: observed }, null, 2)}\n`,
    );
    return;
  }
  expect(observed).toEqual(recorded()[key]);
}

type NetworkName = "mainnet" | "preprod";

/** Core's modules as a fresh start in this environment loads them. */
async function load(env: Record<string, string>) {
  delete (globalThis as { coreDatabase?: unknown }).coreDatabase;
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const fixture = await import("@/test-fixtures/core-session");
  const { default: prisma } = await import("@/lib/db/prisma");
  const { createNetworkScope } = await import("@/lib/db/network-scope");
  // The product's own creation path, so a fixture workspace has its Files
  // vocabulary (`workspace-creation-chokepoint.test.ts`).
  const { createPersonalWorkspace } = await import(
    "@/helpers/personal-workspace"
  );
  return {
    fixture,
    prisma,
    createNetworkScope,
    createPersonalWorkspace,
    app: fixture.createCoreApp(),
  };
}

type Loaded = Awaited<ReturnType<typeof load>>;

/** A Coworker with a key, the people and Tasks it bills, and their rows. */
function createWorld(loaded: Loaded, networks: readonly NetworkName[]) {
  const { prisma } = loaded;
  const userIds: string[] = [];
  const organizationIds: string[] = [];
  const taskIds: string[] = [];
  const vendorIds: string[] = [];
  /** Removals of rows no fixture person or Task ties, newest first. */
  const removals: (() => Promise<unknown>)[] = [];
  /** Random values in an answer or a row, each under a name. */
  const labels = new Map<string, string>();
  let coworker: { id: string; token: string } | undefined;

  const networkDb = (network: NetworkName) =>
    loaded.createNetworkScope(network).networkDb;
  const billedTo = {
    OR: [
      { userId: { in: userIds } },
      { organizationId: { in: organizationIds } },
    ],
  };

  return {
    labels,
    removals,
    networkDb,

    /** A Coworker that may work on Tasks, and its key. */
    async coworker() {
      if (coworker) return coworker;
      const { token, vendorId } = await loaded.fixture.createCoworkerKey();
      vendorIds.push(vendorId);
      const row = await prisma.coworker.findFirstOrThrow({
        where: { vendorId },
      });
      await prisma.coworker.update({
        where: { id: row.id },
        data: { capabilities: ["tasks"], isWhitelisted: true },
      });
      labels.set(row.id, "<coworker>");
      labels.set(row.slug, "<coworker slug>");
      labels.set(vendorId, "<vendor>");
      coworker = { id: row.id, token };
      return coworker;
    },

    /** A person with a personal workspace and credits on each named Network. */
    async person(
      name: string,
      credits: Partial<Record<NetworkName, number>>,
      preprodEnabled = false,
    ) {
      const user = await loaded.fixture.createPasswordUser(name);
      userIds.push(user.id);
      labels.set(user.id, `<${name}>`);
      await loaded.createPersonalWorkspace(user.id);
      if (preprodEnabled) {
        await prisma.user.update({
          where: { id: user.id },
          data: { preprodEnabled: true },
        });
      }
      const workspace = await prisma.workspace.findFirstOrThrow({
        where: { userId: user.id, organizationId: null },
      });
      labels.set(workspace.id, `<${name}'s workspace>`);
      for (const network of networks) {
        const amount = credits[network];
        if (amount === undefined) continue;
        await networkDb(network).transaction.create({
          data: {
            amount: convertCreditsToCents(amount),
            userId: user.id,
            sourceCreditBucket: {
              create: {
                amount: convertCreditsToCents(amount),
                userId: user.id,
              },
            },
          },
        });
      }
      return { id: user.id, workspaceId: workspace.id };
    },

    /** An Organization with one seated member and credits on each named Network. */
    async organization(
      memberId: string,
      credits: Partial<Record<NetworkName, number>>,
      preprodEnabled: boolean,
    ) {
      const created = await prisma.organization.create({
        data: {
          name: "Coworker payment fixture",
          slug: `coworker-payment-${randomUUID()}`,
          preprodEnabled,
          members: {
            create: {
              userId: memberId,
              role: "member",
              seatAssignedAt: new Date(),
            },
          },
          workspace: { create: {} },
        },
        select: { id: true, workspace: { select: { id: true } } },
      });
      organizationIds.push(created.id);
      labels.set(created.id, "<organization>");
      for (const network of networks) {
        const amount = credits[network];
        if (amount === undefined) continue;
        await networkDb(network).transaction.create({
          data: {
            amount: convertCreditsToCents(amount),
            organizationId: created.id,
            sourceCreditBucket: {
              create: {
                amount: convertCreditsToCents(amount),
                organizationId: created.id,
              },
            },
          },
        });
      }
      if (!created.workspace) throw new Error("The fixture has no workspace");
      return { id: created.id, workspaceId: created.workspace.id };
    },

    /** A running Task of the Owner, assigned to the Coworker. */
    async task(
      owner: { id: string; workspaceId: string },
      organization?: { id: string; workspaceId: string },
    ) {
      const task = await prisma.task.create({
        data: {
          ownerId: owner.id,
          creatorUserId: owner.id,
          ...(organization && { organizationId: organization.id }),
          workspaceId: organization?.workspaceId ?? owner.workspaceId,
          assigneeId: (await this.coworker()).id,
          name: "Coworker payment fixture",
          status: "RUNNING",
        },
      });
      taskIds.push(task.id);
      labels.set(task.id, "<task>");
      return task.id;
    },

    /** The money rows of the fixture's people on each Network, and their Tasks' events. */
    async ledger() {
      const perNetwork: Record<string, unknown> = {};
      for (const network of networks) {
        const db = networkDb(network);
        perNetwork[network] = {
          transactions: await db.transaction.findMany({
            where: billedTo,
            orderBy: { id: "asc" },
            select: {
              amount: true,
              _count: { select: { creditConsumptions: true } },
            },
          }),
          consumptions: await db.creditConsumption.findMany({
            where: { transaction: billedTo },
            orderBy: { id: "asc" },
            select: { amount: true },
          }),
          buckets: await db.creditBucket.findMany({
            where: billedTo,
            orderBy: { id: "asc" },
            select: { amount: true, referenceType: true },
          }),
          claims: await db.taskPaymentClaim.findMany({
            where: { transaction: billedTo },
            orderBy: { id: "asc" },
            select: { network: true, status: true, blockchainIdentifier: true },
          }),
          x402Payments: await db.taskX402Payment.findMany({
            where: { taskId: { in: taskIds } },
            orderBy: { id: "asc" },
            select: {
              status: true,
              caip2Network: true,
              amount: true,
              signAttemptCount: true,
              failureReason: true,
              refundTransactionId: true,
            },
          }),
          usage: await db.coworkerUsage.findMany({
            where: { userId: { in: userIds } },
            orderBy: { id: "asc" },
            select: {
              cents: true,
              idempotencyKey: true,
              referenceId: true,
              organizationId: true,
            },
          }),
        };
      }
      return {
        ...perNetwork,
        events: await prisma.taskEvent.findMany({
          where: { taskId: { in: taskIds } },
          orderBy: { id: "asc" },
          select: {
            status: true,
            cents: true,
            network: true,
            transactionId: true,
            comment: true,
          },
        }),
        tasks: await prisma.task.findMany({
          where: { id: { in: taskIds } },
          orderBy: { id: "asc" },
          select: { status: true },
        }),
      };
    },

    /** Every row the fixture caused, on every Network that is on. */
    async remove() {
      for (const network of networks) {
        const db = networkDb(network);
        await db.taskX402Payment.deleteMany({
          where: { taskId: { in: taskIds } },
        });
        await db.taskPaymentClaim.deleteMany({
          where: { transaction: billedTo },
        });
        await db.coworkerUsage.deleteMany({
          where: { userId: { in: userIds } },
        });
        await db.creditConsumption.deleteMany({
          where: { transaction: billedTo },
        });
        await db.creditBucket.deleteMany({ where: billedTo });
        await db.transaction.deleteMany({ where: billedTo });
      }
      for (const removal of removals.reverse()) await removal();
      await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
      await prisma.coworker.deleteMany({
        where: { vendorId: { in: vendorIds } },
      });
      await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
      await prisma.organization.deleteMany({
        where: { id: { in: organizationIds } },
      });
      // The free plan `createPersonalWorkspace` grants is not tied to the user.
      await prisma.subscription.deleteMany({
        where: { referenceId: { in: userIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    },
  };
}

type World = ReturnType<typeof createWorld>;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;

/** Plain data without what differs between two runs: named values, ids, times. */
function plain(world: World, value: unknown): unknown {
  let text = JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? item.toString() : item,
  );
  for (const [random, name] of world.labels) {
    text = text.replaceAll(random, name);
  }
  return JSON.parse(text.replace(UUID, "<id>").replace(TIME, "<time>"));
}

/**
 * One request of the Coworker and what it left: the answer without the time
 * and the request id, the statements Core sent, whom the low-balance alert was
 * asked for, what the payment node was asked to sign, and the money rows.
 */
async function send(
  loaded: Loaded,
  world: World,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const before = sent.statements;
  outside.lowBalanceAlert.mockClear();
  outside.payX402.mockClear();
  const response = await loaded.app.request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      authorization: `Bearer ${(await world.coworker()).token}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  while (background.length > 0) {
    await Promise.allSettled(background.splice(0));
  }
  const statements = sent.statements - before;
  const answer = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  const meta = answer?.meta as Record<string, unknown> | undefined;
  if (meta) {
    delete meta.timestamp;
    delete meta.requestId;
  }
  return plain(world, {
    status: response.status,
    body: answer,
    statements,
    lowBalanceAlerts: outside.lowBalanceAlert.mock.calls.map(
      ([billed]) => billed,
    ),
    nodeSigns: outside.payX402.mock.calls.map((call) => {
      const request = call[0] as Record<string, unknown>;
      return {
        evmWalletId: request.evmWalletId,
        preferredNetwork: request.preferredNetwork,
        preferredAsset: request.preferredAsset,
      };
    }),
    rows: await world.ledger(),
  }) as {
    status: number;
    body: { kind?: string; message?: string } | null;
    rows: Record<string, unknown>;
  };
}

/** A credit cost of 1 credit per unit, removed with the fixture. */
async function creditCost(loaded: Loaded, world: World, unit: string) {
  const scope = loaded.createNetworkScope("mainnet");
  const existing = await scope.networkDb.creditCost.findFirst({
    where: { unit },
  });
  if (existing) return;
  const id = randomUUID();
  const write = (remove: boolean) =>
    scope.netTransaction(async (tx) => {
      // shortcut: the unit trigger calls `public.canonical_credit_cost_unit`,
      // which the split layout moved to `shared`; drop this line with ticket 19.
      if (onSplitLayout) {
        await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      }
      if (remove) await tx.creditCost.deleteMany({ where: { id } });
      else
        await tx.creditCost.create({
          data: { id, unit, centsPerUnit: 10n ** 10n },
        });
    }, "Fixture conflict");
  world.removals.push(() => write(true));
  await write(false);
}

/** A Masumi payment of 2 credits in a unit of its own, as a Coworker sends it. */
async function masumiPayments(loaded: Loaded, world: World) {
  const unit = randomBytes(30).toString("hex");
  world.labels.set(unit, "<unit>");
  await creditCost(loaded, world, unit);
  return (name: string, paymentSource?: { network: string }) => {
    const blockchainIdentifier = randomBytes(20).toString("hex");
    world.labels.set(blockchainIdentifier, `<${name}>`);
    return {
      blockchainIdentifier,
      identifierFromPurchaser: "aabbccddeeff00112233",
      agentIdentifier:
        "7e8bdaf2b2b919a3a4b94002cafb50086c0c845fe535d07a77ab7f7773756d6d617279426f74",
      sellerVkey: "0bde475ace6b116298363b268309fa62172f7208625a9a83eeaffdbd",
      submitResultTime: "1775681853000",
      payByTime: "1775737949000",
      unlockTime: "1775763149000",
      externalDisputeUnlockTime: "1775784749000",
      inputHash:
        "3b2d456a720bf5b3e2cc2cebaea9f9a937cd8b4d64267da3271bca937cb56af1",
      Amounts: [{ amount: "2", unit }],
      ...(paymentSource && {
        PaymentSource: {
          ...paymentSource,
          smartContractAddress:
            paymentSource.network === "Mainnet"
              ? "addr1_fixture_contract"
              : "addr_test1_fixture_contract",
          policyId: "7e8bdaf2b2b919a3a4b94002cafb50086c0c845fe535d07a77ab7f77",
        },
      }),
    };
  };
}

const X402_CHAINS = {
  Mainnet: {
    caip2Network: "eip155:8453",
    asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    name: "USD Coin",
  },
  Preprod: {
    caip2Network: "eip155:84532",
    asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
    name: "USDC",
  },
} as const;
const PAY_TO = "0x1111111111111111111111111111111111111111";

/**
 * A listed x402 Agent that asks 2 credits on the chain of the deployment's
 * `NETWORK`, buy-side ready, and the 402 it answers.
 */
async function x402Agent(
  loaded: Loaded,
  world: World,
  deploymentNetwork: "Mainnet" | "Preprod",
) {
  const { prisma } = loaded;
  const { caip2Network, asset, name } = X402_CHAINS[deploymentNetwork];
  const db = world.networkDb("mainnet");
  const key = "x402-buy-side-readiness";
  const kept = await prisma.syncMetadata.findUnique({ where: { key } });
  world.removals.push(() =>
    kept
      ? prisma.syncMetadata.update({ where: { key }, data: kept })
      : prisma.syncMetadata.deleteMany({ where: { key } }),
  );
  const cursorId = JSON.stringify([
    {
      caip2Network,
      asset,
      decimals: 6,
      evmWalletId: "fixture-wallet",
      evmWalletAddress: PAY_TO,
    },
  ]);
  await prisma.syncMetadata.upsert({
    where: { key },
    create: { key, cursorId, lastSyncedAt: new Date() },
    update: { cursorId, lastSyncedAt: new Date() },
  });
  await creditCost(loaded, world, `${caip2Network}/erc20:${asset}`);
  const ids = { agent: randomUUID(), pricing: randomUUID() };
  world.removals.push(async () => {
    // Payment sources and their amounts go with the Agent.
    await db.agent.deleteMany({ where: { id: ids.agent } });
    await db.agentPricing.deleteMany({ where: { id: ids.pricing } });
  });
  world.labels.set(ids.agent, "<agent>");
  await db.agent.create({
    data: {
      id: ids.agent,
      blockchainIdentifier: randomUUID(),
      type: "X402",
      name: "Coworker payment x402 fixture",
      description: "Fixture",
      isShown: true,
      lastUptimeCheck: new Date(),
      uptimeCount: 1,
      uptimeCheckCount: 1,
      x402ResourcesUrl: "https://agent.example.com/.well-known/x402",
      pricing: { create: { id: ids.pricing, pricingType: "UNKNOWN" } },
      paymentSources: {
        create: {
          sourceIndex: 0,
          chain: "EVM",
          network: caip2Network,
          scheme: "exact",
          payTo: PAY_TO,
          address: asset,
          pricingType: "FIXED",
          amounts: { create: { unit: asset, amount: 2_000_000n, decimals: 6 } },
        },
      },
    },
  });
  return (idempotencyKey: string) => {
    world.labels.set(idempotencyKey, `<${idempotencyKey.split(":")[0]}>`);
    return {
      idempotencyKey,
      agentId: ids.agent,
      paymentRequired: {
        x402Version: 2,
        accepts: [
          {
            scheme: "exact",
            network: caip2Network,
            asset,
            amount: "2000000",
            payTo: PAY_TO,
            maxTimeoutSeconds: 60,
            extra: { name, version: "2" },
          },
        ],
      },
    };
  };
}

afterAll(async () => {
  vi.unstubAllEnvs();
  await Promise.all(pools.map((pool) => pool.end()));
});

// Today's layout only: on the split layout `origin/main` answers 500 to each
// of the three (measured 2026-11-27: the event's response joins Transaction,
// usage writes it, and the x402 payment reads its Agent, all on the default
// client, which has no Network table there until tickets 27 and 29).
describe.runIf(enabled && !onSplitLayout).each(["Mainnet", "Preprod"] as const)(
  "A Coworker's payments on a deployment with NETWORK=%s, Preprod off",
  (deploymentNetwork) => {
    let loaded: Loaded;
    const otherNetwork =
      deploymentNetwork === "Mainnet" ? "Preprod" : "Mainnet";
    const baseKey = (route: string) => `NETWORK=${deploymentNetwork}, ${route}`;

    let setup: Promise<void> | undefined;
    beforeAll(() => {
      setup = (async () => {
        loaded = await load({ NETWORK: deploymentNetwork });
      })();
      return setup;
    }, SETUP_TIMEOUT);

    // A setup that timed out keeps running: wait for it.
    afterAll(() => setup?.catch(() => undefined), SETUP_TIMEOUT);

    /** Runs a test with its own Coworker, people and rows, removed after it. */
    async function withWorld(run: (world: World) => Promise<void>) {
      const world = createWorld(loaded, ["mainnet"]);
      try {
        await run(world);
      } finally {
        await world.remove();
      }
    }

    it(
      "answers a Task event's charge as on origin/main",
      {
        timeout: MANY_REQUESTS,
      },
      () =>
        withWorld(async (world) => {
          const owner = await world.person("events owner", { mainnet: 10 });
          const path = `/v1/tasks/${await world.task(owner)}/events`;
          const payment = await masumiPayments(loaded, world);
          const first = payment("first payment");
          const steps: [string, unknown, Record<string, string>?][] = [
            ["credits, no header", { credits: 1, comment: "charged" }],
            ["credits, mainnet", { credits: 1 }, { [HEADER]: "mainnet" }],
            ["credits, preprod", { credits: 1 }, { [HEADER]: "preprod" }],
            [
              "a comment, preprod",
              { comment: "shared" },
              { [HEADER]: "preprod" },
            ],
            ["a Masumi payment, no header", { masumiPayment: first }],
            [
              "a Masumi payment that names the deployment's NETWORK",
              {
                masumiPayment: payment("named payment", {
                  network: deploymentNetwork,
                }),
              },
            ],
            [
              "a Masumi payment that names the deployment's NETWORK, mainnet",
              {
                masumiPayment: payment("named payment with header", {
                  network: deploymentNetwork,
                }),
              },
              { [HEADER]: "mainnet" },
            ],
            [
              "a Masumi payment that names the other NETWORK",
              {
                masumiPayment: payment("other payment", {
                  network: otherNetwork,
                }),
              },
            ],
            [
              "a Masumi payment, preprod",
              { masumiPayment: payment("refused") },
              {
                [HEADER]: "preprod",
              },
            ],
            ["the first Masumi payment again", { masumiPayment: first }],
            ["credits over the balance", { credits: 1_000_000 }],
          ];
          const answers: Record<string, unknown> = {};
          for (const [name, body, headers] of steps) {
            answers[name] = await send(loaded, world, path, body, headers);
          }
          expectAsOnBase(baseKey("Task events"), answers);
        }),
    );

    it(
      "answers usage as on origin/main",
      {
        timeout: MANY_REQUESTS,
      },
      () =>
        withWorld(async (world) => {
          const owner = await world.person("usage owner", { mainnet: 10 });
          // The assigned Task binds the Coworker to the Owner's workspace.
          await world.task(owner);
          const usage = (key: string, credits: number) => {
            world.labels.set(key, `<${key.split(":")[0]}>`);
            return {
              credits,
              idempotencyKey: key,
              userId: owner.id,
              organizationId: null,
            };
          };
          const [first, second, third] = ["first", "second", "third"].map(
            (name) => `${name}:${randomUUID()}`,
          );
          const steps: [string, unknown, Record<string, string>?][] = [
            ["usage, no header", usage(first, 1)],
            ["the same key again", usage(first, 1)],
            ["the same key with other credits", usage(first, 2)],
            ["usage, mainnet", usage(second, 1), { [HEADER]: "mainnet" }],
            [
              "the second key again, preprod",
              usage(second, 1),
              {
                [HEADER]: "preprod",
              },
            ],
            ["usage over the balance", usage(third, 1_000_000)],
          ];
          const answers: Record<string, unknown> = {};
          for (const [name, body, headers] of steps) {
            answers[name] = await send(
              loaded,
              world,
              "/v1/coworkers/me/usage",
              body,
              headers,
            );
          }
          expectAsOnBase(baseKey("usage"), answers);
        }),
    );

    it(
      "answers an x402 payment as on origin/main",
      {
        timeout: MANY_REQUESTS,
      },
      () =>
        withWorld(async (world) => {
          const owner = await world.person("x402 owner", { mainnet: 10 });
          const path = `/v1/tasks/${await world.task(owner)}/x402-payments`;
          const pay = await x402Agent(loaded, world, deploymentNetwork);
          const refused = err({
            kind: "refused",
            status: 400,
            message: "fixture refusal",
            nodeMessage: "fixture refusal",
          });
          const lost = err({
            kind: "ambiguous",
            message: "fixture lost answer",
          });
          const [first, second, third] = ["first", "second", "third"].map(
            (name) => `${name}:${randomUUID()}`,
          );
          const steps: [string, unknown, unknown, Record<string, string>?][] = [
            ["a payment the node refuses, no header", refused, pay(first)],
            ["the refused key again", refused, pay(first)],
            [
              "a payment whose answer is lost, mainnet",
              lost,
              pay(second),
              {
                [HEADER]: "mainnet",
              },
            ],
            ["the lost key again, refused", refused, pay(second)],
            [
              "a payment, preprod",
              refused,
              pay(third),
              { [HEADER]: "preprod" },
            ],
            [
              "a body that is no 402",
              refused,
              {
                ...pay(`fourth:${randomUUID()}`),
                paymentRequired: { not: "a 402" },
              },
            ],
          ];
          const answers: Record<string, unknown> = {};
          for (const [name, node, body, headers] of steps) {
            outside.payX402.mockResolvedValue(node);
            answers[name] = await send(loaded, world, path, body, headers);
          }
          expectAsOnBase(baseKey("x402 payments"), answers);
        }),
    );
  },
);
