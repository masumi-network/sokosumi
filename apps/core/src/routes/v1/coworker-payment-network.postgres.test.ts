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
import { err, ok } from "neverthrow";
import type { Pool, PoolClient } from "pg";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { expectCoreLog } from "@/test/core-log";
import { onSplitLayout } from "@/test/split-layout";

const pools = vi.hoisted(() => [] as Pool[]);
/** Statements Core's pool sent: the database client decides what a read is. */
const sent = vi.hoisted(() => ({ statements: 0 }));
/** Work a request hands to `waitUntil`, awaited as part of that request. */
const background = vi.hoisted(() => [] as Promise<unknown>[]);
/** The low-balance alert a charge asks for, and the payment node's x402 call. */
const outside = vi.hoisted(() => ({
  useNode: false,
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
vi.mock("@/services/task-payment-claim.service", async (load) => {
  const actual =
    await load<typeof import("@/services/task-payment-claim.service")>();
  return {
    ...actual,
    processTaskPaymentClaim: (
      ...args: Parameters<typeof actual.processTaskPaymentClaim>
    ) =>
      outside.useNode
        ? actual.processTaskPaymentClaim(...args)
        : Promise.resolve({
            status: "purchased",
            purchaseId: "fixture-purchase",
          }),
  };
});
vi.mock("@/clients/masumi", async (load) => {
  const actual = await load<typeof import("@/clients/masumi")>();
  return {
    ...actual,
    masumiClients: (network: NetworkName) =>
      outside.useNode
        ? actual.masumiClients(network)
        : { payment: { payX402: outside.payX402 } },
  };
});

// shortcut: the event's response read joins Transaction on the default client,
// which has no Network table on the split layout until ticket 27. There this
// reads the same event without that join; drop it when that read moves.
vi.mock(
  "@/routes/v1/tasks/[id]/events/map-created-event",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/routes/v1/tasks/[id]/events/map-created-event")
      >();
    if (!onSplitLayout) return actual;
    const { mapTaskEvent } = await import("@/helpers/task");
    const { taskEventApiInclude } = await import("@/types/task");
    const { transaction: _joined, ...include } = taskEventApiInclude;
    return {
      mapCreatedTaskEventForResponse: (async (tx, eventId) =>
        mapTaskEvent({
          ...(await tx.taskEvent.findUniqueOrThrow({
            where: { id: eventId },
            include,
          })),
          transaction: null,
        })) satisfies typeof actual.mapCreatedTaskEventForResponse,
    };
  },
);

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

/**
 * Compares with what `origin/main` answered, or records it while run there,
 * through `now` where the head is known to send other statements.
 */
function expectAsOnBase(
  key: string,
  observed: unknown,
  now: (base: unknown) => unknown = (base) => base,
) {
  if (recording) {
    writeFileSync(
      BASE_FILE,
      `${JSON.stringify({ ...recorded(), [key]: observed }, null, 2)}\n`,
    );
    return;
  }
  expect(observed).toEqual(now(recorded()[key]));
}

/**
 * A personal usage's debit is written by the credits module's `recordSpend`
 * since the base: two statements where Prisma's nested create sent four (a
 * read of the user, the insert, the consumptions, a read back). Each statement
 * is compared in `coworkers/me/usage/post-spend.postgres.test.ts`.
 */
const PERSONAL_USAGE_DEBIT_STATEMENTS_SAVED = 2;
/**
 * Since ticket 29 the usage row is one raw insert on the Network's table,
 * where Prisma's nested create sent six statements (a read of the debit, of
 * a usage that holds it, of the user and of the Coworker, the insert, a read
 * back). Compared statement by statement in the same file.
 */
const USAGE_ROW_STATEMENTS_SAVED = 5;
/**
 * Since ticket 29 a usage that names Preprod while Preprod is off is refused
 * before the route reads anything, a replay of a Mainnet key included, which
 * `origin/main` answered with the Mainnet row: the Coworker's capability read
 * and the lookup's transaction (begin, isolation, lookup, commit) are not sent.
 */
const PREPROD_OFF_REPLAY_STATEMENTS_SAVED = 5;
function withUsageDebitAsWrittenNow(base: unknown): unknown {
  return Object.fromEntries(
    Object.entries(
      base as Record<string, { status: number; statements: number }>,
    ).map(([step, answer]) => [
      step,
      step === "the second key again, preprod"
        ? {
            ...answer,
            status: 403,
            body: {
              error: "Forbidden",
              message: "Preprod is switched off",
              kind: "preprod_off",
              meta: { path: "/v1/coworkers/me/usage", method: "POST" },
            },
            statements: answer.statements - PREPROD_OFF_REPLAY_STATEMENTS_SAVED,
          }
        : answer.status === 201
          ? {
              ...answer,
              statements:
                answer.statements -
                PERSONAL_USAGE_DEBIT_STATEMENTS_SAVED -
                USAGE_ROW_STATEMENTS_SAVED,
            }
          : answer,
    ]),
  );
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

  const x402PaymentIds = async (db: ReturnType<typeof networkDb>) =>
    (
      await db.taskX402Payment.findMany({
        where: { taskId: { in: taskIds } },
        select: { id: true },
      })
    ).map((payment) => payment.id);

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
          // The audit rows of the fixture's payments: no foreign key ties them.
          x402Actions: await db.taskX402PaymentAction.findMany({
            where: { paymentId: { in: await x402PaymentIds(db) } },
            orderBy: { id: "asc" },
            select: { action: true, operatorId: true, reason: true },
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
        await db.taskX402PaymentAction.deleteMany({
          where: { paymentId: { in: await x402PaymentIds(db) } },
        });
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
  // The key's use is written at most once a minute: the world's first request
  // writes it, as recorded. Held fresh after each request, outside the count,
  // so a world whose requests span a minute on a slow runner writes no more.
  await loaded.prisma.coworkerApiKey.updateMany({
    where: { coworkerId: (await world.coworker()).id },
    data: { lastUsedAt: new Date(Date.now() + 86_400_000) },
  });
  const answer = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  // A signed authorization carries its own expiry and signature.
  const signed = (answer?.data as { paymentHeader?: { value?: string } })
    ?.paymentHeader;
  if (signed?.value) signed.value = "<signed header>";
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
  }) as Sent;
}

interface Sent {
  status: number;
  body: { kind?: string; message?: string } | null;
  rows: Record<
    NetworkName,
    { transactions: { amount: string }[]; usage: unknown[]; claims: unknown[] }
  > & { events: { network: string | null; cents: string | null }[] };
}

/** The debits on a Network, in cents. */
function spent(answer: Sent, network: NetworkName): string[] {
  return answer.rows[network].transactions
    .map((transaction) => transaction.amount)
    .filter((amount) => amount.startsWith("-"));
}

const ONE_CREDIT = `-${convertCreditsToCents(1)}`;

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
/** The managed wallet the fixture's node signs with. */
const PAYER = privateKeyToAccount(`0x${"01".repeat(32)}`);

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
      evmWalletAddress: PAYER.address.toLowerCase(),
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
  const accepted = {
    scheme: "exact",
    network: caip2Network,
    asset,
    amount: "2000000",
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
    extra: { name, version: "2" },
  };
  return {
    /** The request that pays the Agent's 402 under this key. */
    pay(idempotencyKey: string) {
      world.labels.set(idempotencyKey, `<${idempotencyKey.split(":")[0]}>`);
      return {
        idempotencyKey,
        agentId: ids.agent,
        paymentRequired: { x402Version: 2, accepts: [accepted] },
      };
    },
    /** The node's answer with a real EIP-3009 authorization, which Core verifies. */
    async signed() {
      const nonce = `0x${randomBytes(32).toString("hex")}` as const;
      const validBefore = Math.floor(Date.now() / 1000) + 60;
      const signature = await PAYER.signTypedData({
        domain: {
          name,
          version: "2",
          chainId: Number(caip2Network.split(":")[1]),
          verifyingContract: asset,
        },
        types: {
          TransferWithAuthorization: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
            { name: "validAfter", type: "uint256" },
            { name: "validBefore", type: "uint256" },
            { name: "nonce", type: "bytes32" },
          ],
        },
        primaryType: "TransferWithAuthorization",
        message: {
          from: PAYER.address,
          to: PAY_TO,
          value: 2_000_000n,
          validAfter: 0n,
          validBefore: BigInt(validBefore),
          nonce,
        },
      });
      const authorization = {
        from: PAYER.address.toLowerCase(),
        to: PAY_TO,
        value: "2000000",
        validAfter: "0",
        validBefore: String(validBefore),
        nonce,
      };
      return ok({
        attemptId: "fixture-attempt",
        payer: PAYER.address.toLowerCase(),
        caip2Network,
        asset,
        amount: "2000000",
        payTo: PAY_TO,
        xPaymentHeader: Buffer.from(
          JSON.stringify({
            x402Version: 2,
            accepted,
            payload: { signature, authorization },
          }),
        ).toString("base64"),
        paymentPayload: { payload: { authorization } },
        paymentPayloadHash: `0x${randomBytes(32).toString("hex")}`,
        paymentIdentifier: null,
      });
    },
    /** Lets the lease of the Task's pending payments run out. */
    expireLeases: () =>
      db.taskX402Payment.updateMany({
        where: { agentId: ids.agent, status: "PENDING" },
        data: { processingAt: new Date(Date.now() - 60 * 60_000) },
      }),
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

    it.skipIf(deploymentNetwork !== "Mainnet")(
      "serves Mainnet registry entries when the header names Preprod and routing is off",
      () =>
        withWorld(async (world) => {
          const owner = await world.person("registry reader", {});
          const key = await loaded.fixture.createApiKey(owner.id);
          const { stubMasumiSyncHttp } = await import(
            "@/test/masumi-sync-http"
          );
          const node = stubMasumiSyncHttp();
          outside.useNode = true;
          try {
            const response = await loaded.app.request(
              ORIGIN + "/v1/registry/agents",
              {
                headers: {
                  authorization: "Bearer " + key,
                  [HEADER]: "preprod",
                },
              },
            );
            expect(response.status).toBe(200);
            expect(node.requests).toMatchObject([
              {
                url: "https://example.com/registry/registry-entry/",
                credential: "mainnet registry",
                method: "POST",
              },
            ]);
            expect(JSON.parse(node.requests[0].body).network).toBe("Mainnet");
          } finally {
            outside.useNode = false;
            vi.unstubAllGlobals();
          }
        }),
      MANY_REQUESTS,
    );

    it.skipIf(deploymentNetwork !== "Mainnet")(
      "sends the same Mainnet Task claim and x402 requests",
      async () =>
        withWorld(async (world) => {
          const { stubMasumiSyncHttp } = await import(
            "@/test/masumi-sync-http"
          );
          const owner = await world.person("node request owner", {
            mainnet: 30,
          });
          const task = await world.task(owner);
          const payment = (await masumiPayments(loaded, world))("node claim");
          // Fix the two asset and purchase identifiers in the raw HTTP comparison.
          const fixtureUnit = "b3".repeat(30);
          await creditCost(loaded, world, fixtureUnit);
          payment.Amounts[0].unit = fixtureUnit;
          payment.blockchainIdentifier = "b4".repeat(20);
          const agent = await x402Agent(loaded, world, "Mainnet");
          const node = stubMasumiSyncHttp();
          outside.useNode = true;
          try {
            const claim = await send(
              loaded,
              world,
              `/v1/tasks/${task}/events`,
              { masumiPayment: payment },
            );
            expect(claim.status).toBe(201);
            expect(node.requests.map((r) => new URL(r.url).pathname)).toEqual([
              "/payment/purchase",
            ]);
            node.x402Reply = (await agent.signed())._unsafeUnwrap();
            const pay = await send(
              loaded,
              world,
              `/v1/tasks/${task}/x402-payments`,
              agent.pay("mainnet-proof"),
            );
            expect(pay.status).toBe(200);
            expect(node.requests).toHaveLength(2);
            const claimRow = await world
              .networkDb("mainnet")
              .taskPaymentClaim.findFirstOrThrow({
                where: { blockchainIdentifier: payment.blockchainIdentifier },
              });
            // Bind the recording to the two actual PostgreSQL ids before comparing raw bytes.
            if (!claimRow.taskEventId)
              throw new Error(
                "Expected the persisted claim to reference its Task event",
              );
            const expected = readFileSync(
              new URL("./masumi-mainnet-task.http.json", import.meta.url),
              "utf8",
            )
              .replaceAll("<fixture task id>", task)
              .replaceAll("<fixture event id>", claimRow.taskEventId);
            expect(JSON.stringify(node.requests, null, 2) + "\n").toBe(
              expected,
            );
          } finally {
            outside.useNode = false;
            vi.unstubAllGlobals();
          }
        }),
      MANY_REQUESTS,
    );

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
          const commentOnly = "a comment, preprod";
          const steps: [string, unknown, Record<string, string>?][] = [
            ["credits, no header", { credits: 1, comment: "charged" }],
            ["credits, mainnet", { credits: 1 }, { [HEADER]: "mainnet" }],
            ["credits, preprod", { credits: 1 }, { [HEADER]: "preprod" }],
            [commentOnly, { comment: "shared" }, { [HEADER]: "preprod" }],
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
          expectAsOnBase(baseKey("Task events"), answers, (base) => {
            const expected = base as Record<
              typeof commentOnly,
              { statements: number }
            >;
            const comment = expected[commentOnly];
            return {
              ...expected,
              [commentOnly]: {
                ...comment,
                // A comment without a charge no longer reads Transaction.
                statements: comment.statements - 1,
              },
            };
          });
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
          expectAsOnBase(baseKey("usage"), answers, withUsageDebitAsWrittenNow);
        }),
    );

    // Not as on origin/main, which charged this call on Mainnet (decision 7).
    it("refuses usage that names Preprod, and charges nothing", () =>
      withWorld(async (world) => {
        const owner = await world.person("usage owner", { mainnet: 10 });
        await world.task(owner);
        const answer = await send(
          loaded,
          world,
          "/v1/coworkers/me/usage",
          {
            credits: 1,
            idempotencyKey: randomUUID(),
            userId: owner.id,
            organizationId: null,
          },
          { [HEADER]: "preprod" },
        );
        expect(answer).toMatchObject({
          status: 403,
          body: { kind: "preprod_off" },
        });
        expect(spent(answer, "mainnet")).toEqual([]);
        expect(answer.rows.mainnet.usage).toEqual([]);
      }));

    it(
      "answers an x402 payment as on origin/main",
      {
        timeout: MANY_REQUESTS,
      },
      () =>
        withWorld(async (world) => {
          const owner = await world.person("x402 owner", { mainnet: 10 });
          const path = `/v1/tasks/${await world.task(owner)}/x402-payments`;
          const { pay, signed, expireLeases } = await x402Agent(
            loaded,
            world,
            "Mainnet",
          );
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
          const preprod = { [HEADER]: "preprod" };
          const steps: {
            name: string;
            node: unknown;
            body: unknown;
            headers?: Record<string, string>;
            before?: () => Promise<unknown>;
          }[] = [
            {
              name: "a payment the node refuses, no header",
              node: refused,
              body: pay(first),
            },
            { name: "the refused key again", node: refused, body: pay(first) },
            {
              name: "a payment whose answer is lost, mainnet",
              node: lost,
              body: pay(second),
              headers: { [HEADER]: "mainnet" },
            },
            {
              name: "the lost key again, refused",
              node: refused,
              body: pay(second),
            },
            {
              name: "a payment, preprod",
              node: refused,
              body: pay(third),
              headers: preprod,
            },
            {
              name: "a body that is no 402",
              node: refused,
              body: {
                ...pay(`fourth:${randomUUID()}`),
                paymentRequired: { not: "a 402" },
              },
            },
            // The replays: a PENDING retry that signs again, then the
            // VERIFIED payment's stored authorization.
            {
              name: "the lost key again once its lease ran out, signed",
              node: await signed(),
              body: pay(second),
              before: expireLeases,
            },
            { name: "the signed key again", node: refused, body: pay(second) },
            {
              name: "the signed key again, preprod",
              node: refused,
              body: pay(second),
              headers: preprod,
            },
          ];
          const answers: Record<string, unknown> = {};
          for (const { name, node, body, headers, before } of steps) {
            await before?.();
            outside.payX402.mockResolvedValue(node);
            answers[name] = await send(loaded, world, path, body, headers);
          }
          expectAsOnBase("NETWORK=Mainnet, x402 payments", answers);
        }),
    );
  },
);

// Preprod is on only on the split layout. There the x402 payment and a
// Masumi payment's price still read Network tables on the default client
// (tickets 22 and 29) and answer 500 before or after the resolver, so their
// Network is proven with the database mocked
// (`tasks/[id]/x402-payments/post.test.ts`) and by the refusals below. Usage
// runs on its Network there since ticket 29's first slice:
// `coworkers/me/usage/post-network.postgres.test.ts`.
describe.runIf(enabled && onSplitLayout)(
  "A Coworker's payments with Preprod on, on the split layout",
  () => {
    let loaded: Loaded;

    let setup: Promise<void> | undefined;
    beforeAll(() => {
      setup = (async () => {
        loaded = await load({
          NETWORK: "Mainnet",
          NETWORK_PREPROD_ENABLED: "true",
        });
      })();
      return setup;
    }, SETUP_TIMEOUT);

    // A setup that timed out keeps running: wait for it.
    afterAll(() => setup?.catch(() => undefined), SETUP_TIMEOUT);

    /** Runs a test with its own Coworker, people and rows, removed after it. */
    async function withWorld(run: (world: World) => Promise<void>) {
      const world = createWorld(loaded, ["mainnet", "preprod"]);
      try {
        await run(world);
      } finally {
        await world.remove();
      }
    }

    const credits = { mainnet: 10, preprod: 20 };
    const preprod = { [HEADER]: "preprod" };
    const mainnet = { [HEADER]: "mainnet" };
    const refused = { status: 403, body: { kind: "preprod_access_required" } };
    const mismatch = { status: 400, body: { kind: "network_mismatch" } };
    const outOfCredits = {
      status: 422,
      body: { kind: "insufficient_balance" },
    };
    // Preprod costs no credits: the charge is recorded at its price on
    // Preprod's Transaction, and the event's write refuses it, because
    // `taskEvent.transactionId` has a foreign key to Mainnet's Transaction
    // (ticket 29). The request rolls back: nothing stays on either Network.
    const crossingKey = { status: 500 };

    it(
      "routes authenticated registry browsing and refuses deferred Preprod payments before booking or sending",
      async () =>
        withWorld(async (world) => {
          const owner = await world.person(
            "scoped request owner",
            credits,
            true,
          );
          const task = await world.task(owner);
          const payment = (await masumiPayments(loaded, world))(
            "preprod claim",
            { network: "Preprod" },
          );
          const agent = await x402Agent(loaded, world, "Preprod");
          const stored = (await x402Agent(loaded, world, "Mainnet")).pay(
            "verified-replay",
          );
          const db = world.networkDb("mainnet");
          const debit = await db.transaction.create({
            data: { userId: owner.id, amount: -1n },
          });
          const acceptance = stored.paymentRequired.accepts[0];
          await db.taskX402Payment.create({
            data: {
              taskId: task,
              agentId: stored.agentId,
              idempotencyKey: stored.idempotencyKey,
              status: "VERIFIED",
              caip2Network: X402_CHAINS.Mainnet.caip2Network,
              asset: X402_CHAINS.Mainnet.asset,
              amount: acceptance.amount,
              payTo: acceptance.payTo,
              transactionId: debit.id,
              xPaymentHeader: "synthetic-stored-header",
              validBefore: new Date(Date.now() + 60000),
            },
          });
          await loaded.prisma.user.update({
            where: { id: owner.id },
            data: { role: "admin" },
          });
          const keys = {
            mainnet: await loaded.fixture.createApiKey(
              owner.id,
              "soko_mainnet_",
            ),
            preprod: await loaded.fixture.createApiKey(
              owner.id,
              "soko_preprod_",
            ),
          };
          const job = {
            inputSchema: {
              input_data: [{ id: "prompt", type: "string", name: "prompt" }],
            },
            inputData: { prompt: "hello" },
          };
          const { stubMasumiSyncHttp } = await import(
            "@/test/masumi-sync-http"
          );
          const node = stubMasumiSyncHttp();
          outside.useNode = true;
          try {
            for (const network of ["mainnet", "preprod"] as const) {
              const response = await loaded.app.request(
                ORIGIN + "/v1/registry/agents?limit=1",
                { headers: { authorization: "Bearer " + keys[network] } },
              );
              expect(response.status).toBe(200);
              expect(node.requests.at(-1)).toMatchObject({
                url:
                  (network === "mainnet"
                    ? "https://example.com"
                    : "https://preprod.example.com") +
                  "/registry/registry-entry/",
                credential: network + " registry",
                method: "POST",
                body: JSON.stringify({
                  network: network === "mainnet" ? "Mainnet" : "Preprod",
                  limit: 3,
                  filter: {
                    status: ["Online", "Offline", "Deregistered", "Invalid"],
                  },
                }),
              });
            }
            expect(node.requests).toHaveLength(2);
            const before = await world.ledger();
            const id = randomUUID();
            for (const [path, body, token, kind] of [
              [`/v1/agents/${id}/jobs`, job, keys.preprod, "network_mismatch"],
              [
                `/v1/jobs/${id}/refund`,
                undefined,
                keys.preprod,
                "network_mismatch",
              ],
              [
                `/v1/tasks/${task}/jobs`,
                { ...job, agentId: id },
                (await world.coworker()).token,
                "preprod_access_required",
              ],
              [
                `/v1/tasks/${task}/receipt`,
                undefined,
                (await world.coworker()).token,
                "preprod_access_required",
              ],
              [
                `/v1/tasks/${task}/events`,
                { masumiPayment: payment },
                (await world.coworker()).token,
                "network_mismatch",
              ],
              [
                `/v1/tasks/${task}/x402-payments`,
                agent.pay("preprod-proof"),
                (await world.coworker()).token,
                "network_mismatch",
              ],
              ...(["retry", "refund", "resolve"] as const).map(
                (action) =>
                  [
                    `/v1/admin/task-payment-claims/${id}/${action}`,
                    { reason: "test" },
                    keys.preprod,
                    "network_mismatch",
                  ] as const,
              ),
            ] as const) {
              const response = await loaded.app.request(ORIGIN + path, {
                method: path.endsWith("/receipt") ? "GET" : "POST",
                headers: {
                  ...preprod,
                  authorization: "Bearer " + token,
                  "content-type": "application/json",
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
              });
              expect([
                path,
                response.status,
                (await response.json()).kind,
              ]).toEqual([path, 403, kind]);
            }
            expect(node.requests).toHaveLength(2);
            const replay = await send(
              loaded,
              world,
              `/v1/tasks/${task}/x402-payments`,
              stored,
              preprod,
            );
            expect(replay).toMatchObject({
              status: 400,
              body: { kind: "network_mismatch" },
            });
            expect(node.requests).toHaveLength(2);
            expect(await world.ledger()).toEqual(before);
            for (const network of ["mainnet", "preprod"] as const)
              expect(
                await world
                  .networkDb(network)
                  .job.count({ where: { workspaceId: owner.workspaceId } }),
              ).toBe(0);
          } finally {
            outside.useNode = false;
            vi.unstubAllGlobals();
          }
        }),
      MANY_REQUESTS,
    );

    it(
      "keeps the Mainnet Task payment outcomes on the split layout",
      async () =>
        withWorld(async (world) => {
          const owner = await world.person("split Mainnet task", credits, true);
          const task = await world.task(owner);
          const payment = (await masumiPayments(loaded, world))("split claim", {
            network: "Mainnet",
          });
          const agent = await x402Agent(loaded, world, "Mainnet");
          const { stubMasumiSyncHttp } = await import(
            "@/test/masumi-sync-http"
          );
          const node = stubMasumiSyncHttp();
          outside.useNode = true;
          try {
            expectCoreLog(
              "error",
              "Kept a database schema mismatch out of Sentry",
              2,
            );
            const before = await world.ledger();
            const claim = await send(
              loaded,
              world,
              `/v1/tasks/${task}/events`,
              { masumiPayment: payment },
              mainnet,
            );
            const x402 = await send(
              loaded,
              world,
              `/v1/tasks/${task}/x402-payments`,
              agent.pay("split-mainnet"),
              mainnet,
            );
            expect([claim.status, x402.status]).toEqual([500, 500]);
            expect(node.requests).toEqual([]);
            expect(await world.ledger()).toEqual(before);
          } finally {
            outside.useNode = false;
            vi.unstubAllGlobals();
          }
        }),
      MANY_REQUESTS,
    );

    function expectNothingWritten(answer: Sent) {
      expect(spent(answer, "mainnet")).toEqual([]);
      expect(spent(answer, "preprod")).toEqual([]);
      expect(answer.rows.mainnet.claims).toEqual([]);
      expect(answer.rows.preprod.claims).toEqual([]);
      expect(answer.rows.mainnet.usage).toEqual([]);
      expect(answer.rows.preprod.usage).toEqual([]);
      expect(answer.rows.events).toEqual([]);
    }

    // A Preprod charge cannot commit here yet (`crossingKey`). So the proof is
    // which Network the charge goes to: Preprod's rolls back and leaves
    // Mainnet's credits untouched, and a Mainnet charge without Mainnet
    // credits pauses the Task as out of credits.
    it(
      "charges a Task event's credits on the Network the request names, and only there",
      {
        timeout: MANY_REQUESTS,
      },
      () =>
        withWorld(async (world) => {
          const onMainnet = await world.person(
            "owner with Mainnet credits",
            { mainnet: 10 },
            true,
          );
          const onPreprod = await world.person(
            "owner with Preprod credits",
            { preprod: 20 },
            true,
          );
          const charge = async (
            owner: { id: string; workspaceId: string },
            headers?: Record<string, string>,
          ) =>
            send(
              loaded,
              world,
              `/v1/tasks/${await world.task(owner)}/events`,
              { credits: 1 },
              headers,
            );

          const namedPreprod = await charge(onMainnet, preprod);
          expect(namedPreprod).toMatchObject(crossingKey);
          expectNothingWritten(namedPreprod);

          for (const headers of [undefined, mainnet]) {
            const answer = await charge(onPreprod, headers);
            expect(answer).toMatchObject(outOfCredits);
            expect(spent(answer, "preprod")).toEqual([]);
          }

          const noHeader = await charge(onMainnet);
          expect(noHeader.status).toBe(201);
          expect(spent(noHeader, "mainnet")).toEqual([ONE_CREDIT]);
          expect(noHeader.rows.events.at(-1)?.network).toBe("mainnet");
          const namedMainnet = await charge(onMainnet, mainnet);
          expect(namedMainnet.status).toBe(201);
          expect(spent(namedMainnet, "mainnet")).toEqual([
            ONE_CREDIT,
            ONE_CREDIT,
          ]);
          expect(spent(namedMainnet, "preprod")).toEqual([]);
        }),
    );

    it(
      "asks the billed party for Preprod access: the Task's Organization, else its Owner",
      {
        timeout: MANY_REQUESTS,
      },
      () =>
        withWorld(async (world) => {
          const optedIn = await world.person("opted-in owner", credits, true);
          const plain = await world.person("owner not opted in", credits);
          const events = async (taskId: Promise<string>) =>
            `/v1/tasks/${await taskId}/events`;

          const personal = await send(
            loaded,
            world,
            await events(world.task(plain)),
            { credits: 1 },
            preprod,
          );
          expect(personal).toMatchObject(refused);
          expectNothingWritten(personal);

          // The Organization's flag is off; its member's own flag does not count.
          const closed = await world.organization(optedIn.id, credits, false);
          const inClosed = await send(
            loaded,
            world,
            await events(world.task(optedIn, closed)),
            { credits: 1 },
            preprod,
          );
          expect(inClosed).toMatchObject(refused);
          expectNothingWritten(inClosed);

          // The Organization's flag is on; its member needs none. The charge
          // passes the access check and reaches the event (`crossingKey`).
          const open = await world.organization(
            plain.id,
            { mainnet: 10 },
            true,
          );
          const inOpen = await send(
            loaded,
            world,
            await events(world.task(plain, open)),
            { credits: 1 },
            preprod,
          );
          expect(inOpen).toMatchObject(crossingKey);
          expectNothingWritten(inOpen);
        }),
    );

    it(
      "takes a Masumi payment's Network from its payload, and refuses a header that disagrees",
      {
        timeout: MANY_REQUESTS,
      },
      () =>
        withWorld(async (world) => {
          const optedIn = await world.person("opted-in owner", credits, true);
          const plain = await world.person("owner not opted in", credits);
          const payment = await masumiPayments(loaded, world);
          const paid = (network: string) => ({
            masumiPayment: payment(`${network} payment`, { network }),
          });
          const path = `/v1/tasks/${await world.task(optedIn)}/events`;

          for (const [named, headers] of [
            ["Preprod", mainnet],
            ["Mainnet", preprod],
          ] as const) {
            const answer = await send(
              loaded,
              world,
              path,
              paid(named),
              headers,
            );
            expect([named, answer.status, answer.body?.kind]).toEqual([
              named,
              mismatch.status,
              mismatch.body.kind,
            ]);
            expectNothingWritten(answer);
          }

          // No header: the payload alone names Preprod, on a deployment whose
          // `NETWORK` is Mainnet, and the Owner has no access to it.
          const answer = await send(
            loaded,
            world,
            `/v1/tasks/${await world.task(plain)}/events`,
            paid("Preprod"),
          );
          expect(answer).toMatchObject(refused);
          expectNothingWritten(answer);
        }),
    );
  },
);

it.runIf(enabled && onSplitLayout)(
  "keeps a Preprod API key scoped when missing production configuration disables Preprod",
  async () => {
    expectCoreLog(
      "warn",
      "Preprod is disabled because its Masumi configuration is incomplete",
    );
    const loaded = await load({
      NETWORK_PREPROD_ENABLED: "true",
      NODE_ENV: "production",
      SOKO_BOT_RUNTIME_ADAPTER: "in-process",
      PREPROD_REGISTRY_API_KEY: "",
    });
    const world = createWorld(loaded, ["mainnet"]);
    const { stubMasumiSyncHttp } = await import("@/test/masumi-sync-http");
    const node = stubMasumiSyncHttp();
    outside.useNode = true;
    try {
      const owner = await world.person("missing configuration", {}, true);
      const key = await loaded.fixture.createApiKey(owner.id, "soko_preprod_");
      const task = await world.task(owner);
      for (const path of [
        "/v1/registry/agents",
        "/v1/agents",
        `/v1/tasks/${task}/receipt`,
      ]) {
        const response = await loaded.app.request(ORIGIN + path, {
          headers: { authorization: "Bearer " + key },
        });
        expect([path, response.status, (await response.json()).kind]).toEqual([
          path,
          403,
          "preprod_off",
        ]);
      }
      expect(node.requests).toHaveLength(0);
    } finally {
      outside.useNode = false;
      vi.unstubAllGlobals();
      await world.remove();
    }
  },
  MANY_REQUESTS,
);
