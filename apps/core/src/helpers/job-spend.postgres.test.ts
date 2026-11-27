/**
 * The Job hire's charge, on a real PostgreSQL at its own entry point
 * (`createAgentJobForUser`, which the Agent hire, the Task hire and the Soko
 * Bot decision apply call): what it answers, every row it writes (the Job,
 * its event and input, the Agent's job counter, the debit and its
 * consumptions), the seller call, the low-balance alert and the purchase call
 * in their order, and the statements PostgreSQL received, with each
 * transaction's boundaries and isolation level. Only what leaves Core is
 * stubbed: the seller, the purchase registration and the alert.
 *
 * All of it is compared with `job-spend.base.json`, which this file wrote
 * while it ran on `origin/main`'s code, before the charge moved into the
 * credits module, once on each layout:
 * RECORD_JOB_SPEND_BASE=true RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter core test src/helpers/job-spend.postgres.test.ts
 * Without `RECORD_JOB_SPEND_BASE` the same command compares.
 *
 * It needs the database to itself, as CI gives each worker its own
 * (`POSTGRES_TEST_DATABASE_PER_WORKER`): another file's Serializable
 * transaction on the same database can make the hire retry, and a retry is
 * a second transaction in the statements.
 *
 * On the split layout a hire stops at its credit cost read, which goes
 * through the shared client (ticket 25), before any charge. `origin/main`
 * stops at the same statement, with the same rows.
 */
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client, type Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/functions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vercel/functions")>();
  const { observePool } = await import("@/test/spend-comparison");
  return {
    ...actual,
    attachDatabasePool: (pool: Pool) => {
      observePool(pool);
      actual.attachDatabasePool(pool);
    },
  };
});

/** What a hire reaches outside the database, in the order it reached it. */
const outside = vi.hoisted(() => ({
  calls: [] as Array<{ call: string; with: unknown }>,
  seller: {
    /** Runs inside the seller's call, before it answers. */
    during: undefined as undefined | (() => Promise<void>),
  },
}));
vi.mock("@sokosumi/masumi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sokosumi/masumi")>();
  const { ok } = await import("neverthrow");
  return {
    ...actual,
    createAgentClient: () => ({
      startPaidAgentJob: async (
        agent: { blockchainIdentifier: string },
        identifierFromPurchaser: string,
        inputData: unknown,
      ) => {
        outside.calls.push({
          call: "startPaidAgentJob",
          with: { identifierFromPurchaser, inputData },
        });
        await outside.seller.during?.();
        return ok({
          id: `seller-job-${identifierFromPurchaser}`,
          input_hash: "input-hash",
          identifierFromPurchaser,
          blockchainIdentifier: `purchase-${identifierFromPurchaser}`,
          payByTime: 1_775_737_949_000,
          submitResultTime: 1_775_755_949_000,
          unlockTime: 1_775_773_949_000,
          externalDisputeUnlockTime: 1_775_784_749_000,
          agentIdentifier: agent.blockchainIdentifier,
          sellerVKey: "seller-vkey",
        });
      },
      startFreeAgentJob: async (_agent: unknown, inputData: unknown) => {
        outside.calls.push({ call: "startFreeAgentJob", with: { inputData } });
        await outside.seller.during?.();
        return ok({ id: `free-seller-job-${randomUUID()}` });
      },
    }),
  };
});
vi.mock("@/helpers/job-purchase-registration", () => ({
  registerJobPurchase: async (input: unknown) => {
    outside.calls.push({ call: "registerJobPurchase", with: input });
  },
}));
vi.mock("@/helpers/billing-notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/billing-notifications")>()),
  notifyLowBalanceAfterCharge: async (input: unknown) => {
    outside.calls.push({ call: "notifyLowBalanceAfterCharge", with: input });
  },
}));

import { creditBucketRepository } from "@sokosumi/database/repositories";
import { sharedTable } from "@sokosumi/database/sql-tables";
import type { InputSchemaSchemaType } from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";

import { createAgentJobForUser } from "@/helpers/job";
import { createPersonalWorkspace } from "@/helpers/personal-workspace";
import { createNetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import {
  baseFile,
  observing,
  plain,
  type Statement,
  statements,
} from "@/test/spend-comparison";
import { onSplitLayout, testSchemaNames } from "@/test/split-layout";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

/**
 * The setup loads Core and creates workspaces through the product's own path:
 * seconds on a loaded machine, past Vitest's 10 s hook limit on CI's runner.
 */
const SETUP_TIMEOUT = 60_000;
const CASE_TIMEOUT = 60_000;
const DAY = 86_400_000;
/** One credit, in cents. */
const CREDIT = 10n ** 10n;
/** Cents per lovelace in the fixture's credit cost. */
const CENTS_PER_LOVELACE = 10n ** 4n;
/** The paid Agent's price: 3 credits. */
const PRICE_LOVELACE = 3_000_000n;
const PRICE = PRICE_LOVELACE * CENTS_PER_LOVELACE;

const { expectAsOnBase } = baseFile(
  fileURLToPath(new URL("./job-spend.base.json", import.meta.url)),
  process.env.RECORD_JOB_SPEND_BASE === "true",
);
/** Each layout has its own base, recorded there on `origin/main`. */
const layout = onSplitLayout ? "split" : "today";

const mainnet = () => createNetworkScope("mainnet").networkDb;

/** Random values in a statement or a row, each under a name. */
const labels = new Map<string, string>();
const created = {
  userIds: [] as string[],
  organizationIds: [] as string[],
  workspaceIds: [] as string[],
  projectIds: [] as string[],
  taskIds: [] as string[],
  sokoBotIds: [] as string[],
  agentIds: [] as string[],
  pricingIds: [] as string[],
  creditCostIds: [] as string[],
};
const agents = { paid: "", free: "" };

const inputSchema = {
  input_data: [{ id: "prompt", type: InputType.STRING, name: "prompt" }],
} satisfies InputSchemaSchemaType;

/** Whom a hire bills, and where its Job lives. */
interface Payer {
  owner: {
    ownerId: string;
    organizationId: string | null;
    workspaceId: string;
  };
  billedTo:
    | { userId: string; organizationId: null }
    | { organizationId: string };
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
  created.userIds.push(id);
  labels.set(id, `<${name}>`);
  return id;
}

/** A bucket of the payer's credits, under a name the rows are read back by. */
async function grant(
  name: string,
  owner: { userId: string } | { organizationId: string },
  bucket: { cents: bigint; expiresInDays: number; projectId?: string },
): Promise<void> {
  const grantRow = await mainnet().transaction.create({
    data: {
      amount: bucket.cents,
      ...owner,
      sourceCreditBucket: {
        create: {
          amount: bucket.cents,
          ...owner,
          expiresAt: new Date(Date.now() + bucket.expiresInDays * DAY),
          ...(bucket.projectId && { projectId: bucket.projectId }),
        },
      },
    },
    select: { id: true, sourceCreditBucket: { select: { id: true } } },
  });
  labels.set(grantRow.id, `<grant of ${name}>`);
  if (grantRow.sourceCreditBucket)
    labels.set(grantRow.sourceCreditBucket.id, `<bucket ${name}>`);
}

/**
 * A person in the personal workspace the product creates, with their own
 * buckets in place of the sign-up and free-plan grants, which other writers
 * make and which cannot write on the split layout yet.
 */
async function person(
  name: string,
  buckets: Array<{ name: string; cents: bigint; expiresInDays: number }>,
): Promise<Payer> {
  const userId = await createUser(name);
  const workspace = await createPersonalWorkspace(userId);
  created.workspaceIds.push(workspace.id);
  labels.set(workspace.id, `<${name}'s workspace>`);
  await mainnet().creditBucket.deleteMany({ where: { userId } });
  await mainnet().transaction.deleteMany({ where: { userId } });
  for (const bucket of buckets)
    await grant(`${bucket.name} of ${name}`, { userId }, bucket);
  return {
    owner: { ownerId: userId, organizationId: null, workspaceId: workspace.id },
    billedTo: { userId, organizationId: null },
  };
}

/**
 * A seated member of an Organization on a paid plan, so the member needs
 * the Seat, with a Project whose own credits pay first, then the pool,
 * soonest expiry first.
 */
async function organizationMember(
  name: string,
): Promise<Payer & { projectId: string }> {
  const memberId = await createUser(`${name}'s member`);
  const organizationId = randomUUID();
  const workspaceId = randomUUID();
  await prisma.organization.create({
    data: {
      id: organizationId,
      name: "Job spend fixture",
      slug: organizationId,
      workspace: { create: { id: workspaceId } },
      members: {
        create: {
          userId: memberId,
          role: "owner",
          seatAssignedAt: new Date(),
        },
      },
    },
  });
  created.organizationIds.push(organizationId);
  created.workspaceIds.push(workspaceId);
  labels.set(organizationId, `<${name}>`);
  labels.set(workspaceId, `<${name}'s workspace>`);
  const subscription = await prisma.subscription.create({
    data: {
      plan: "standard",
      referenceId: organizationId,
      status: "active",
      seats: 1,
      periodStart: new Date(Date.now() - DAY),
      periodEnd: new Date(Date.now() + 30 * DAY),
    },
    select: { id: true },
  });
  labels.set(subscription.id, `<${name}'s subscription>`);
  const project = await prisma.project.create({
    data: { workspaceId, name: "Job spend Project" },
    select: { id: true },
  });
  created.projectIds.push(project.id);
  labels.set(project.id, `<${name}'s Project>`);
  const owner = { organizationId };
  // Granted latest-expiring first: the spend order is not the creation order.
  await grant(`pool later of ${name}`, owner, {
    cents: 2n * CREDIT,
    expiresInDays: 20,
  });
  await grant(`pool soon of ${name}`, owner, {
    cents: CREDIT / 2n,
    expiresInDays: 5,
  });
  await grant(`Project credits of ${name}`, owner, {
    cents: CREDIT,
    expiresInDays: 40,
    projectId: project.id,
  });
  return {
    owner: { ownerId: memberId, organizationId, workspaceId },
    billedTo: { organizationId },
    projectId: project.id,
  };
}

async function sokoBot(workspaceId: string, name: string, projectId?: string) {
  const bot = await prisma.sokoBot.create({
    data: { workspaceId, name, ...(projectId && { projectId }) },
    select: { id: true },
  });
  created.sokoBotIds.push(bot.id);
  labels.set(bot.id, `<${name}>`);
  return bot.id;
}

async function task(payer: Payer, name: string) {
  const row = await prisma.task.create({
    data: {
      ownerId: payer.owner.ownerId,
      creatorUserId: payer.owner.ownerId,
      ...(payer.owner.organizationId && {
        organizationId: payer.owner.organizationId,
      }),
      workspaceId: payer.owner.workspaceId,
      name,
      status: "RUNNING",
    },
    select: { id: true },
  });
  created.taskIds.push(row.id);
  labels.set(row.id, `<${name}>`);
  return row.id;
}

/** The fixture's Agents: one paid in lovelace (V1), one free. */
async function createAgents() {
  const db = mainnet();
  const existing = await db.creditCost.findUnique({
    where: { unit: "lovelace" },
  });
  if (existing) throw new Error("This file needs the database to itself");
  const scope = createNetworkScope("mainnet");
  const costId = randomUUID();
  created.creditCostIds.push(costId);
  await scope.netTransaction(async (tx) => {
    // shortcut: the unit trigger calls `public.canonical_credit_cost_unit`,
    // which the split layout moved to `shared`; drop this line with ticket 19.
    if (onSplitLayout) {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    }
    await tx.creditCost.create({
      data: { id: costId, unit: "lovelace", centsPerUnit: CENTS_PER_LOVELACE },
    });
  }, "Fixture conflict");
  const now = new Date();
  const seed = {
    lastUptimeCheck: now,
    uptimeCount: 1,
    uptimeCheckCount: 1,
    isShown: true,
    apiBaseUrl: "https://agent.example.test",
    description: "Job spend fixture",
  };
  for (const kind of ["paid", "free"] as const) {
    const pricingId = randomUUID();
    created.pricingIds.push(pricingId);
    const identifier = `${randomUUID().replaceAll("-", "")}${kind}`;
    const agent = await db.agent.create({
      data: {
        ...seed,
        blockchainIdentifier: identifier,
        name: `Job spend ${kind} Agent`,
        paymentType: kind === "paid" ? "WEB3_CARDANO_V1" : "NONE",
        pricing: {
          create:
            kind === "paid"
              ? {
                  id: pricingId,
                  pricingType: "FIXED",
                  fixedPricing: {
                    create: {
                      amounts: {
                        create: { unit: "lovelace", amount: PRICE_LOVELACE },
                      },
                    },
                  },
                }
              : { id: pricingId, pricingType: "FREE" },
        },
      },
      select: { id: true },
    });
    created.agentIds.push(agent.id);
    agents[kind] = agent.id;
    labels.set(agent.id, `<${kind} Agent>`);
    labels.set(identifier, `<${kind} Agent's identifier>`);
  }
}

type HireInput = Parameters<typeof createAgentJobForUser>[0];

async function hire(
  payer: Payer,
  kind: "paid" | "free",
  more: Partial<HireInput> = {},
): Promise<unknown> {
  try {
    return await createAgentJobForUser({
      owner: payer.owner,
      creator: { kind: "user", userId: payer.owner.ownerId },
      agentInput: {
        agentId: agents[kind],
        inputData: { prompt: "hello" },
        inputSchema,
        name: "Job spend hire",
      },
      ...more,
    });
  } catch (error) {
    // Prisma's message quotes the calling file by its path on this machine:
    // its code and model say the same on every machine.
    const prismaError = error as {
      name?: unknown;
      code?: unknown;
      meta?: { modelName?: unknown };
    };
    if (prismaError?.name !== "PrismaClientKnownRequestError") throw error;
    const known = new Error(
      `${String(prismaError.code)} on ${String(prismaError.meta?.modelName)}`,
    );
    known.name = prismaError.name;
    throw known;
  }
}

/**
 * Every credit row of the payer, the Jobs of its workspace with their events
 * and inputs, the Agents' job counters, and the fixture's Soko Bots.
 */
async function rows(payer: Payer) {
  const db = mainnet();
  const wallet = payer.billedTo;
  return {
    buckets: await db.creditBucket.findMany({
      where: wallet,
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
      where: { ...wallet, amount: { lt: 0n } },
      orderBy: { id: "asc" },
    }),
    consumptions: await db.creditConsumption.findMany({
      where: { transaction: wallet },
      orderBy: [{ transactionId: "asc" }, { bucket: { expiresAt: "asc" } }],
    }),
    jobs: await db.job.findMany({
      where: { workspaceId: payer.owner.workspaceId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: {
        events: { orderBy: { id: "asc" }, include: { input: true } },
      },
    }),
    agents: await db.agent.findMany({
      where: { id: { in: created.agentIds } },
      orderBy: { name: "asc" },
      select: { name: true, jobCount: true },
    }),
    sokoBots: await prisma.sokoBot.findMany({
      where: { workspaceId: payer.owner.workspaceId },
      orderBy: { id: "asc" },
      select: { id: true, name: true },
    }),
  };
}

/**
 * One observed call, or several at once: the answer, what it reached outside
 * the database and in which order, the statements it sent, and the rows it
 * left.
 */
async function observe(payer: Payer, call: () => Promise<unknown>) {
  outside.calls = [];
  const started = Date.now();
  const { outcome, log } = await observing(call);
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
  const debitRows = [...left.transactions, ...left.consumptions];
  const debitTimes = [
    ...left.transactions.flatMap((row) => [row.createdAt, row.updatedAt]),
    ...left.consumptions.map((row) => row.createdAt),
  ];
  // The purchaser identifier is random and not a UUID: named per run.
  for (const { call: name, with: input } of outside.calls) {
    if (name !== "startPaidAgentJob") continue;
    const { identifierFromPurchaser } = input as {
      identifierFromPurchaser: string;
    };
    labels.set(
      identifierFromPurchaser,
      `<purchaser identifier ${[...labels.values()].filter((label) => label.startsWith("<purchaser identifier")).length + 1}>`,
    );
  }
  return plain(
    {
      result: outcome,
      outside: outside.calls,
      statements: statements(log),
      rows: left,
      // What `plain` hides of the debit's rows: the kind of id, and that
      // their times are this call's.
      debit: {
        uuidVersions: debitRows.map((row) => row.id.charAt(14)),
        timesWithinTheCall: debitTimes.map(
          (time) => time.getTime() >= started && time.getTime() <= ended,
        ),
      },
    },
    labels,
  );
}

function settled(result: PromiseSettledResult<unknown>) {
  if (result.status === "fulfilled") return result.value;
  const error = result.reason as {
    name?: unknown;
    message?: unknown;
    status?: unknown;
  };
  return {
    threw: { name: error.name, message: error.message, status: error.status },
  };
}

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

/**
 * Takes `cents` of the payer's credits on a connection of its own, outside
 * Core's pool, so it adds no statement to what is compared: another spend
 * that committed while the hire waited for its seller.
 */
async function spendElsewhere(userId: string, cents: bigint) {
  const schema = testSchemaNames().DATABASE_SCHEMA_MAINNET || "public";
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const bucket = await client.query<{ id: string }>(
      `SELECT id FROM "${schema}"."credit_bucket" WHERE "userId" = $1 ORDER BY "expiresAt" ASC LIMIT 1`,
      [userId],
    );
    const id = randomUUID();
    const now = new Date();
    labels.set(id, "<spend elsewhere>");
    await client.query(
      `INSERT INTO "${schema}"."Transaction" (id, "createdAt", "updatedAt", amount, "userId") VALUES ($1, $2, $2, $3, $4)`,
      [id, now, (-cents).toString(), userId],
    );
    await client.query(
      `INSERT INTO "${schema}"."credit_consumption" (id, "createdAt", amount, "bucketId", "transactionId") VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), now, cents.toString(), bucket.rows[0]?.id, id],
    );
  } finally {
    await client.end();
  }
}

/**
 * Two paid hires of one person for credits that pay one. Both pass the
 * preflight and their sellers. Then the `holder` enters its commit, chooses
 * its buckets and holds there while the other hire commits and returns; then
 * it goes on.
 */
async function race(name: string, holder: 0 | 1) {
  const payer = await person(name, [
    { name: "only bucket", cents: PRICE, expiresInDays: 20 },
  ]);
  // There both stop before their sellers, at the same read.
  if (onSplitLayout)
    return observe(payer, async () =>
      (
        await Promise.allSettled([hire(payer, "paid"), hire(payer, "paid")])
      ).map(settled),
    );
  const sellerEntered = [gate(), gate()];
  const sellerAnswers = [gate(), gate()];
  let sellerCalls = 0;
  const holderPrepared = gate();
  const holdOpen = gate();
  const prepare = creditBucketRepository.prepareConsumption;
  let prepared = 0;
  const spy = vi
    .spyOn(creditBucketRepository, "prepareConsumption")
    .mockImplementation(async (...args) => {
      const consumptions = await prepare(...args);
      prepared += 1;
      if (prepared === 1) {
        holderPrepared.open();
        await holdOpen.opened;
      }
      return consumptions;
    });
  outside.seller.during = async () => {
    const call = sellerCalls;
    sellerCalls += 1;
    sellerEntered[call]?.open();
    await sellerAnswers[call]?.opened;
  };
  try {
    return await observe(payer, async () => {
      const hires = [0, 1].map(async (index) => {
        // The second hire starts after the first has reached its seller.
        if (index === 1) await sellerEntered[0]?.opened;
        return hire(payer, "paid", {
          agentInput: {
            agentId: agents.paid,
            inputData: { prompt: `hire ${index}` },
            inputSchema,
            name: `Job spend hire ${index}`,
          },
        });
      });
      await sellerEntered[1]?.opened;
      sellerAnswers[holder]?.open();
      await holderPrepared.opened;
      sellerAnswers[1 - holder]?.open();
      await hires[1 - holder]?.catch(() => undefined);
      holdOpen.open();
      return (await Promise.allSettled(hires)).map(settled);
    });
  } finally {
    spy.mockRestore();
    outside.seller.during = undefined;
  }
}

/*
 * The one difference from `origin/main`, statement by statement. There the
 * debit was nested in the Job's create: a read of each row it connects (the
 * Organization when there is one, then the owner when there is one), the
 * insert of the debit with those columns only, and its consumptions; then
 * the Job's own reads and its insert, which binds the debit's id.
 */
const MAIN_CONNECT_ORGANIZATION =
  'SELECT "public"."organization"."id" FROM "public"."organization" WHERE ("public"."organization"."id" = $1 AND 1=1) LIMIT $2 OFFSET $3';
const MAIN_CONNECT_USER =
  'SELECT "public"."user"."id" FROM "public"."user" WHERE ("public"."user"."id" = $1 AND 1=1) LIMIT $2 OFFSET $3';
const MAIN_INSERT_DEBIT =
  /^INSERT INTO "public"\."Transaction" \("id","createdAt","updatedAt","amount"((?:,"userId")?)((?:,"organizationId")?)\) VALUES \(\$1,\$2,\$3,\$4(?:,\$5)?(?:,\$6)?\) RETURNING "public"\."Transaction"\."id"$/;
const mainInsertConsumptions = (count: number) =>
  `INSERT INTO "public"."credit_consumption" ("id","createdAt","amount","bucketId","transactionId") VALUES ${Array.from(
    { length: count },
    (_unused, row) =>
      `(${[1, 2, 3, 4, 5].map((column) => `$${row * 5 + column}`).join(",")})`,
  ).join(", ")}`;
/*
 * Now the credit bucket repository's `recordSpend` writes the debit first,
 * in two statements of raw SQL, and the Job connects it by id: Prisma reads
 * the debit, then looks for a Job that already holds it (the link is one to
 * one). The Job's own reads and insert follow unchanged.
 */
const NOW_INSERT_DEBIT =
  'INSERT INTO "public"."Transaction" (id, "createdAt", "updatedAt", amount, "userId", "organizationId") VALUES ($1, $2, $3, $4, $5, $6)';
const NOW_INSERT_CONSUMPTIONS =
  'INSERT INTO "public"."credit_consumption" (id, "createdAt", amount, "bucketId", "transactionId") SELECT c.id, $1::timestamp(3), c.amount, c."bucketId", $2::text FROM unnest($3::text[], $4::bigint[], $5::text[]) AS c(id, amount, "bucketId")';
const NOW_CONNECT_DEBIT =
  'SELECT "public"."Transaction"."id" FROM "public"."Transaction" WHERE ("public"."Transaction"."id" = $1 AND 1=1) LIMIT $2 OFFSET $3';
const NOW_JOB_HOLDING_THE_DEBIT =
  'SELECT "public"."Job"."id", "public"."Job"."transactionId" FROM "public"."Job" WHERE (1=1 AND "public"."Job"."transactionId" IN ($1)) OFFSET $2';

/**
 * A transaction recorded on `origin/main`, with its debit written as head
 * writes it: the same values in the same place, every other statement
 * untouched. It refuses a debit that is not exactly the statements above. A
 * debit whose insert failed (a lost race) ends at the insert on both.
 */
function withTheDebitWrittenFirst(transaction: Statement[]): Statement[] {
  const at = transaction.findIndex(({ sql }) => MAIN_INSERT_DEBIT.test(sql));
  if (at === -1) return transaction;
  const debit = transaction[at];
  const columns = debit?.sql.match(MAIN_INSERT_DEBIT);
  if (!debit || !columns) throw new Error("A debit is cut");
  const [debitId, createdAt, updatedAt, amount, ...payer] = debit.values;
  const userId = columns[1] ? payer.shift() : null;
  const organizationId = columns[2] ? payer.shift() : null;
  const connects = [
    ...(organizationId === null
      ? []
      : [
          {
            sql: MAIN_CONNECT_ORGANIZATION,
            values: [organizationId, "1", "0"],
          },
        ]),
    ...(userId === null
      ? []
      : [{ sql: MAIN_CONNECT_USER, values: [userId, "1", "0"] }]),
  ];
  const from = at - connects.length;
  expect(transaction.slice(from, at)).toEqual(connects);
  const nowDebit = {
    sql: NOW_INSERT_DEBIT,
    values: [debitId, createdAt, updatedAt, amount, userId, organizationId],
  };
  if (/^ROLLBACK\b/.test(transaction[at + 1]?.sql ?? "")) {
    return [
      ...transaction.slice(0, from),
      nowDebit,
      ...transaction.slice(at + 1),
    ];
  }
  const consumptions = transaction[at + 1];
  if (!consumptions) throw new Error("A debit is cut");
  const written = Array.from(
    { length: consumptions.values.length / 5 },
    (_unused, row) => consumptions.values.slice(row * 5, row * 5 + 5),
  );
  expect(consumptions.sql).toBe(mainInsertConsumptions(written.length));
  // One time and one debit for every consumption, as the one statement binds.
  expect(written.map((row) => [row[1], row[4]])).toEqual(
    written.map(() => [createdAt, debitId]),
  );
  return [
    ...transaction.slice(0, from),
    nowDebit,
    {
      sql: NOW_INSERT_CONSUMPTIONS,
      values: [
        createdAt,
        debitId,
        written.map((row) => row[0]),
        written.map((row) => row[2]),
        written.map((row) => row[3]),
      ],
    },
    { sql: NOW_CONNECT_DEBIT, values: [debitId, "1", "0"] },
    { sql: NOW_JOB_HOLDING_THE_DEBIT, values: [debitId, "0"] },
    ...transaction.slice(at + 2),
  ];
}

/** `rewrite` for `expectAsOnBase`: each transaction's debit as head writes it. */
const asOnHead = (transactions: Statement[][]) =>
  transactions.map(withTheDebitWrittenFirst);

describe.skipIf(!enabled)(
  "a Job hire's charge, as on origin/main (PostgreSQL)",
  () => {
    beforeAll(createAgents, SETUP_TIMEOUT);

    afterAll(async () => {
      const db = mainnet();
      const billedTo = {
        OR: [
          { userId: { in: created.userIds } },
          { organizationId: { in: created.organizationIds } },
        ],
      };
      const jobs = { agentId: { in: created.agentIds } };
      await db.jobInput.deleteMany({ where: { event: { job: jobs } } });
      await db.jobEvent.deleteMany({ where: { job: jobs } });
      await db.job.deleteMany({ where: jobs });
      await db.creditConsumption.deleteMany({
        where: { transaction: billedTo },
      });
      await db.creditBucket.deleteMany({ where: billedTo });
      await db.transaction.deleteMany({ where: billedTo });
      await db.agent.deleteMany({ where: { id: { in: created.agentIds } } });
      await db.agentPricing.deleteMany({
        where: { id: { in: created.pricingIds } },
      });
      await db.creditCost.deleteMany({
        where: { id: { in: created.creditCostIds } },
      });
      await prisma.task.deleteMany({ where: { id: { in: created.taskIds } } });
      await prisma.sokoBot.deleteMany({
        where: { id: { in: created.sokoBotIds } },
      });
      await prisma.project.deleteMany({
        where: { id: { in: created.projectIds } },
      });
      await prisma.workspace.deleteMany({
        where: { id: { in: created.workspaceIds } },
      });
      await prisma.subscription.deleteMany({
        where: {
          referenceId: {
            in: [...created.userIds, ...created.organizationIds],
          },
        },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: created.organizationIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
    }, SETUP_TIMEOUT);

    const expectCase = (name: string, observed: unknown) =>
      expectAsOnBase(`${layout}: ${name}`, observed, asOnHead);

    it(
      "hires a free Agent with no debit",
      async () => {
        const payer = await person("free hire person", [
          { name: "only bucket", cents: CREDIT, expiresInDays: 20 },
        ]);
        expectCase(
          "a free hire",
          await observe(payer, () => hire(payer, "free")),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "charges a person's paid hire to their credits, soonest expiry first",
      async () => {
        const payer = await person("paying person", [
          { name: "expiring later", cents: 5n * CREDIT, expiresInDays: 20 },
          { name: "expiring first", cents: CREDIT, expiresInDays: 1 },
        ]);
        expectCase(
          "a person's paid hire",
          await observe(payer, () => hire(payer, "paid")),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "charges a seated member's paid hire to the Job's Project, then the pool",
      async () => {
        const payer = await organizationMember("paying Organization");
        expectCase(
          "an Organization member's paid hire",
          await observe(payer, () =>
            hire(payer, "paid", {
              agentInput: {
                agentId: agents.paid,
                inputData: { prompt: "hello" },
                inputSchema,
                name: "Job spend hire",
                projectId: payer.projectId,
              },
            }),
          ),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "refuses a paid hire at the preflight, before the seller",
      async () => {
        const payer = await person("short person", [
          { name: "only bucket", cents: CREDIT, expiresInDays: 20 },
        ]);
        expectCase(
          "too few credits at the preflight",
          await observe(payer, () => hire(payer, "paid")),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "refuses a paid hire at commit when the credits went during the seller's call",
      async () => {
        const payer = await person("drained person", [
          { name: "only bucket", cents: PRICE, expiresInDays: 20 },
        ]);
        outside.seller.during = () =>
          spendElsewhere(payer.owner.ownerId, CREDIT);
        try {
          expectCase(
            "too few credits at commit",
            await observe(payer, () => hire(payer, "paid")),
          );
        } finally {
          outside.seller.during = undefined;
        }
      },
      CASE_TIMEOUT,
    );

    it(
      "fails a paid hire whose bucket read falls short after its balance read",
      async () => {
        const payer = await person("overstated person", [
          { name: "only bucket", cents: CREDIT, expiresInDays: 20 },
        ]);
        // A balance read that covers the price, as one counted otherwise
        // than the buckets would: only the bucket read is short.
        const spy = vi
          .spyOn(creditBucketRepository, "getBalance")
          .mockResolvedValue(PRICE);
        try {
          expectCase(
            "the bucket read short after the balance read",
            await observe(payer, () => hire(payer, "paid")),
          );
        } finally {
          spy.mockRestore();
        }
      },
      CASE_TIMEOUT,
    );

    it(
      "lets one of two racing hires pay, the one holding its commit waiting",
      async () => {
        expectCase(
          "two hires racing, the first holding",
          await race("first holds person", 0),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "lets one of two racing hires pay, the second holding its commit",
      async () => {
        expectCase(
          "two hires racing, the second holding",
          await race("second holds person", 1),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "charges a Task's hire to the Task owner",
      async () => {
        const payer = await person("Task owner", [
          { name: "only bucket", cents: 5n * CREDIT, expiresInDays: 20 },
        ]);
        const taskId = await task(payer, "hiring Task");
        const botId = await sokoBot(payer.owner.workspaceId, "Task's Soko Bot");
        expectCase(
          "a hire from a Task",
          await observe(payer, () =>
            hire(payer, "paid", {
              creator: { kind: "soko_bot", sokoBotId: botId },
              taskContext: { taskId },
            }),
          ),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "charges a Soko Bot decision's hire to the bot's Project and attaches it before commit",
      async () => {
        const payer = await organizationMember("deciding Organization");
        const botId = await sokoBot(
          payer.owner.workspaceId,
          "deciding Soko Bot",
          payer.projectId,
        );
        expectCase(
          "a hire from a Soko Bot decision",
          await observe(payer, () =>
            hire(payer, "paid", {
              creator: { kind: "soko_bot", sokoBotId: botId },
              creditProjectId: payer.projectId,
              afterLocalJobCreate: async (job, tx) => {
                // A shared row written in the hire's transaction, as the
                // decision's own attachment is.
                await tx.$executeRaw`
                  UPDATE ${sharedTable("soko_bot")}
                  SET "name" = ${`attached ${job.id}`}
                  WHERE "id" = ${botId}::uuid
                `;
              },
            }),
          ),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "rolls the debit back with the Job when the attachment fails",
      async () => {
        const payer = await organizationMember(
          "failed attachment Organization",
        );
        const botId = await sokoBot(
          payer.owner.workspaceId,
          "failing Soko Bot",
          payer.projectId,
        );
        expectCase(
          "a failed attachment",
          await observe(payer, () =>
            hire(payer, "paid", {
              creator: { kind: "soko_bot", sokoBotId: botId },
              creditProjectId: payer.projectId,
              afterLocalJobCreate: async (job, tx) => {
                await tx.$executeRaw`
                  UPDATE ${sharedTable("soko_bot")}
                  SET "name" = ${`attached ${job.id}`}
                  WHERE "id" = ${botId}::uuid
                `;
                throw new Error(
                  "Agent hire reservation changed before local commit",
                );
              },
            }),
          ),
        );
      },
      CASE_TIMEOUT,
    );
  },
);
