/**
 * Coworker usage's charge, on a real PostgreSQL at the route
 * (`POST /me/usage`): what it answers, every row it writes (the debit, its
 * consumptions, the usage row, the low-balance alert's notification), and the
 * statements PostgreSQL received, with each transaction's boundaries and
 * isolation level.
 *
 * All of it is compared with `post-spend.base.json`, which this file wrote
 * while it ran on `origin/main`'s route (`dd9d0b53b`), before the charge moved
 * into the credits module, once on each layout:
 * RECORD_COWORKER_USAGE_SPEND_BASE=true RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter core test src/routes/v1/coworkers/me/usage/post-spend.postgres.test.ts
 * Without `RECORD_COWORKER_USAGE_SPEND_BASE` the same command compares.
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
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

interface SentStatement {
  connection: number;
  text: string;
  values: unknown[];
}
/** What Core's pool sent while a request was observed, per connection. */
const sent = vi.hoisted(() => ({
  observing: false,
  connections: 0,
  log: [] as SentStatement[],
}));
/** What a request reaches outside the database, and its background work. */
const outside = vi.hoisted(() => ({
  background: [] as Promise<unknown>[],
  email: vi.fn(async () => undefined),
  publish: vi.fn(),
  dispatchEmail: vi.fn(async () => undefined),
}));
vi.mock("@vercel/functions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vercel/functions")>();
  return {
    ...actual,
    // Kept, so the low-balance alert the route schedules can be awaited.
    waitUntil: (promise: Promise<unknown>) => {
      outside.background.push(promise);
    },
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
vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});
// The alert runs for real; only what it sends outside is stubbed.
vi.mock("@/helpers/billing-notification-email", () => ({
  sendBillingNotificationEmail: outside.email,
}));
vi.mock("@/helpers/notification-publish-queue", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/helpers/notification-publish-queue")
  >()),
  scheduleNotificationPublish: outside.publish,
}));
vi.mock("@/helpers/notification-email-dispatch", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/helpers/notification-email-dispatch")
  >()),
  dispatchNotificationEmail: outside.dispatchEmail,
}));

import {
  NotificationKind,
  VendorGrantStatus,
  VendorPermission,
} from "@sokosumi/database";
import {
  creditBucketRepository,
  workspaceRepository,
} from "@sokosumi/database/repositories";
import { convertCreditsToCents } from "@sokosumi/utils";

import { errorHandler } from "@/helpers/error-handler";
import { createPersonalWorkspace } from "@/helpers/personal-workspace";
import { createNetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { NETWORK_HEADER } from "@/middleware/network-scope";
import { expectCoreLog } from "@/test/core-log";
import { onSplitLayout } from "@/test/split-layout";

import mountPostCoworkerMeUsage from "./post";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

/**
 * The setup loads Core's routes and creates workspaces through the product's
 * own path: seconds on a loaded machine, past Vitest's 10 s hook limit on CI's
 * runner.
 */
const SETUP_TIMEOUT = 60_000;
/** A case sends requests, waits for the alert and reads every row back. */
const CASE_TIMEOUT = 60_000;
const DAY = 86_400_000;
/** The schema's smallest amount: one cent. */
const SMALLEST_CREDITS = 1e-10;

const BASE_FILE = fileURLToPath(
  new URL("./post-spend.base.json", import.meta.url),
);
const recording = process.env.RECORD_COWORKER_USAGE_SPEND_BASE === "true";
/** Each layout has its own base, recorded there on `origin/main`. */
const layout = onSplitLayout ? "split" : "today";

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
 * debit was Prisma's nested create: a read of each row it connects (the
 * Organization when there is one, then the user), the insert, the
 * consumptions, and a read of the debit back.
 */
const MAIN_CONNECT_ORGANIZATION =
  'SELECT "public"."organization"."id" FROM "public"."organization" WHERE ("public"."organization"."id" = $1 AND 1=1) LIMIT $2 OFFSET $3';
const MAIN_CONNECT_USER =
  'SELECT "public"."user"."id" FROM "public"."user" WHERE ("public"."user"."id" = $1 AND 1=1) LIMIT $2 OFFSET $3';
const MAIN_INSERT_PERSONAL_DEBIT =
  'INSERT INTO "public"."Transaction" ("id","createdAt","updatedAt","amount","userId") VALUES ($1,$2,$3,$4,$5) RETURNING "public"."Transaction"."id"';
const MAIN_INSERT_ORGANIZATION_DEBIT =
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
 * Now the credit bucket repository's `recordSpend` writes it, as it writes
 * the Task charge and the competitor check's: two statements of raw SQL,
 * which name the Network's schema and write the user and the Organization as
 * ids.
 */
const NOW_INSERT_DEBIT =
  'INSERT INTO "public"."Transaction" (id, "createdAt", "updatedAt", amount, "userId", "organizationId") VALUES ($1, $2, $3, $4, $5, $6)';
const NOW_INSERT_CONSUMPTIONS =
  'INSERT INTO "public"."credit_consumption" (id, "createdAt", amount, "bucketId", "transactionId") SELECT c.id, $1::timestamp(3), c.amount, c."bucketId", $2::text FROM unnest($3::text[], $4::bigint[], $5::text[]) AS c(id, amount, "bucketId")';

/**
 * A transaction recorded on `origin/main`, with its debit written as
 * `recordSpend` writes it: the same values in the same place, every other
 * statement untouched. It refuses a debit that is not exactly the statements
 * above. A debit whose insert failed (a lost race) ends at the insert on
 * both.
 */
function asWrittenNow(transaction: Statement[]): Statement[] {
  const at = transaction.findIndex(
    ({ sql }) =>
      sql === MAIN_INSERT_PERSONAL_DEBIT ||
      sql === MAIN_INSERT_ORGANIZATION_DEBIT,
  );
  if (at === -1) return transaction;
  const debit = transaction[at];
  if (!debit) throw new Error("A debit is cut");
  const [debitId, createdAt, updatedAt, amount, userId] = debit.values;
  const organizationId = debit.values[5] ?? null;
  const connects = [
    ...(organizationId === null
      ? []
      : [
          {
            sql: MAIN_CONNECT_ORGANIZATION,
            values: [organizationId, "1", "0"],
          },
        ]),
    { sql: MAIN_CONNECT_USER, values: [userId, "1", "0"] },
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
  const [consumptions, readBack] = transaction.slice(at + 1, at + 3);
  if (!consumptions || !readBack) throw new Error("A debit is cut");
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
    ...transaction.slice(at + 3),
  ];
}

/** Compares with what `origin/main` did, or records it while run there. */
function expectAsOnBase(name: string, observed: unknown) {
  const key = `${layout}: ${name}`;
  if (recording) {
    writeFileSync(
      BASE_FILE,
      `${JSON.stringify({ ...recorded(), [key]: observed }, null, 2)}\n`,
    );
    return;
  }
  const base = recorded()[key] as Observed | undefined;
  expect(base, `no base recorded for "${key}"`).toBeDefined();
  if (!base) return;
  expect(observed).toEqual({
    ...base,
    statements: {
      ...base.statements,
      transactions: base.statements.transactions.map(asWrittenNow),
    },
  });
}

const mainnet = () => createNetworkScope("mainnet").networkDb;

/**
 * On the split layout the route stops at its first statement, the usage read
 * on the shared client (`split-layout-pending.txt` line of
 * `post.postgres.test.ts`, ticket 29), on `origin/main` as at head: each of
 * the case's requests answers 500 and logs it once. The base holds that stop.
 */
function stopsOnTheSplitLayout(requests: number) {
  if (onSplitLayout)
    expectCoreLog(
      "error",
      "Kept a database schema mismatch out of Sentry",
      requests,
    );
}

/** Random values in a statement or a row, each under a name. */
const labels = new Map<string, string>();
const userIds: string[] = [];
const organizationIds: string[] = [];
const vendorId = randomUUID();
const coworkerId = randomUUID();
labels.set(vendorId, "<vendor>");
labels.set(coworkerId, "<coworker>");

/** Whom a usage bills, and who reads the wallet's billing notices. */
interface Payer {
  userId: string;
  organizationId: string | null;
  recipients: string[];
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
  owner: { userId: string } | { organizationId: string },
  bucket: { credits: number; expiresInDays: number },
): Promise<void> {
  const cents = convertCreditsToCents(bucket.credits);
  const created = await mainnet().transaction.create({
    data: {
      amount: cents,
      ...owner,
      sourceCreditBucket: {
        create: {
          amount: cents,
          ...owner,
          expiresAt: new Date(Date.now() + bucket.expiresInDays * DAY),
        },
      },
    },
    select: { id: true, sourceCreditBucket: { select: { id: true } } },
  });
  labels.set(created.id, `<grant of ${name}>`);
  if (created.sourceCreditBucket)
    labels.set(created.sourceCreditBucket.id, `<bucket ${name}>`);
}

async function grantWorkspace(workspaceId: string, name: string) {
  const created = await prisma.vendorGrant.create({
    data: {
      vendorId,
      workspaceId,
      permission: VendorPermission.workspace,
      status: VendorGrantStatus.GRANTED,
    },
    select: { id: true },
  });
  labels.set(created.id, `<grant to ${name}'s workspace>`);
}

/**
 * A person in the personal workspace the product creates, its workspace
 * granted to the Coworker's vendor, with two buckets: the one that expires
 * first holds one credit, so a usage of more spends from both.
 */
async function person(
  name: string,
  credits: { later: number },
  access: "granted" | "none" = "granted",
): Promise<Payer> {
  const userId = await createUser(name);
  const workspace = await createPersonalWorkspace(userId);
  labels.set(workspace.id, `<${name}'s workspace>`);
  // The grants are other writers' (sign-up and free plan), which cannot write
  // on the split layout yet: the fixture's own buckets replace them, so the
  // same credits exist on both layouts.
  await mainnet().creditBucket.deleteMany({ where: { userId } });
  await mainnet().transaction.deleteMany({ where: { userId } });
  if (credits.later > 0) {
    await grant(
      `expiring later of ${name}`,
      { userId },
      { credits: credits.later, expiresInDays: 20 },
    );
  }
  await grant(
    `expiring first of ${name}`,
    { userId },
    { credits: 1, expiresInDays: 1 },
  );
  if (access === "granted") await grantWorkspace(workspace.id, name);
  return { userId, organizationId: null, recipients: [userId] };
}

/**
 * A member of an Organization on a paid plan, so the member needs an assigned
 * Seat, with 50 credits in the pool and the Organization's workspace granted
 * to the Coworker's vendor. Its owner reads the billing notices.
 */
async function seatedOrganizationMember(
  name: string,
  seat: "assigned" | "none",
): Promise<Payer> {
  const ownerId = await createUser(`${name}'s owner`);
  const memberId = await createUser(`${name}'s member`);
  const organizationId = `coworker-usage-spend-${randomUUID()}`;
  await prisma.organization.create({
    data: {
      id: organizationId,
      name: "Coworker usage spend fixture",
      slug: organizationId,
      members: {
        create: [
          { userId: ownerId, role: "owner", seatAssignedAt: new Date() },
          {
            userId: memberId,
            role: "member",
            seatAssignedAt: seat === "assigned" ? new Date() : null,
          },
        ],
      },
    },
  });
  organizationIds.push(organizationId);
  labels.set(organizationId, `<${name}>`);
  const subscription = await prisma.subscription.create({
    data: {
      plan: "standard",
      referenceId: organizationId,
      status: "active",
      seats: 2,
      periodStart: new Date(Date.now() - DAY),
      periodEnd: new Date(Date.now() + 30 * DAY),
    },
    select: { id: true },
  });
  labels.set(subscription.id, `<${name}'s subscription>`);
  const workspace = await workspaceRepository.upsertOrganizationWorkspace({
    organizationId,
    tx: prisma,
  });
  labels.set(workspace.id, `<${name}'s workspace>`);
  await grant(
    `pool of ${name}`,
    { organizationId },
    {
      credits: 50,
      expiresInDays: 10,
    },
  );
  await grantWorkspace(workspace.id, name);
  return { userId: memberId, organizationId, recipients: [ownerId] };
}

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "coworker-usage-spend");
    c.set("isAuthenticated", true);
    c.set("authContext", { actor: "coworker", coworkerId, vendorId });
    await next();
  });
  app.onError(errorHandler);
  mountPostCoworkerMeUsage(app);
  return app;
}

/** An idempotency key, read back under its name. */
function key(name: string): string {
  const value = `${name.replaceAll(" ", "-")}-${randomUUID()}`;
  labels.set(value, `<key ${name}>`);
  return value;
}

interface Usage {
  idempotencyKey: string;
  credits: number;
  referenceId?: string;
}

async function postUsage(
  payer: Payer,
  usage: Usage,
  headers: Record<string, string> = {},
) {
  const response = await createApp().request("http://localhost/me/usage", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      ...usage,
      userId: payer.userId,
      organizationId: payer.organizationId,
    }),
  });
  return { status: response.status, body: await response.json() };
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
  // Longest first: a key holds a random id of its own.
  for (const [random, name] of [...labels].sort(
    ([a], [b]) => b.length - a.length,
  ))
    text = text.replaceAll(random, name);
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
  const open = new Map<number, Statement[]>();
  const transactions: Statement[][] = [];
  const outsideTransactions = new Map<string, number>();
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
      outsideTransactions.set(sql, (outsideTransactions.get(sql) ?? 0) + 1);
    }
  }
  return {
    transactions,
    outsideTransactions: Object.fromEntries(
      [...outsideTransactions].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
  };
}

/**
 * Every credit row of the payer's wallet, the Coworker's usage rows for the
 * payer, and the wallet's billing notices.
 */
async function rows(payer: Payer) {
  const wallet = payer.organizationId
    ? { organizationId: payer.organizationId }
    : { userId: payer.userId, organizationId: null };
  const db = mainnet();
  return {
    buckets: await db.creditBucket.findMany({
      where: wallet,
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        amount: true,
        consumptions: {
          orderBy: { id: "asc" },
          select: { amount: true, transactionId: true },
        },
      },
    }),
    transactions: await db.transaction.findMany({
      where: { ...wallet, amount: { lte: 0n } },
      orderBy: { id: "asc" },
    }),
    consumptions: await db.creditConsumption.findMany({
      where: { transaction: wallet },
      orderBy: [{ transactionId: "asc" }, { bucket: { expiresAt: "asc" } }],
    }),
    usage: await db.coworkerUsage.findMany({
      where: { coworkerId, userId: payer.userId },
      orderBy: { id: "asc" },
    }),
    notifications: await prisma.notification.findMany({
      where: {
        userId: { in: payer.recipients },
        kind: NotificationKind.BILLING,
      },
      orderBy: { id: "asc" },
      select: {
        userId: true,
        referenceId: true,
        eventId: true,
        messageKey: true,
        messageParams: true,
        metadata: true,
        inApp: true,
      },
    }),
  };
}

/** Waits for the work the requests scheduled, the low-balance alert's too. */
async function drainBackground() {
  while (outside.background.length > 0) {
    await Promise.allSettled(outside.background.splice(0));
  }
}

/**
 * One request, or several at once: the answers, the statements they sent,
 * what they sent outside the database, and the rows they left.
 */
async function observe(payer: Payer, run: () => Promise<unknown>) {
  outside.email.mockClear();
  outside.publish.mockClear();
  outside.dispatchEmail.mockClear();
  const started = Date.now();
  sent.log = [];
  sent.observing = true;
  let answer: unknown;
  try {
    answer = await run();
    await drainBackground();
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
    answer,
    lowBalanceEmails: outside.email.mock.calls,
    notificationPublishes: outside.publish.mock.calls.length,
    notificationEmails: outside.dispatchEmail.mock.calls.length,
    statements: statements(sent.log),
    rows: left,
    // What `plain` hides of the debit's rows: the kind of id, and that their
    // times are this request's.
    debit: {
      uuidVersions: debitRows.map((row) => row.id.charAt(14)),
      timesWithinTheRequest: debitTimes.map(
        (time) => time.getTime() >= started && time.getTime() <= ended,
      ),
    },
  });
}

const realPrepareConsumption = creditBucketRepository.prepareConsumption;

/**
 * Holds the next bucket read, after it read, until released: its request
 * keeps its transaction open with the buckets read and nothing written.
 */
function holdNextBucketRead() {
  let reach: () => void = () => undefined;
  let release: () => void = () => undefined;
  const reached = new Promise<void>((resolve) => {
    reach = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(creditBucketRepository, "prepareConsumption").mockImplementationOnce(
    async (...args) => {
      const consumptions = await realPrepareConsumption.apply(
        creditBucketRepository,
        args,
      );
      reach();
      await released;
      return consumptions;
    },
  );
  return { reached, release };
}

/**
 * Two requests at once: the first reads the buckets and waits; the second
 * runs whole; then the first goes on. A first request that ends before its
 * bucket read (as on the split layout) is not waited for.
 */
async function overlapping(
  first: () => Promise<unknown>,
  second: () => Promise<unknown>,
) {
  const hold = holdNextBucketRead();
  const firstAnswer = first();
  await Promise.race([hold.reached, firstAnswer]);
  const secondAnswer = await second();
  hold.release();
  return { first: await firstAnswer, second: secondAnswer };
}

describe.skipIf(!enabled)(
  "Coworker usage's charge, as on origin/main (PostgreSQL)",
  () => {
    beforeAll(async () => {
      await prisma.vendor.create({
        data: {
          id: vendorId,
          name: "Usage spend vendor",
          slug: `usage-spend-${vendorId}`,
          coworkers: {
            create: {
              id: coworkerId,
              slug: `usage-spend-${coworkerId}`,
              name: "Usage spend coworker",
              capabilities: ["tasks"],
            },
          },
        },
      });
    }, SETUP_TIMEOUT);

    // A held or failing bucket read a case did not reach stays in its case.
    afterEach(() => {
      vi.restoreAllMocks();
    });

    afterAll(async () => {
      const db = mainnet();
      await db.coworkerUsage.deleteMany({ where: { coworkerId } });
      const wallets = {
        OR: [
          { userId: { in: userIds } },
          { organizationId: { in: organizationIds } },
        ],
      };
      await db.creditConsumption.deleteMany({
        where: { transaction: wallets },
      });
      await db.creditBucket.deleteMany({ where: wallets });
      await db.transaction.deleteMany({ where: wallets });
      await prisma.notification.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.vendorGrant.deleteMany({ where: { vendorId } });
      await prisma.coworker.deleteMany({ where: { id: coworkerId } });
      await prisma.vendor.deleteMany({ where: { id: vendorId } });
      await prisma.workspace.deleteMany({
        where: { organizationId: { in: organizationIds } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: organizationIds } },
      });
      // The free plan `createPersonalWorkspace` grants is not tied to the user.
      await prisma.subscription.deleteMany({
        where: {
          referenceId: { in: [...userIds, ...organizationIds] },
        },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }, SETUP_TIMEOUT);

    it(
      "charges a person's credits, soonest expiry first, with no alert above the threshold",
      async () => {
        const payer = await person("funded person", { later: 200 });
        stopsOnTheSplitLayout(1);
        const usage = {
          idempotencyKey: key("funded"),
          credits: 2.5,
          referenceId: "reference-funded",
        };

        expectAsOnBase(
          "a person, funded",
          await observe(payer, () => postUsage(payer, usage)),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "charges the smallest amount the schema lets through, one cent",
      async () => {
        const payer = await person("smallest person", { later: 200 });
        stopsOnTheSplitLayout(1);
        const usage = {
          idempotencyKey: key("smallest"),
          credits: SMALLEST_CREDITS,
        };

        expectAsOnBase(
          "a person, the smallest amount",
          await observe(payer, () => postUsage(payer, usage)),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "warns the wallet after a charge that leaves it below the threshold",
      async () => {
        const payer = await person("low person", { later: 9 });
        stopsOnTheSplitLayout(1);
        const usage = { idempotencyKey: key("low"), credits: 2.5 };

        expectAsOnBase(
          "a person, low balance after the charge",
          await observe(payer, () => postUsage(payer, usage)),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "refuses a usage the credits do not cover, and writes nothing",
      async () => {
        const payer = await person("short person", { later: 9 });
        stopsOnTheSplitLayout(1);
        const usage = { idempotencyKey: key("short"), credits: 20 };

        expectAsOnBase(
          "a person, short",
          await observe(payer, () => postUsage(payer, usage)),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "answers a matching replay with the original usage, after the grant was revoked",
      async () => {
        const payer = await person("replaying person", { later: 200 });
        stopsOnTheSplitLayout(2);
        const usage = {
          idempotencyKey: key("replayed"),
          credits: 2.5,
          referenceId: "reference-replayed",
        };
        // Recorded, not asserted: on the split layout it stops there too.
        const original = await postUsage(payer, usage);
        await drainBackground();
        await prisma.vendorGrant.updateMany({
          where: { vendorId, workspace: { userId: payer.userId } },
          data: { status: VendorGrantStatus.REVOKED },
        });

        expectAsOnBase(
          "a person, matching replay after revocation",
          await observe(payer, async () => ({
            original,
            replay: await postUsage(payer, usage),
          })),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "refuses a replay with other parameters, and writes nothing",
      async () => {
        const payer = await person("mismatching person", { later: 200 });
        stopsOnTheSplitLayout(2);
        const usage = { idempotencyKey: key("mismatched"), credits: 2.5 };
        const original = await postUsage(payer, usage);
        await drainBackground();

        expectAsOnBase(
          "a person, mismatching replay",
          await observe(payer, async () => ({
            original,
            replay: await postUsage(payer, { ...usage, credits: 3 }),
          })),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "refuses a person whose workspace the Coworker's vendor may not bill",
      async () => {
        const payer = await person("ungranted person", { later: 200 }, "none");
        stopsOnTheSplitLayout(1);
        const usage = { idempotencyKey: key("ungranted"), credits: 2.5 };

        expectAsOnBase(
          "a person, no access",
          await observe(payer, () => postUsage(payer, usage)),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "refuses a usage that names Preprod while Preprod is off, with the scope's 403",
      async () => {
        const payer = await person("preprod person", { later: 200 });
        stopsOnTheSplitLayout(1);
        const usage = { idempotencyKey: key("preprod"), credits: 2.5 };

        expectAsOnBase(
          "a person, names Preprod while it is off",
          await observe(payer, () =>
            postUsage(payer, usage, { [NETWORK_HEADER]: "preprod" }),
          ),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "charges the pool for a seated member of a paid Organization, and warns its owner",
      async () => {
        const payer = await seatedOrganizationMember("seated", "assigned");
        stopsOnTheSplitLayout(1);
        const usage = { idempotencyKey: key("seated"), credits: 2.5 };

        expectAsOnBase(
          "an Organization, seated member",
          await observe(payer, () => postUsage(payer, usage)),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "refuses a member of a paid Organization with no assigned Seat",
      async () => {
        const payer = await seatedOrganizationMember("unseated", "none");
        stopsOnTheSplitLayout(1);
        const usage = { idempotencyKey: key("unseated"), credits: 2.5 };

        expectAsOnBase(
          "an Organization, member without a Seat",
          await observe(payer, () => postUsage(payer, usage)),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "retries a conflict the bucket read reports in PostgreSQL's words",
      async () => {
        const payer = await person("raw conflict person", { later: 200 });
        stopsOnTheSplitLayout(1);
        const usage = { idempotencyKey: key("raw conflict"), credits: 2.5 };
        // A real 40001 from PostgreSQL, in the route's transaction, where the
        // bucket read's raw SQL would meet it.
        vi.spyOn(
          creditBucketRepository,
          "prepareConsumption",
        ).mockImplementationOnce(async (_network, _user, _org, _cents, tx) => {
          await tx.$executeRawUnsafe(
            "DO $$ BEGIN RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'could not serialize access due to read/write dependencies among transactions'; END $$",
          );
          throw new Error("The raised conflict did not throw");
        });

        expectAsOnBase(
          "a person, PostgreSQL's conflict in the bucket read",
          await observe(payer, () => postUsage(payer, usage)),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "answers a conflict the plan read reports as Prisma's P2034 once",
      async () => {
        const payer = await seatedOrganizationMember("P2034", "assigned");
        stopsOnTheSplitLayout(1);
        const usage = { idempotencyKey: key("P2034"), credits: 2.5 };
        // What Prisma throws when a model read (the plan, the Seat) meets a
        // serialization failure: known by its code, its text names no 40001.
        vi.spyOn(
          creditBucketRepository,
          "prepareConsumption",
        ).mockRejectedValueOnce(
          Object.assign(
            new Error(
              "Transaction failed due to a write conflict or a deadlock. Please retry your transaction",
            ),
            { code: "P2034" },
          ),
        );

        expectAsOnBase(
          "an Organization, Prisma's conflict in the plan read",
          await observe(payer, () => postUsage(payer, usage)),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "charges once for two requests with the same key at once",
      async () => {
        const payer = await person("same key person", { later: 200 });
        stopsOnTheSplitLayout(2);
        const usage = { idempotencyKey: key("same key"), credits: 2.5 };

        expectAsOnBase(
          "a person, the same key twice at once",
          await observe(payer, () =>
            overlapping(
              () => postUsage(payer, usage),
              () => postUsage(payer, usage),
            ),
          ),
        );
      },
      CASE_TIMEOUT,
    );

    // Two connections spend the same credits: 10 in all, 6 and 7 asked.
    for (const order of ["six first", "seven first"] as const) {
      it(
        `lets one of two usages over the same credits through, ${order}`,
        async () => {
          const payer = await person(`racing person ${order}`, { later: 9 });
          stopsOnTheSplitLayout(2);
          const six = { idempotencyKey: key(`six ${order}`), credits: 6 };
          const seven = { idempotencyKey: key(`seven ${order}`), credits: 7 };
          const [first, second] =
            order === "six first" ? [six, seven] : [seven, six];

          expectAsOnBase(
            `a person, two usages over the same credits, ${order}`,
            await observe(payer, () =>
              overlapping(
                () => postUsage(payer, first),
                () => postUsage(payer, second),
              ),
            ),
          );
        },
        CASE_TIMEOUT,
      );
    }
  },
);
