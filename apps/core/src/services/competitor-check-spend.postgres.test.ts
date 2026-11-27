/**
 * The charge of a Project's weekly competitor check, on a real PostgreSQL at
 * the check's own entry point (`runProjectCompetitorCheck`): what it answers,
 * every credit row and the check's receipt, and the statements PostgreSQL
 * received, with each transaction's boundaries and isolation level.
 *
 * All of it is compared with `competitor-check-spend.base.json`, which this
 * file wrote while it ran on `origin/main`'s code (`255aad236`), before the
 * charge moved into the credits module:
 * RECORD_COMPETITOR_CHECK_SPEND_BASE=true RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter core test src/services/competitor-check-spend.postgres.test.ts
 * Without `RECORD_COMPETITOR_CHECK_SPEND_BASE` the same command compares.
 *
 * It needs the database to itself, as CI gives each worker its own
 * (`POSTGRES_TEST_DATABASE_PER_WORKER`): another file's Serializable
 * transaction on the same database can make the charge retry, and a retry is
 * a second transaction in the statements.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

interface SentStatement {
  connection: number;
  text: string;
  values: unknown[];
}
/** What Core's pool sent while a check was observed, per connection. */
const sent = vi.hoisted(() => ({
  observing: false,
  connections: 0,
  log: [] as SentStatement[],
}));
const readers = vi.hoisted(() => ({
  readCompetitorPage: vi.fn(),
  searchExa: vi.fn(),
}));
vi.mock("@vercel/functions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vercel/functions")>();
  return {
    ...actual,
    attachDatabasePool: (pool: Pool) => {
      pool.on("connect", (client: PoolClient) => {
        sent.connections += 1;
        const connection = sent.connections;
        const query = client.query.bind(client) as (...a: unknown[]) => unknown;
        (client as { query: unknown }).query = (...args: unknown[]) => {
          if (sent.observing) {
            const [first, second] = args;
            const config =
              typeof first === "string"
                ? { text: first, values: second }
                : (first as { text: string; values?: unknown });
            sent.log.push({
              connection,
              text: config.text,
              values: Array.isArray(config.values) ? config.values : [],
            });
          }
          return query(...args);
        };
      });
      actual.attachDatabasePool(pool);
    },
  };
});
// What a check reaches outside the database.
vi.mock("@/config/env", async (original) => {
  const actual = await original<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      EXA_API_KEY: "test-key",
      META_AD_LIBRARY_ACCESS_TOKEN: undefined,
    }),
  };
});
vi.mock("@/lib/competitors/page-read", async (original) => ({
  ...(await original<typeof import("@/lib/competitors/page-read")>()),
  readCompetitorPage: readers.readCompetitorPage,
}));
vi.mock("@/lib/soko-bot/exa", () => ({ searchExa: readers.searchExa }));
vi.mock("@/lib/competitors/model", () => ({ askCompetitorModel: vi.fn() }));

import {
  creditBucketRepository,
  workspaceRepository,
} from "@sokosumi/database/repositories";
import { convertCreditsToCents } from "@sokosumi/utils";

import { createPersonalWorkspace } from "@/helpers/personal-workspace";
import { COMPETITOR_CHECK_CREDITS } from "@/lib/competitors/price";
import { createNetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import { runProjectCompetitorCheck } from "@/services/competitor-check.service";
import {
  addTrackedCompetitor,
  setCompetitorChecks,
} from "@/services/competitors.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

/**
 * The setup loads Core's services and creates workspaces through the product's
 * own path: seconds on a loaded machine, past Vitest's 10 s hook limit on CI's
 * runner.
 */
const SETUP_TIMEOUT = 60_000;
/** A case runs whole checks and reads every row back. */
const CASE_TIMEOUT = 60_000;
const DAY = 86_400_000;
const MONDAY = new Date("2026-11-16T09:00:00Z");
/** Two competitors are tracked, so this is what one check costs. */
const PRICE = convertCreditsToCents(COMPETITOR_CHECK_CREDITS * 2);

const BASE_FILE = fileURLToPath(
  new URL("./competitor-check-spend.base.json", import.meta.url),
);
const recording = process.env.RECORD_COMPETITOR_CHECK_SPEND_BASE === "true";

function recorded(): Record<string, unknown> {
  return existsSync(BASE_FILE)
    ? (JSON.parse(readFileSync(BASE_FILE, "utf8")) as Record<string, unknown>)
    : {};
}

interface Statement {
  sql: string;
  values: unknown[];
}
interface Observed {
  statements: { transactions: Statement[][] };
}

/*
 * The one difference from `origin/main`, statement by statement. There the
 * debit was Prisma's nested create: three statements.
 */
const MAIN_INSERT_DEBIT =
  'INSERT INTO "public"."Transaction" ("id","createdAt","updatedAt","amount","userId","organizationId") VALUES ($1,$2,$3,$4,$5,$6) RETURNING "public"."Transaction"."id"';
const mainInsertConsumptions = (count: number) =>
  `INSERT INTO "public"."credit_consumption" ("id","createdAt","amount","bucketId","transactionId") VALUES ${Array.from(
    { length: count },
    (_unused, row) =>
      `(${[1, 2, 3, 4, 5].map((column) => `$${row * 5 + column}`).join(",")})`,
  ).join(", ")}`;
const MAIN_READ_DEBIT_BACK =
  'SELECT "public"."Transaction"."id" FROM "public"."Transaction" WHERE "public"."Transaction"."id" = $1 LIMIT $2 OFFSET $3';
/*
 * Now the credit bucket repository's `recordSpend` writes it, as it has
 * written the Task charge since #8224: two statements of raw SQL, which name
 * the Network's schema.
 */
const NOW_INSERT_DEBIT =
  'INSERT INTO "public"."Transaction" (id, "createdAt", "updatedAt", amount, "userId", "organizationId") VALUES ($1, $2, $3, $4, $5, $6)';
const NOW_INSERT_CONSUMPTIONS =
  'INSERT INTO "public"."credit_consumption" (id, "createdAt", amount, "bucketId", "transactionId") SELECT c.id, $1::timestamp(3), c.amount, c."bucketId", $2::text FROM unnest($3::text[], $4::bigint[], $5::text[]) AS c(id, amount, "bucketId")';

/**
 * A transaction recorded on `origin/main`, with its debit written as
 * `recordSpend` writes it: the same values in the same place, every other
 * statement untouched. It refuses a debit that is not exactly the three
 * statements above.
 */
function withTheDebitAsWrittenNow(transaction: Statement[]): Statement[] {
  const at = transaction.findIndex(({ sql }) => sql === MAIN_INSERT_DEBIT);
  if (at === -1) return transaction;
  const [debit, consumptions, readBack] = transaction.slice(at, at + 3);
  if (!debit || !consumptions || !readBack) throw new Error("A debit is cut");
  const debitId = debit.values[0];
  const written = Array.from(
    { length: consumptions.values.length / 5 },
    (_unused, row) => consumptions.values.slice(row * 5, row * 5 + 5),
  );
  expect([consumptions.sql, readBack]).toEqual([
    mainInsertConsumptions(written.length),
    { sql: MAIN_READ_DEBIT_BACK, values: [debitId, "1", "0"] },
  ]);
  // One time and one debit for every consumption, as the one statement binds.
  expect(written.map((row) => [row[1], row[4]])).toEqual(
    written.map(() => [debit.values[1], debitId]),
  );
  return [
    ...transaction.slice(0, at),
    { sql: NOW_INSERT_DEBIT, values: debit.values },
    {
      sql: NOW_INSERT_CONSUMPTIONS,
      values: [
        debit.values[1],
        debitId,
        written.map((row) => row[0]),
        written.map((row) => row[2]),
        written.map((row) => row[3]),
      ],
    },
    ...transaction.slice(at + 3),
  ];
}

/**
 * Compares with what `origin/main` did, or records it while run there. The
 * answer, the rows and every statement are `origin/main`'s; only the debit's
 * own statements are the ones above.
 */
function expectAsOnBase(key: string, observed: unknown) {
  if (recording) {
    writeFileSync(
      BASE_FILE,
      `${JSON.stringify({ ...recorded(), [key]: observed }, null, 2)}\n`,
    );
    return;
  }
  const base = recorded()[key] as Observed;
  expect(observed).toEqual({
    ...base,
    statements: {
      ...base.statements,
      transactions: base.statements.transactions.map(withTheDebitAsWrittenNow),
    },
  });
}

const mainnet = () => createNetworkScope("mainnet").networkDb;

/** Random values in a statement or a row, each under a name. */
const labels = new Map<string, string>();
const userIds: string[] = [];
const organizationIds: string[] = [];
const projectIds: string[] = [];

interface Payer {
  userId: string | null;
  organizationId: string | null;
  projectId: string;
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

async function createProject(workspaceId: string, name: string) {
  const project = await prisma.project.create({
    data: { workspaceId, name: "acme.io", websiteUrl: "https://www.acme.io" },
    select: { id: true },
  });
  projectIds.push(project.id);
  labels.set(project.id, `<${name}'s Project>`);
  for (const competitor of ["Calendly", "Zcal"]) {
    await addTrackedCompetitor(project.id, {
      name: competitor,
      websiteUrl: `https://${competitor.toLowerCase()}.example/`,
    });
  }
  await setCompetitorChecks(project.id, true);
  return project.id;
}

/** A bucket of the payer's credits, under a name the rows are read back by. */
async function grant(
  name: string,
  owner: { userId: string } | { organizationId: string },
  bucket: { cents: bigint; expiresInDays: number; projectId?: string },
): Promise<void> {
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
        },
      },
    },
    select: { id: true, sourceCreditBucket: { select: { id: true } } },
  });
  labels.set(created.id, `<grant of ${name}>`);
  if (created.sourceCreditBucket)
    labels.set(created.sourceCreditBucket.id, `<bucket ${name}>`);
}

/**
 * A person in the personal workspace the product creates, with two buckets:
 * the one that expires first holds half a check's price, so a check spends
 * from both.
 */
async function person(name: string): Promise<Payer> {
  const userId = await createUser(name);
  const workspace = await createPersonalWorkspace(userId);
  labels.set(workspace.id, `<${name}'s workspace>`);
  // The grants are other writers' (sign-up and free plan), which cannot write
  // on the split layout yet: the fixture's own buckets replace them, so the
  // same credits exist on both layouts.
  await mainnet().creditBucket.deleteMany({ where: { userId } });
  await mainnet().transaction.deleteMany({ where: { userId } });
  await grant(
    `expiring later of ${name}`,
    { userId },
    { cents: PRICE, expiresInDays: 20 },
  );
  await grant(
    `expiring first of ${name}`,
    { userId },
    { cents: PRICE / 2n, expiresInDays: 1 },
  );
  return {
    userId,
    organizationId: null,
    projectId: await createProject(workspace.id, name),
  };
}

/**
 * An Organization whose Project holds Project credits beside the pool. Its
 * check has no member to charge: the pool pays, the Project's credits first.
 */
async function organization(
  name: string,
  pool: { soonCents: bigint; laterCents: bigint },
): Promise<Payer> {
  const ownerId = await createUser(`${name}'s owner`);
  const organizationId = `competitor-spend-${randomUUID()}`;
  await prisma.organization.create({
    data: {
      id: organizationId,
      name: "Competitor spend fixture",
      slug: organizationId,
      members: { create: { userId: ownerId, role: "owner" } },
    },
  });
  organizationIds.push(organizationId);
  labels.set(organizationId, `<${name}>`);
  const workspace = await workspaceRepository.upsertOrganizationWorkspace({
    organizationId,
    tx: prisma,
  });
  labels.set(workspace.id, `<${name}'s workspace>`);
  const projectId = await createProject(workspace.id, name);
  const owner = { organizationId };
  // Granted latest-expiring first: the spend order is not the creation order.
  if (pool.laterCents > 0n) {
    await grant(`pool later of ${name}`, owner, {
      cents: pool.laterCents,
      expiresInDays: 20,
    });
  }
  await grant(`pool soon of ${name}`, owner, {
    cents: pool.soonCents,
    expiresInDays: 5,
  });
  await grant(`Project credits of ${name}`, owner, {
    cents: PRICE / 4n,
    expiresInDays: 40,
    projectId,
  });
  return { userId: null, organizationId, projectId };
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const TIME =
  /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/g;

/**
 * Plain data without what differs between two runs: a named value is its
 * name, a time is `<time>`, and an id the run made is `<id n>`, numbered in
 * the order the ids first appear, so two places that hold one id still agree.
 */
function plain(value: unknown): unknown {
  let text = JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? item.toString() : item,
  );
  for (const [random, name] of labels) text = text.replaceAll(random, name);
  const made = new Map<string, string>();
  text = text.replace(UUID, (id) => {
    if (!made.has(id)) made.set(id, `<id ${made.size + 1}>`);
    return made.get(id) ?? id;
  });
  return JSON.parse(text.replace(TIME, "<time>"));
}

/**
 * The statements as PostgreSQL received them. A transaction is the statements
 * of one connection from its BEGIN to its COMMIT or ROLLBACK, in the order
 * sent, with the values bound. Statements outside a transaction can run side
 * by side, so they are counted per text. On the split layout the schema names
 * differ and are written as today's.
 */
function statements(log: readonly SentStatement[]) {
  const open = new Map<number, { sql: string; values: unknown[] }[]>();
  const transactions: { sql: string; values: unknown[] }[][] = [];
  const outside = new Map<string, number>();
  for (const { connection, text, values } of log) {
    const sql = text
      .replace(/\s+/g, " ")
      .trim()
      .replace(/"(shared|mainnet)"\./g, '"public".');
    const transaction = open.get(connection);
    if (/^BEGIN\b/i.test(sql)) {
      const started = [{ sql, values }];
      open.set(connection, started);
      transactions.push(started);
    } else if (transaction) {
      transaction.push({ sql, values });
      if (/^(COMMIT|ROLLBACK)\b/i.test(sql)) open.delete(connection);
    } else {
      outside.set(sql, (outside.get(sql) ?? 0) + 1);
    }
  }
  return {
    transactions,
    outsideTransactions: Object.fromEntries(
      [...outside].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
  };
}

/** Every credit row of the payer and every check of its Project. */
async function rows(payer: Payer) {
  const billedTo = payer.organizationId
    ? { organizationId: payer.organizationId }
    : { userId: payer.userId };
  const db = mainnet();
  return {
    buckets: await db.creditBucket.findMany({
      where: billedTo,
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
      where: { ...billedTo, amount: { lt: 0n } },
      orderBy: { id: "asc" },
    }),
    consumptions: await db.creditConsumption.findMany({
      where: { transaction: billedTo },
      orderBy: [{ transactionId: "asc" }, { bucket: { expiresAt: "asc" } }],
    }),
    checks: await prisma.competitorCheck.findMany({
      where: { projectId: payer.projectId },
      orderBy: { createdAt: "asc" },
    }),
  };
}

/**
 * One check: its answer, the statements it sent, what it read outside the
 * database, and the rows it left.
 */
async function observe(payer: Payer, now: Date) {
  readers.readCompetitorPage.mockClear();
  readers.searchExa.mockClear();
  const started = Date.now();
  sent.log = [];
  sent.observing = true;
  let result: unknown;
  try {
    result = await runProjectCompetitorCheck(payer.projectId, now);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    result = { threw: { name: error.name, message: error.message } };
  } finally {
    sent.observing = false;
  }
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
  return plain({
    result,
    pagesRead: readers.readCompetitorPage.mock.calls.length,
    newsSearches: readers.searchExa.mock.calls.length,
    statements: statements(sent.log),
    rows: left,
    // What `plain` hides of the debit's rows: the kind of id, and that their
    // times are this check's.
    debit: {
      uuidVersions: debitRows.map((row) => row.id.charAt(14)),
      timesWithinTheCheck: debitTimes.map(
        (time) => time.getTime() >= started && time.getTime() <= ended,
      ),
    },
  });
}

describe.skipIf(!enabled)(
  "the competitor check's charge, as on origin/main (PostgreSQL)",
  () => {
    beforeAll(() => {
      readers.readCompetitorPage.mockImplementation(async (url: string) => ({
        url,
        html: "<html></html>",
        lines: Array.from({ length: 12 }, (_unused, index) => `Line ${index}`),
      }));
      readers.searchExa.mockResolvedValue({ results: [], costUsd: 0.007 });
    }, SETUP_TIMEOUT);

    afterAll(async () => {
      await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
      const billedTo = {
        OR: [
          { userId: { in: userIds } },
          { organizationId: { in: organizationIds } },
        ],
      };
      const db = mainnet();
      await db.creditConsumption.deleteMany({
        where: { transaction: billedTo },
      });
      await db.creditBucket.deleteMany({ where: billedTo });
      await db.transaction.deleteMany({ where: billedTo });
      await prisma.workspace.deleteMany({
        where: { organizationId: { in: organizationIds } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: organizationIds } },
      });
      // The free plan `createPersonalWorkspace` grants is not tied to the user.
      await prisma.subscription.deleteMany({
        where: { referenceId: { in: userIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }, SETUP_TIMEOUT);

    it(
      "charges a person's personal credits, soonest expiry first",
      async () => {
        const payer = await person("funded person");

        expectAsOnBase("a person, funded", await observe(payer, MONDAY));
      },
      CASE_TIMEOUT,
    );

    it(
      "charges an Organization's pool with no member, its Project's credits first",
      async () => {
        const payer = await organization("funded Organization", {
          soonCents: PRICE / 2n,
          laterCents: PRICE,
        });

        expectAsOnBase("an Organization, funded", await observe(payer, MONDAY));
      },
      CASE_TIMEOUT,
    );

    it(
      "charges nothing and runs no check when the credits fall short",
      async () => {
        // Project credits and pool together hold three quarters of the price.
        const payer = await organization("short Organization", {
          soonCents: PRICE / 2n,
          laterCents: 0n,
        });

        expectAsOnBase(
          "an Organization, shortfall",
          await observe(payer, MONDAY),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "fails, with nothing charged, when the credits go between the balance read and the bucket read",
      async () => {
        const payer = await organization("drained Organization", {
          soonCents: PRICE / 2n,
          laterCents: 0n,
        });
        // The two reads cannot disagree in one snapshot: only a bucket that
        // expires between their two clock readings does this.
        vi.spyOn(creditBucketRepository, "getBalance").mockResolvedValueOnce(
          PRICE,
        );

        expectAsOnBase(
          "an Organization, credits gone after the balance read",
          await observe(payer, MONDAY),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "runs an interrupted check again without charging it again",
      async () => {
        const payer = await person("interrupted person");
        expect(await runProjectCompetitorCheck(payer.projectId, MONDAY)).toBe(
          "checked",
        );
        // The check died after its charge: it never finished.
        await prisma.competitorCheck.updateMany({
          where: { projectId: payer.projectId },
          data: { finishedAt: null },
        });

        expectAsOnBase(
          "a person, replay after an interrupted check",
          await observe(payer, new Date(MONDAY.getTime() + 2 * 3_600_000)),
        );
      },
      CASE_TIMEOUT,
    );
  },
);
