/**
 * The Soko Bot's debit, on a real PostgreSQL at its own entry points: a
 * turn's settlement (`SokoBotControlPlane.expireTurn`, and `finishStaleTurn`
 * for a stale Preprod turn) and a charge outside any turn
 * (`chargeSokoBotCredits`, which the checks and Cuso's competitor check
 * call). For each: what it answers, every credit row, usage row, turn, bot
 * and billing notification it leaves, and the statements PostgreSQL
 * received, with each transaction's boundaries and isolation level.
 *
 * All of it is compared with `soko-bot-usage-spend.base.json`, which this
 * file wrote while it ran on `origin/main`'s code, before the debit moved
 * into the credits module:
 * RECORD_SOKO_BOT_USAGE_SPEND_BASE=true RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter core test src/services/soko-bot-usage-spend.postgres.test.ts
 * Without `RECORD_SOKO_BOT_USAGE_SPEND_BASE` the same command compares.
 *
 * It needs the database to itself, as CI gives each worker its own
 * (`POSTGRES_TEST_DATABASE_PER_WORKER`): another file's Serializable
 * transaction on the same database can make a settlement retry, and a retry
 * is a second transaction in the statements.
 *
 * Both layouts compare the committed Mainnet receipts with the same base.
 *
 * What runs after a settlement commits and is not the payer's, the delivery
 * of the turn and the log of its route, does nothing here; the low-balance
 * notice, which the charge decides, runs.
 */
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  configureSqlTables,
  sharedTable,
  sqlTableLayoutFromEnv,
} from "@sokosumi/database/sql-tables";
import { Client, type Pool } from "pg";
import { afterAll, describe, expect, it, onTestFinished, vi } from "vitest";
import { onSplitLayout } from "@/test/split-layout";

const background = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock("@vercel/functions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vercel/functions")>();
  const { observePool } = await import("@/test/spend-comparison");
  return {
    ...actual,
    attachDatabasePool: (pool: Pool) => {
      observePool(pool);
      actual.attachDatabasePool(pool);
    },
    waitUntil: (work: Promise<unknown>) => {
      background.push(work);
    },
  };
});
// Settlement publishes over Ably; the test env has no real key.
vi.mock("@/lib/ably/client", async () =>
  (await import("@/test/ably-client")).fakeAblyClientModule(),
);
/** Armed by a case: the settlement fails after its debit, inside its transaction. */
const failAfterTheDebit = vi.hoisted(() => ({ armed: false }));
vi.mock("./soko-bot-delivery.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./soko-bot-delivery.service")>();
  return {
    ...actual,
    enqueueSokoBotDelivery: async (
      ...args: Parameters<typeof actual.enqueueSokoBotDelivery>
    ) => {
      if (failAfterTheDebit.armed) {
        failAfterTheDebit.armed = false;
        throw new Error("The settlement failed after its debit");
      }
      return actual.enqueueSokoBotDelivery(...args);
    },
    deliverSokoBotTurnOutbox: async () => undefined,
  };
});
vi.mock("@/lib/soko-bot/route-outcome", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/soko-bot/route-outcome")>()),
  logSokoBotRouteOutcome: async () => undefined,
}));

import { CreditBucketReferenceType, type Prisma } from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import { creditBucketRepository } from "@sokosumi/database/repositories";
import { CMO_SOKO_BOT_VERSION_IDS } from "@sokosumi/soko-bot";
import { convertCreditsToCents } from "@sokosumi/utils";
import { createPersonalWorkspace } from "@/helpers/personal-workspace";
import { createNetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import {
  chargeSokoBotCredits,
  requireSokoBotTurnFunding,
  sokoBotUsageCents,
} from "@/services/soko-bot-billing.service";
import { SokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import {
  baseFile,
  nextMillisecond,
  observing,
  plain,
  type Statement,
  statements,
  thrown,
} from "@/test/spend-comparison";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

/**
 * A case loads Core's services and creates workspaces through the product's
 * own path: seconds on a loaded machine, past Vitest's 10 s hook limit on
 * CI's runner.
 */
const CASE_TIMEOUT = 60_000;
const DAY = 86_400_000;
const HOUR = 3_600_000;

/** What a turn's model cost, and what its settlement bills for it. */
const COST_USD_MICROS = 2_000_000n;
const PRICE = sokoBotUsageCents(COST_USD_MICROS, true);
/** A check's price in credits, outside any turn. */
const CHECK_CREDITS = 3;
const CHECK_PRICE = convertCreditsToCents(CHECK_CREDITS);

const { expectAsOnBase } = baseFile(
  fileURLToPath(new URL("./soko-bot-usage-spend.base.json", import.meta.url)),
  process.env.RECORD_SOKO_BOT_USAGE_SPEND_BASE === "true",
);

const mainnet = () => createNetworkScope("mainnet").networkDb;

/** The runtime: no case's turn has a session to cancel. */
const plane = () =>
  new SokoBotControlPlane({
    createSession: async () => {
      throw new Error("not used");
    },
    streamEvents: () => {
      throw new Error("not used");
    },
    cancelTurn: async () => undefined,
    resetSession: async () => undefined,
    inspectSession: async () => ({
      healthy: true,
      runtimeVersion: "test",
      sessionStatus: "waiting",
    }),
  });

/** Random values in a statement or a row, each under a name. */
const labels = new Map<string, string>();
const userIds: string[] = [];
const organizationIds: string[] = [];
const workspaceIds: string[] = [];
const projectIds: string[] = [];
const botIds: string[] = [];

type BilledTo = { userId: string } | { organizationId: string };
interface Payer {
  billedTo: BilledTo;
  /** The member a turn runs as. */
  memberId: string;
  botId: string;
  bucketIds: string[];
}

async function createUser(name: string): Promise<string> {
  const id = randomUUID();
  await prisma.user.create({
    data: {
      id,
      name,
      email: `${id}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  userIds.push(id);
  labels.set(id, `<${name}>`);
  return id;
}

/** A bucket of the payer's credits, under a name the rows are read back by. */
async function grant(
  name: string,
  owner: BilledTo,
  bucket: {
    cents: bigint;
    expiresInDays: number;
    projectId?: string;
    referenceType?: CreditBucketReferenceType;
  },
): Promise<string> {
  const created = await mainnet().transaction.create({
    data: {
      amount: bucket.cents,
      ...owner,
      sourceCreditBucket: {
        create: {
          amount: bucket.cents,
          ...owner,
          expiresAt: new Date(Date.now() + bucket.expiresInDays * DAY),
          ...(bucket.projectId && { projectId: bucket.projectId }),
          ...(bucket.referenceType && { referenceType: bucket.referenceType }),
        },
      },
    },
    select: { id: true, sourceCreditBucket: { select: { id: true } } },
  });
  labels.set(created.id, `<grant of ${name}>`);
  const bucketId = created.sourceCreditBucket?.id;
  if (!bucketId) throw new Error("The grant made no bucket");
  labels.set(bucketId, `<bucket ${name}>`);
  return bucketId;
}

async function bot(
  name: string,
  data: {
    userId: string | null;
    workspaceId: string;
    projectId?: string;
    versionId?: string;
  },
): Promise<string> {
  const { id } = await prisma.sokoBot.create({ data, select: { id: true } });
  botIds.push(id);
  labels.set(id, `<${name}'s bot>`);
  return id;
}

/**
 * A person in the personal workspace the product creates, with their
 * personal bot and their own buckets in place of the sign-up and free-plan
 * grants, which other writers make.
 */
async function person(
  name: string,
  buckets: Array<{ name: string; cents: bigint; expiresInDays: number }>,
): Promise<Payer> {
  const userId = await createUser(name);
  const workspace = await createPersonalWorkspace(userId);
  workspaceIds.push(workspace.id);
  labels.set(workspace.id, `<${name}'s workspace>`);
  await mainnet().creditBucket.deleteMany({ where: { userId } });
  await mainnet().transaction.deleteMany({ where: { userId } });
  const bucketIds: string[] = [];
  for (const bucket of buckets)
    bucketIds.push(
      await grant(`${bucket.name} of ${name}`, { userId }, bucket),
    );
  return {
    billedTo: { userId },
    memberId: userId,
    botId: await bot(name, { userId, workspaceId: workspace.id }),
    bucketIds,
  };
}

/**
 * A seated member of an Organization with a Project's shared bot, and
 * Project credits beside the pool: the Project's credits pay first, then the
 * pool, soonest expiry first. As `cuso`, the bot is the Project's Cuso: in
 * free hiring while nobody paid for him, paid when the Project's credits are
 * his Tester credits (ADR 0068).
 */
async function organization(
  name: string,
  cuso?: "in free hiring" | "paid",
): Promise<Payer> {
  const userId = await createUser(`${name}'s member`);
  const organizationId = randomUUID();
  const workspaceId = randomUUID();
  await prisma.organization.create({
    data: {
      id: organizationId,
      name: "Soko Bot spend fixture",
      slug: organizationId,
      workspace: { create: { id: workspaceId } },
      members: {
        create: { userId, role: "owner", seatAssignedAt: new Date() },
      },
    },
  });
  organizationIds.push(organizationId);
  workspaceIds.push(workspaceId);
  labels.set(organizationId, `<${name}>`);
  labels.set(workspaceId, `<${name}'s workspace>`);
  const project = await prisma.project.create({
    data: { workspaceId, name: "Soko Bot spend Project" },
    select: { id: true },
  });
  projectIds.push(project.id);
  labels.set(project.id, `<${name}'s Project>`);
  const owner = { organizationId };
  // Granted latest-expiring first: the spend order is not the creation order.
  const bucketIds = [
    await grant(`pool later of ${name}`, owner, {
      cents: PRICE,
      expiresInDays: 20,
    }),
    await grant(`pool soon of ${name}`, owner, {
      cents: PRICE / 2n,
      expiresInDays: 5,
    }),
    await grant(`Project credits of ${name}`, owner, {
      cents: PRICE / 4n,
      expiresInDays: 40,
      projectId: project.id,
      ...(cuso === "paid" && {
        referenceType: CreditBucketReferenceType.CMO_TESTER_CREDITS,
      }),
    }),
  ];
  return {
    billedTo: owner,
    memberId: userId,
    botId: await bot(name, {
      userId: null,
      workspaceId,
      projectId: project.id,
      ...(cuso && { versionId: CMO_SOKO_BOT_VERSION_IDS[0] }),
    }),
    bucketIds,
  };
}

/** A running turn of the payer's bot, asked by its member, that ran the model. */
async function turn(
  payer: Payer,
  name: string,
  network: "mainnet" | "preprod" = "mainnet",
): Promise<string> {
  const bot = await prisma.sokoBot.findUniqueOrThrow({
    where: { id: payer.botId },
    select: { workspaceId: true },
  });
  const { id } = await prisma.sokoBotTurn.create({
    data: {
      network,
      sokoBotId: payer.botId,
      requestedByUserId: payer.memberId,
      workspaceId: bot.workspaceId,
      source: "CHAT",
      status: "RUNNING",
      clientTurnId: `soko-bot-usage-spend-${name}`,
      userMessage: "Fixture turn",
      capabilityNames: [],
      leaseToken: "fixture-lease",
      leaseExpiresAt: new Date(Date.now() + HOUR),
      deadlineAt: new Date(Date.now() + HOUR),
      // No start time: the settled duration would be the wall clock's.
      startedAt: null,
      costUsdMicros: COST_USD_MICROS,
      usage: { inputTokens: 100, outputTokens: 10, costUsd: 2 },
    },
    select: { id: true },
  });
  labels.set(id, `<turn ${name}>`);
  return id;
}

/** Every credit row of the payer, and every usage row, turn and bot of its bot. */
async function rows(payer: Payer) {
  const db = mainnet();
  const where = { sokoBotId: payer.botId };
  return {
    buckets: await db.creditBucket.findMany({
      where: payer.billedTo,
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        amount: true,
        projectId: true,
        consumptions: {
          orderBy: { id: "asc" },
          select: { amount: true, transactionId: true },
        },
      },
    }),
    transactions: await db.transaction.findMany({
      where: { ...payer.billedTo, amount: { lt: 0n } },
      orderBy: { id: "asc" },
    }),
    // In the order the history reader takes a debit's first consumption.
    consumptions: await db.creditConsumption.findMany({
      where: { transaction: payer.billedTo },
      orderBy: [{ transactionId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    }),
    // A Network table: on the split layout it is Mainnet's, not the shared one.
    usage: await db.sokoBotUsage.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    turns: await prisma.sokoBotTurn.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    bot: await prisma.sokoBot.findUniqueOrThrow({ where: { id: payer.botId } }),
    notifications: await prisma.notification.findMany({
      where: { userId: payer.memberId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        kind: true,
        referenceId: true,
        eventId: true,
        messageKey: true,
        messageParams: true,
      },
    }),
  };
}

/**
 * One observed call: its answer, the statements it sent, and the rows it
 * left. What the call left to run after it, the notices of a settlement,
 * ends before the rows are read.
 *
 * That work ends inside the observation: it runs beside the call (the
 * low-balance notice's publish), so a window closed when the call returns
 * would cut its statements wherever the scheduler stood. Work an earlier
 * step left ends before the window opens.
 */
async function observe(payer: Payer, call: () => Promise<unknown>) {
  await drainBackground();
  const started = await nextMillisecond();
  const { outcome, log } = await observing(async () => {
    try {
      return await call();
    } finally {
      await drainBackground();
    }
  });
  const ended = Date.now();
  const left = await rows(payer);
  // Before `plain` turns every time into `<time>`: a debit is one instant, its
  // update time and each consumption's creation time equal its creation time.
  for (const debit of left.transactions) {
    const times = [
      debit.updatedAt,
      ...left.consumptions
        .filter((consumption) => consumption.transactionId === debit.id)
        .map((consumption) => consumption.createdAt),
    ];
    expect(times.map((time) => time.getTime())).toEqual(
      times.map(() => debit.createdAt.getTime()),
    );
  }
  const sent = statements(log);
  // Also before `plain` renumbers the ids: a debit's consumptions sort by id
  // in the order its write bound the buckets, which is the order they paid
  // in, so the history reader names the Project of the bucket that paid
  // first (`transaction-history.ts`).
  const bucketsInIdOrder = left.transactions.map((debit) =>
    left.consumptions
      .filter((consumption) => consumption.transactionId === debit.id)
      .map((consumption) => consumption.bucketId),
  );
  // A debit written before the call was held to it when it was written.
  expect(bucketsInIdOrder).toEqual(
    left.transactions.map(
      (debit, at) =>
        bucketsAsBound(sent.transactions, debit.id) ?? bucketsInIdOrder[at],
    ),
  );
  // And a receipt is never older than its debit: it is written after it.
  const debitTime = new Map(
    left.transactions.map((debit) => [debit.id, debit.createdAt.getTime()]),
  );
  const receiptsNotBeforeTheirDebit = left.usage.map((usage) => {
    const debitAt = usage.transactionId
      ? debitTime.get(usage.transactionId)
      : undefined;
    return debitAt !== undefined && usage.createdAt.getTime() >= debitAt;
  });
  expect(receiptsNotBeforeTheirDebit).not.toContain(false);
  const debitRows = [...left.transactions, ...left.consumptions];
  const debitTimes = [
    ...left.transactions.flatMap((row) => [row.createdAt, row.updatedAt]),
    ...left.consumptions.map((row) => row.createdAt),
  ];
  return plain(
    {
      result: outcome,
      statements: sent,
      rows: left,
      // What `plain` hides of the debit's rows: the kind of id, that their
      // times are this call's, the order of a debit's consumption ids and
      // how a receipt's time relates to its debit's.
      debit: {
        uuidVersions: debitRows.map((row) => row.id.charAt(14)),
        timesWithinTheCall: debitTimes.map(
          (time) => time.getTime() >= started && time.getTime() <= ended,
        ),
        bucketsInIdOrder,
        receiptsNotBeforeTheirDebit,
      },
    },
    labels,
  );
}

/**
 * The buckets a debit's consumption insert bound, in the order it bound
 * them: Prisma's on `origin/main` (five values a row), `recordSpend`'s now
 * (an array of bucket ids). Null for a debit written before the call.
 */
function bucketsAsBound(
  transactions: readonly Statement[][],
  debitId: string,
): unknown[] | null {
  for (const { sql, values } of transactions.flat()) {
    if (!sql.startsWith('INSERT INTO "public"."credit_consumption" ')) continue;
    if (values[1] === debitId && Array.isArray(values[4])) return values[4];
    const rows = Array.from({ length: values.length / 5 }, (_unused, row) =>
      values.slice(row * 5, row * 5 + 5),
    );
    if (rows.some((row) => row[4] === debitId))
      return rows.filter((row) => row[4] === debitId).map((row) => row[3]);
  }
  return null;
}

async function drainBackground() {
  while (background.length > 0) await Promise.allSettled(background.splice(0));
}

function settled(result: PromiseSettledResult<unknown>) {
  return result.status === "fulfilled"
    ? result.value
    : { threw: thrown(result.reason) };
}

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

type PrepareConsumption = typeof creditBucketRepository.prepareConsumption;

/** Runs `call` with the bucket choice of every spend wrapped by `around`. */
async function aroundTheBucketChoice<T>(
  around: (
    prepare: PrepareConsumption,
    args: Parameters<PrepareConsumption>,
  ) => ReturnType<PrepareConsumption>,
  call: () => Promise<T>,
): Promise<T> {
  const prepare = creditBucketRepository.prepareConsumption;
  const spy = vi
    .spyOn(creditBucketRepository, "prepareConsumption")
    .mockImplementation((...args) => around(prepare, args));
  try {
    return await call();
  } finally {
    spy.mockRestore();
  }
}

/**
 * Two turns of one person's bot settle for credits that pay one and a half.
 * The turn `holding` settles first and holds its transaction open after it
 * has chosen its buckets, until the other turn's settlement has ended. The
 * held one then writes on rows the other changed, and retries.
 */
async function race(name: string, holding: 0 | 1) {
  const payer = await person(name, [
    { name: "only bucket", cents: (PRICE * 3n) / 2n, expiresInDays: 20 },
  ]);
  const turns = [
    await turn(payer, `${name} 0`),
    await turn(payer, `${name} 1`),
  ] as const;
  const control = plane();
  const chosen = gate();
  const release = gate();
  let prepared = 0;
  let outcomes: Promise<unknown> = Promise.resolve();
  try {
    return await aroundTheBucketChoice(
      async (prepare, args) => {
        const consumptions = await prepare(...args);
        prepared += 1;
        if (prepared === 1) {
          chosen.open();
          await release.opened;
        }
        return consumptions;
      },
      () =>
        observe(payer, async () => {
          const first = control.expireTurn(turns[holding]);
          const firstEnded = Promise.allSettled([first]);
          outcomes = firstEnded;
          // A settlement that fails before its bucket choice ends the wait,
          // and the race: the second would hold at the gate in its place.
          await Promise.race([chosen.opened, firstEnded]);
          if (prepared === 0) return (await firstEnded).map(settled);
          const second = control.expireTurn(turns[holding === 0 ? 1 : 0]);
          const both = Promise.allSettled([first, second]);
          outcomes = both;
          await Promise.allSettled([second]);
          release.open();
          return (await both).map(settled);
        }),
    );
  } finally {
    chosen.open();
    release.open();
    await outcomes;
  }
}

const DEBIT_INSERT = /^INSERT INTO "public"\."Transaction" /;

/**
 * The held settlement's first attempt: PostgreSQL cancels it at the debit's
 * first statement, the insert of its Transaction row, because the other
 * settlement committed on the credits it read. On `origin/main` that insert
 * is Prisma's, here `recordSpend`'s; both bind the same six values in the
 * same order (id, two times, amount, user, Organization), which are compared
 * whole, as is every statement before it and the retry.
 */
function withTheCancelledDebitInsert(
  transactions: Statement[][],
): Statement[][] {
  return transactions.map((transaction) => {
    const cancelled = transaction.at(-2);
    if (
      transaction.at(-1)?.sql !== "ROLLBACK" ||
      !cancelled ||
      !DEBIT_INSERT.test(cancelled.sql)
    )
      return transaction;
    return [
      ...transaction.slice(0, -2),
      {
        sql: "<the debit's Transaction insert, where PostgreSQL cancelled it>",
        values: cancelled.values,
      },
      ...transaction.slice(-1),
    ];
  });
}

describe.skipIf(!enabled)(
  "the Soko Bot's debit, as on origin/main (PostgreSQL)",
  () => {
    afterAll(async () => {
      failAfterTheDebit.armed = false;
      while (background.length > 0)
        await Promise.allSettled(background.splice(0));
      const billedTo = {
        OR: [
          { userId: { in: userIds } },
          { organizationId: { in: organizationIds } },
        ],
      };
      await prisma.notification.deleteMany({
        where: { userId: { in: userIds } },
      });
      await mainnet().sokoBotUsage.deleteMany({
        where: { sokoBotId: { in: botIds } },
      });
      await prisma.sokoBotTurn.deleteMany({
        where: { sokoBotId: { in: botIds } },
      });
      await prisma.sokoBot.deleteMany({ where: { id: { in: botIds } } });
      const db = mainnet();
      await db.creditConsumption.deleteMany({
        where: { transaction: billedTo },
      });
      await db.creditBucket.deleteMany({ where: billedTo });
      await db.transaction.deleteMany({ where: billedTo });
      await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
      await prisma.workspace.deleteMany({
        where: { id: { in: workspaceIds } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: organizationIds } },
      });
      // The free plan `createPersonalWorkspace` grants is not tied to the user.
      await prisma.subscription.deleteMany({
        where: { referenceId: { in: [...userIds, ...organizationIds] } },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }, CASE_TIMEOUT);

    it(
      "uses a prior release's turn receipt for replay",
      async () => {
        const payer = await person("prior receipt", [
          { name: "personal", cents: PRICE * 2n, expiresInDays: 30 },
        ]);
        const id = await turn(payer, "rolling");
        const debit = await mainnet().transaction.create({
          data: {
            userId: payer.memberId,
            amount: -PRICE,
            creditConsumptions: {
              create: { bucketId: payer.bucketIds[0]!, amount: PRICE },
            },
          },
        });
        await mainnet().sokoBotUsage.create({
          data: {
            userId: payer.memberId,
            sokoBotId: payer.botId,
            referenceId: id,
            idempotencyKey: `soko-bot-turn:${id}`,
            cents: PRICE,
            transactionId: debit.id,
          },
        });
        await plane().expireTurn(id);
        await drainBackground();
        const result = await rows(payer);
        expect(result.transactions).toMatchObject([
          { id: debit.id, amount: -PRICE },
        ]);
        expect(result.usage).toMatchObject([
          { transactionId: debit.id, cents: PRICE },
        ]);
      },
      CASE_TIMEOUT,
    );

    it.each([
      ["settlement", "settlement", 0],
      ["settlement", "settlement", 1],
      ["settlement", "cancel", 0],
      ["settlement", "cancel", 1],
    ] as const)(
      "serializes one turn under %s and %s with caller %i first",
      async (left, right, first) => {
        const payer = await person("one-turn race", [
          { name: "personal", cents: PRICE * 2n, expiresInDays: 30 },
        ]);
        const id = await turn(payer, "racing");
        const control = plane();
        const operations = [left, right].map(
          (kind) => () =>
            kind === "cancel"
              ? control.cancelTurn(payer.memberId, id)
              : control.expireTurn(id),
        );
        const lock = new Client({ connectionString: process.env.DATABASE_URL });
        await lock.connect();
        const pending: Promise<unknown>[] = [];
        try {
          await lock.query("BEGIN");
          const table = sharedTable("soko_bot_turn").text;
          await lock.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [
            id,
          ]);
          const observed = await observing(async () => {
            for (const index of [first, 1 - first]) {
              pending.push(operations[index]!());
              await vi.waitFor(
                async () => {
                  await lock.query("SELECT pg_stat_clear_snapshot()");
                  const { rows } = await lock.query<{ waiting: number }>(
                    `SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0`,
                  );
                  expect(rows[0]?.waiting).toBe(pending.length);
                },
                { timeout: 5000, interval: 10 },
              );
            }
            await lock.query("COMMIT");
            return Promise.all(pending);
          });
          expect(observed.outcome).toBeInstanceOf(Array);
          await drainBackground();
          const leftRows = await rows(payer);
          expect(leftRows.usage).toMatchObject([
            {
              referenceId: id,
              idempotencyKey: `soko-bot-turn:${id}`,
              cents: PRICE,
            },
          ]);
          expect(leftRows.transactions).toHaveLength(1);
          expect(leftRows.consumptions).toMatchObject([{ amount: PRICE }]);
          expect(leftRows.turns).toMatchObject([
            { status: "FAILED", errorKind: "turn_deadline_exceeded" },
          ]);
          const expected =
            right === "cancel"
              ? [first === 0 ? true : undefined, first === 0 ? undefined : true]
              : [true, false];
          expect(observed.outcome).toEqual(expected);
        } finally {
          await lock.query("ROLLBACK");
          await Promise.allSettled(pending);
          await lock.end();
        }
      },
      CASE_TIMEOUT,
    );

    it.runIf(onSplitLayout)(
      "charges a previously admitted Preprod turn on Mainnet and notifies its wallet owner",
      async () => {
        onTestFinished(
          configureSqlTables({
            ...sqlTableLayoutFromEnv(process.env),
            preprodOn: true,
          }),
        );
        const env = await import("@/config/env");
        const getEnv = vi
          .spyOn(env, "getEnv")
          .mockReturnValue({ ...env.getEnv(), NETWORK_PREPROD_ENABLED: true });
        const control = await import("@/helpers/preprod-control");
        const keys = [
          control.PREPROD_PAUSE_KEY,
          control.PREPROD_GENERATION_KEY,
        ];
        const saved = await prisma.syncMetadata.findMany({
          where: { key: { in: keys } },
        });
        try {
          for (const [key, cursorId] of [
            [keys[0]!, "open"],
            [keys[1]!, "7"],
          ]) {
            await prisma.syncMetadata.upsert({
              where: { key },
              create: { key, cursorId, lastSyncedAt: new Date() },
              update: { cursorId },
            });
          }
          const payer = await person("Preprod wallet owner", [
            { name: "crossing", cents: PRICE / 2n, expiresInDays: 30 },
          ]);
          const id = await turn(payer, "admitted", "preprod");
          await prisma.sokoBotTurn.update({
            where: { id },
            data: { preprodGeneration: 7 },
          });
          expect(await plane().expireTurn(id)).toBe(true);
          await drainBackground();
          const result = await rows(payer);
          expect(result.usage).toMatchObject([
            { referenceId: id, cents: PRICE / 2n },
          ]);
          expect(result.notifications).toMatchObject([
            { messageKey: "Notifications.Billing.lowBalance" },
          ]);
          expect(
            await createNetworkScope("preprod").networkDb.sokoBotUsage.count({
              where: { sokoBotId: payer.botId },
            }),
          ).toBe(0);
        } finally {
          await prisma.syncMetadata.deleteMany({
            where: { key: { in: keys } },
          });
          await prisma.syncMetadata.createMany({ data: saved });
          getEnv.mockRestore();
        }
      },
      CASE_TIMEOUT,
    );

    it.each([
      "funded",
      "empty",
      "recent large turn",
      "open shortfall",
      "free hiring",
      "paused Cuso",
      "Organization pool",
      "member without Seat",
    ] as const)(
      "keeps the Mainnet funding decision for %s",
      async (scenario) => {
        const cuso =
          scenario === "free hiring" ||
          scenario === "paused Cuso" ||
          scenario === "member without Seat";
        const payer =
          cuso || scenario === "Organization pool"
            ? await organization(scenario, cuso ? "in free hiring" : undefined)
            : await person(
                scenario,
                scenario === "empty"
                  ? []
                  : [{ name: "funding", cents: PRICE, expiresInDays: 30 }],
              );
        if (scenario === "paused Cuso") {
          const { projectId } = await prisma.sokoBot.findUniqueOrThrow({
            where: { id: payer.botId },
            select: { projectId: true },
          });
          await prisma.marketingStrategy.create({
            data: { projectId: projectId!, plan: {}, approvedAt: new Date() },
          });
        }
        if (scenario === "member without Seat") {
          const organizationId = (payer.billedTo as { organizationId: string })
            .organizationId;
          await prisma.subscription.create({
            data: {
              referenceId: organizationId,
              plan: "starter",
              status: "active",
              seats: 1,
              periodStart: new Date(),
              periodEnd: new Date(Date.now() + DAY),
              stripeSubscriptionId: "sub_" + organizationId,
            },
          });
          await prisma.member.updateMany({
            where: { userId: payer.memberId },
            data: { seatAssignedAt: null },
          });
        }
        if (scenario === "recent large turn" || scenario === "open shortfall") {
          const id = await turn(payer, scenario, "preprod");
          await prisma.sokoBotTurn.update({
            where: { id },
            data: {
              status: "COMPLETED",
              completedAt: new Date(),
              costUsdMicros: COST_USD_MICROS * 3n,
              errorKind:
                scenario === "open shortfall" ? "insufficient_credits" : null,
            },
          });
          const transaction = await mainnet().transaction.create({
            data: { userId: payer.memberId, amount: -PRICE * 2n },
          });
          await mainnet().sokoBotUsage.create({
            data: {
              sokoBotId: payer.botId,
              userId: payer.memberId,
              idempotencyKey: `soko-bot-turn:${id}`,
              referenceId: id,
              transactionId: transaction.id,
              cents: scenario === "recent large turn" ? PRICE * 2n : PRICE / 2n,
            },
          });
        }
        const member =
          scenario === "Organization pool" ||
          scenario === "paused Cuso" ||
          scenario === "free hiring"
            ? null
            : payer.memberId;
        expectAsOnBase(
          "funding " + scenario,
          await observe(payer, () =>
            requireSokoBotTurnFunding(member, payer.botId),
          ),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "charges a person's turn to their credits, soonest expiry first",
      async () => {
        const payer = await person("funded person", [
          { name: "expiring later", cents: PRICE, expiresInDays: 20 },
          { name: "expiring first", cents: PRICE / 2n, expiresInDays: 1 },
        ]);
        const turnId = await turn(payer, "funded");

        expectAsOnBase(
          "a person, a turn funded in full",
          await observe(payer, () => plane().expireTurn(turnId)),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "charges a Project bot's turn to the Project's credits, then the pool",
      async () => {
        const payer = await organization("funded Organization");
        const turnId = await turn(payer, "Organization");

        expectAsOnBase(
          "a Project bot of an Organization, a turn funded in full",
          await observe(payer, () => plane().expireTurn(turnId)),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "charges what is left when the credits are below the price",
      async () => {
        const payer = await person("short person", [
          { name: "expiring later", cents: PRICE / 4n, expiresInDays: 20 },
          { name: "expiring first", cents: PRICE / 4n, expiresInDays: 1 },
        ]);
        const turnId = await turn(payer, "partial");

        expectAsOnBase(
          "a person, a turn funded in part",
          await observe(payer, () => plane().expireTurn(turnId)),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "writes no usage and no debit for an empty wallet",
      async () => {
        const payer = await person("empty person", []);
        const turnId = await turn(payer, "empty");

        expectAsOnBase(
          "a person, an empty wallet",
          await observe(payer, () => plane().expireTurn(turnId)),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "throws when the credits go after the balance covered the charge, and keeps nothing",
      async () => {
        const payer = await person("drained person", [
          { name: "only bucket", cents: PRICE * 2n, expiresInDays: 20 },
        ]);
        const turnId = await turn(payer, "drained");

        expectAsOnBase(
          "a person, credits gone after the balance read",
          await aroundTheBucketChoice(
            async (prepare, args) => {
              // Inside the settlement's transaction, between its two reads.
              const tx = args[4] as Prisma.TransactionClient;
              const bucket =
                createNetworkScope("mainnet").networkTable("credit_bucket");
              await tx.$executeRaw`UPDATE ${bucket} SET "amount" = ${0n}, "updatedAt" = ${new Date()} WHERE ${bucket}."id" IN (${PrismaRaw.join(payer.bucketIds)})`;
              return prepare(...args);
            },
            () => observe(payer, () => plane().expireTurn(turnId)),
          ),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "rolls the debit back with the turn's settlement",
      async () => {
        const payer = await person("rolled back person", [
          { name: "only bucket", cents: PRICE * 2n, expiresInDays: 20 },
        ]);
        const turnId = await turn(payer, "rolled back");
        failAfterTheDebit.armed = true;
        try {
          expectAsOnBase(
            "a person, the settlement fails after its debit",
            await observe(payer, () => plane().expireTurn(turnId)),
          );
        } finally {
          // On the split layout the settlement stops before the debit.
          failAfterTheDebit.armed = false;
        }
      },
      CASE_TIMEOUT,
    );

    it(
      "writes no usage and no debit for a stale Preprod turn",
      async () => {
        const payer = await person("Preprod person", [
          { name: "only bucket", cents: PRICE * 2n, expiresInDays: 20 },
        ]);
        const turnId = await turn(payer, "stale Preprod", "preprod");

        // Settled before any usage check: compared on both layouts.
        expectAsOnBase(
          "a person, a stale Preprod turn",
          await observe(payer, () => plane().finishStaleTurn(turnId)),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "charges a check outside any turn to a Project bot's Organization",
      async () => {
        const payer = await organization("checked Organization");

        expectAsOnBase(
          "a Project bot of an Organization, a check",
          await observe(payer, () =>
            chargeSokoBotCredits({
              sokoBotId: payer.botId,
              key: "soko-bot-usage-spend-check",
              credits: CHECK_CREDITS,
            }),
          ),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "answers a check charged before with its usage, without charging again",
      async () => {
        const payer = await person("replaying person", [
          { name: "only bucket", cents: CHECK_PRICE * 3n, expiresInDays: 20 },
        ]);
        const check = () =>
          chargeSokoBotCredits({
            sokoBotId: payer.botId,
            key: "soko-bot-usage-spend-replay",
            credits: CHECK_CREDITS,
          });
        await check();
        // The first charge's times lie before the observed call, also in
        // milliseconds: the debit's times are read against the call's.
        const charged = Date.now();
        while (Date.now() <= charged)
          await new Promise((resolve) => setTimeout(resolve, 1));

        expectAsOnBase(
          "a person, a check charged before",
          await observe(payer, check),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "charges two turns racing for the same credits, the second created settling first",
      async () => {
        expectAsOnBase(
          "a person, two turns race, the first created holds",
          await race("first holds", 0),
          withTheCancelledDebitInsert,
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "charges two turns racing for the same credits, the first created settling first",
      async () => {
        expectAsOnBase(
          "a person, two turns race, the second created holds",
          await race("second holds", 1),
          withTheCancelledDebitInsert,
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "charges nothing for a check without a price, before any usage check",
      async () => {
        const payer = await person("unpriced person", [
          { name: "only bucket", cents: CHECK_PRICE, expiresInDays: 20 },
        ]);

        // Returns before the usage check: compared on both layouts.
        expectAsOnBase(
          "a person, a check without a price",
          await observe(payer, () =>
            chargeSokoBotCredits({
              sokoBotId: payer.botId,
              key: "soko-bot-usage-spend-unpriced",
              credits: 0,
            }),
          ),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "answers a check charged in part before with its shortfall, without charging again",
      async () => {
        const payer = await person("short replaying person", [
          { name: "only bucket", cents: CHECK_PRICE / 2n, expiresInDays: 20 },
        ]);
        const check = () =>
          chargeSokoBotCredits({
            sokoBotId: payer.botId,
            key: "soko-bot-usage-spend-short-replay",
            credits: CHECK_CREDITS,
          });
        await check();
        // As in the replay above: the first charge's times lie before the call.
        const charged = Date.now();
        while (Date.now() <= charged)
          await new Promise((resolve) => setTimeout(resolve, 1));

        expectAsOnBase(
          "a person, a check charged in part before",
          await observe(payer, check),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "charges nothing for a check of a Cuso in free hiring",
      async () => {
        const payer = await organization(
          "free hiring Organization",
          "in free hiring",
        );

        expectAsOnBase(
          "a Cuso in free hiring, a check",
          await observe(payer, () =>
            chargeSokoBotCredits({
              sokoBotId: payer.botId,
              key: "soko-bot-usage-spend-free-hiring",
              credits: CHECK_CREDITS,
            }),
          ),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "charges a paid Cuso's check to his Tester credits, then the pool",
      async () => {
        const payer = await organization("paid Cuso Organization", "paid");

        expectAsOnBase(
          "a paid Cuso, a check",
          await observe(payer, () =>
            chargeSokoBotCredits({
              sokoBotId: payer.botId,
              key: "soko-bot-usage-spend-paid-cuso",
              // More than his Tester credits: the pool pays the rest.
              credits: 100,
            }),
          ),
        );
      },
      CASE_TIMEOUT,
    );
  },
);
