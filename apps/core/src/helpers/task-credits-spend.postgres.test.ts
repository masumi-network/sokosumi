/**
 * The Task writer (`createTaskEventTransaction`) on a real PostgreSQL, at the
 * entry points that reach it: a Coworker's Task event over HTTP with a real
 * key, a Masumi payment and its claim, Find people (contacts) and the fal
 * callback that settles a Studio image. For each: the answer, every credit row
 * and receipt it left, and the statements PostgreSQL received, with each
 * transaction's boundaries and isolation level. Two requests that spend the
 * same credits at once are run in both orders.
 *
 * All of it is compared with `task-credits-spend.base.json`, which this file
 * wrote while it ran with `helpers/task-credits.ts` as it was before the
 * writer called the credits module (`4d353a8c8`, the parent of #8511):
 * RECORD_TASK_CREDITS_SPEND_BASE=true RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter core test src/helpers/task-credits-spend.postgres.test.ts
 * Without `RECORD_TASK_CREDITS_SPEND_BASE` the same command compares. Each
 * layout has its own part of the file.
 *
 * It needs the database to itself, as CI gives each worker its own
 * (`POSTGRES_TEST_DATABASE_PER_WORKER`): another file's Serializable
 * transaction on the same database can make a charge retry, and a retry is a
 * second transaction in the statements.
 */
// First: schemas built before this module loads have no `.openapi`, and the
// `/v1` router needs it on the ones `@sokosumi/utils` exports.
import "@hono/zod-openapi";

import crypto, { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
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
/** Work a request hands to `waitUntil`, awaited as part of that request. */
const background = vi.hoisted(() => [] as Promise<unknown>[]);
const fixture = vi.hoisted(() => ({
  /** The next event response read throws once: after the charge, in its transaction. */
  failAfterCharge: false,
  /** Task ids whose first event response read waits for its release. */
  held: new Map<string, { reached: () => void; release: Promise<void> }>(),
  lowBalanceAlert: vi.fn(async (_billed: unknown) => undefined),
  downloadMedia: vi.fn(),
  put: vi.fn(),
}));
vi.mock("@vercel/functions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vercel/functions")>();
  return {
    ...actual,
    waitUntil: vi.fn((work: Promise<unknown>) => {
      background.push(work);
    }),
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
// What the requests reach outside the database.
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      FAL_KEY: "k",
      BLOB_READ_WRITE_TOKEN: "shared-public-store-token",
      IMAGE_STUDIO_BLOB_READ_WRITE_TOKEN: "studio-private-store-token",
    }),
  };
});
vi.mock("@/helpers/billing-notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/billing-notifications")>()),
  notifyLowBalanceAfterCharge: fixture.lowBalanceAlert,
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
vi.mock("@/services/project-memory.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/project-memory.service")>();
  return {
    ...actual,
    projectMemoryService: {
      ...actual.projectMemoryService,
      refreshAfterTaskCompleted: vi.fn(async () => undefined),
    },
  };
});
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
// The last step inside the event's transaction, after the charge and the
// event are written: a test makes it throw once, or wait for its release.
vi.mock(
  "@/routes/v1/tasks/[id]/events/map-created-event",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/routes/v1/tasks/[id]/events/map-created-event")
      >();
    return {
      mapCreatedTaskEventForResponse: (async (...args) => {
        const [tx, eventId] = args;
        if (fixture.failAfterCharge) {
          fixture.failAfterCharge = false;
          throw new Error("after the charge");
        }
        // Only a race case holds a request: every other case sends exactly
        // the route's own statements.
        if (fixture.held.size > 0) {
          const { taskId } = await tx.taskEvent.findUniqueOrThrow({
            where: { id: eventId },
            select: { taskId: true },
          });
          const held = fixture.held.get(taskId);
          if (held) {
            fixture.held.delete(taskId);
            held.reached();
            await held.release;
          }
        }
        return actual.mapCreatedTaskEventForResponse(...args);
      }) satisfies typeof actual.mapCreatedTaskEventForResponse,
    };
  },
);
// Studio: fal's media, Blob and the copy into Files.
vi.mock("@/services/image-studio-drive.service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/services/image-studio-drive.service")
  >()),
  publishStudioAssetToFiles: vi.fn(),
}));
vi.mock("@vercel/blob", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/blob")>()),
  put: fixture.put,
}));
vi.mock("@/lib/image-studio/fal-client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/image-studio/fal-client")>(
    "@/lib/image-studio/fal-client",
  )),
  downloadMedia: fixture.downloadMedia,
}));

import { workspaceRepository } from "@sokosumi/database/repositories";
import { convertCreditsToCents } from "@sokosumi/utils";

import { createPersonalWorkspace } from "@/helpers/personal-workspace";
import { createNetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import { resetJwksCacheForTests } from "@/lib/image-studio/fal-webhook";
import falImageJobs from "@/routes/webhooks/fal/image-jobs";
import { createContactList } from "@/services/contact-lists.service";
import {
  findPeopleForList,
  type PeopleSearchDeps,
} from "@/services/contact-suggestions.service";
import { inContactTransaction } from "@/services/contacts.service";
import { markOutOfCreditsTasksAsToppedUp } from "@/services/task-topup.service";
import { expectCoreLog } from "@/test/core-log";
import { pngBytes } from "@/test/image-bytes";
import { onSplitLayout } from "@/test/split-layout";
import {
  createCoreApp,
  createCoworkerKey,
  createPasswordUser,
} from "@/test-fixtures/core-session";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

/**
 * The setup loads all of Core's `/v1` and creates workspaces through the
 * product's own path: seconds on a loaded machine, past Vitest's 10 s hook
 * limit on CI's runner.
 */
const SETUP_TIMEOUT = 60_000;
/** A case sends several requests and reads every row back. */
const CASE_TIMEOUT = 60_000;
const DAY = 86_400_000;
const ORIGIN = "https://example.com";
const CREDIT = convertCreditsToCents(1);

const BASE_FILE = fileURLToPath(
  new URL("./task-credits-spend.base.json", import.meta.url),
);
const recording = process.env.RECORD_TASK_CREDITS_SPEND_BASE === "true";
const LAYOUT = onSplitLayout ? "split layout" : "today's layout";

function recorded(): Record<string, Record<string, unknown>> {
  return existsSync(BASE_FILE)
    ? (JSON.parse(readFileSync(BASE_FILE, "utf8")) as Record<
        string,
        Record<string, unknown>
      >)
    : {};
}

/**
 * Compares with what `origin/main` did on this layout, or records it while
 * run there. The Task writer's debit was already `recordSpend`'s two
 * statements on `origin/main`, so nothing is rewritten before comparing.
 */
function expectAsOnBase(key: string, observed: unknown) {
  if (recording) {
    const all = recorded();
    writeFileSync(
      BASE_FILE,
      `${JSON.stringify(
        { ...all, [LAYOUT]: { ...all[LAYOUT], [key]: observed } },
        null,
        2,
      )}\n`,
    );
    return;
  }
  const base = recorded()[LAYOUT]?.[key];
  expect(base, `no base recorded for "${key}" on ${LAYOUT}`).toBeDefined();
  expect(observed).toEqual(base);
}

const mainnet = () => createNetworkScope("mainnet").networkDb;

/** Random values in a statement or a row, each under a name. */
const labels = new Map<string, string>();
const userIds: string[] = [];
const organizationIds: string[] = [];
const workspaceIds: string[] = [];
const projectIds: string[] = [];
const taskIds: string[] = [];
const vendorIds: string[] = [];
/** Removals of rows no fixture person or Task ties, newest first. */
const removals: (() => Promise<unknown>)[] = [];

/** What the running case made: its rows are the ones it reads back. */
const thisCase = {
  userIds: [] as string[],
  organizationIds: [] as string[],
  workspaceIds: [] as string[],
  projectIds: [] as string[],
  taskIds: [] as string[],
};
function track(kind: keyof typeof thisCase, id: string) {
  thisCase[kind].push(id);
  ({ userIds, organizationIds, workspaceIds, projectIds, taskIds })[kind].push(
    id,
  );
}

const billedTo = (made: typeof thisCase = thisCase) => ({
  OR: [
    { userId: { in: made.userIds } },
    { organizationId: { in: made.organizationIds } },
  ],
});
const everything = () => ({
  userIds,
  organizationIds,
  workspaceIds,
  projectIds,
  taskIds,
});

let coworker: { id: string; token: string } | undefined;
async function theCoworker() {
  if (coworker) return coworker;
  const { token, vendorId } = await createCoworkerKey();
  vendorIds.push(vendorId);
  const row = await prisma.coworker.findFirstOrThrow({ where: { vendorId } });
  await prisma.coworker.update({
    where: { id: row.id },
    data: { capabilities: ["tasks"], isWhitelisted: true },
  });
  labels.set(row.id, "<coworker>");
  labels.set(row.slug, "<coworker slug>");
  labels.set(vendorId, "<vendor>");
  coworker = { id: row.id, token };
  return coworker;
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

interface Payer {
  ownerId: string | null;
  organizationId: string | null;
  workspaceId: string;
  projectId: string;
}

async function createProject(workspaceId: string, name: string) {
  const project = await prisma.project.create({
    data: { workspaceId, name: `${name}'s Project` },
    select: { id: true },
  });
  track("projectIds", project.id);
  labels.set(project.id, `<${name}'s Project>`);
  return project.id;
}

/**
 * A person in the personal workspace the product creates, with two buckets:
 * the one that expires first holds half a credit, so a charge of one credit
 * spends from both.
 */
async function person(name: string, credits = CREDIT): Promise<Payer> {
  const user = await createPasswordUser(name);
  track("userIds", user.id);
  labels.set(user.id, `<${name}>`);
  labels.set(user.email, `<${name}'s email>`);
  const workspace = await createPersonalWorkspace(user.id);
  track("workspaceIds", workspace.id);
  labels.set(workspace.id, `<${name}'s workspace>`);
  // The sign-up and free plan grants are other writers' and differ in size:
  // the fixture's own buckets replace them.
  await mainnet().creditBucket.deleteMany({ where: { userId: user.id } });
  await mainnet().transaction.deleteMany({ where: { userId: user.id } });
  if (credits > 0n) {
    await grant(
      `expiring later of ${name}`,
      { userId: user.id },
      { cents: credits, expiresInDays: 20 },
    );
    await grant(
      `expiring first of ${name}`,
      { userId: user.id },
      { cents: CREDIT / 2n, expiresInDays: 1 },
    );
  }
  return {
    ownerId: user.id,
    organizationId: null,
    workspaceId: workspace.id,
    projectId: await createProject(workspace.id, name),
  };
}

/**
 * An Organization with one seated member, whose Project holds a quarter
 * credit of Project credits beside a pool of half a credit that expires soon
 * and one that expires later. Granted latest-expiring first: the spend order
 * is not the creation order.
 */
async function organization(
  name: string,
): Promise<Payer & { memberId: string }> {
  const member = await createPasswordUser(`${name}'s member`);
  track("userIds", member.id);
  labels.set(member.id, `<${name}'s member>`);
  labels.set(member.email, `<${name}'s member's email>`);
  const organizationId = `task-spend-${randomUUID()}`;
  await prisma.organization.create({
    data: {
      id: organizationId,
      name: "Task spend fixture",
      slug: organizationId,
      members: {
        create: {
          userId: member.id,
          role: "member",
          seatAssignedAt: new Date(),
        },
      },
    },
  });
  track("organizationIds", organizationId);
  labels.set(organizationId, `<${name}>`);
  const workspace = await workspaceRepository.upsertOrganizationWorkspace({
    organizationId,
    tx: prisma,
  });
  track("workspaceIds", workspace.id);
  labels.set(workspace.id, `<${name}'s workspace>`);
  const projectId = await createProject(workspace.id, name);
  const owner = { organizationId };
  await grant(`pool later of ${name}`, owner, {
    cents: CREDIT,
    expiresInDays: 20,
  });
  await grant(`pool soon of ${name}`, owner, {
    cents: CREDIT / 2n,
    expiresInDays: 5,
  });
  await grant(`Project credits of ${name}`, owner, {
    cents: CREDIT / 4n,
    expiresInDays: 40,
    projectId,
  });
  return {
    memberId: member.id,
    ownerId: member.id,
    organizationId,
    workspaceId: workspace.id,
    projectId,
  };
}

/** A Task of the payer, assigned to the Coworker. */
async function task(
  payer: Payer,
  name: string,
  status: "RUNNING" | "COMPLETED" = "RUNNING",
) {
  const created = await prisma.task.create({
    data: {
      ownerId: payer.ownerId,
      creatorUserId: payer.ownerId,
      organizationId: payer.organizationId,
      workspaceId: payer.workspaceId,
      projectId: payer.projectId,
      assigneeId: (await theCoworker()).id,
      name: "Task spend fixture",
      status,
    },
  });
  track("taskIds", created.id);
  labels.set(created.id, `<${name}>`);
  return created.id;
}

/** A credit cost of 1 credit per unit, removed with the fixture. */
async function creditCost(unit: string) {
  const scope = createNetworkScope("mainnet");
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
  removals.push(() => write(true));
  await write(false);
}

/** A Masumi payment (V1) of one credit in a unit of its own. */
async function masumiPayment(name: string) {
  const unit = randomBytes(30).toString("hex");
  labels.set(unit, `<unit of ${name}>`);
  await creditCost(unit);
  const blockchainIdentifier = randomBytes(20).toString("hex");
  labels.set(blockchainIdentifier, `<${name}>`);
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
    Amounts: [{ amount: "1", unit }],
  };
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const TIME =
  /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/g;
/** Prisma's cuid ids (Task events, claims) and the request id in an answer. */
const CUID = /\bc[a-z0-9]{24}\b/g;

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
  const number = (id: string) => {
    if (!made.has(id)) made.set(id, `<id ${made.size + 1}>`);
    return made.get(id) ?? id;
  };
  text = text.replace(UUID, number).replace(CUID, number);
  return JSON.parse(text.replace(TIME, "<time>"));
}

/**
 * The statements as PostgreSQL received them. A transaction is the statements
 * of one connection from its BEGIN to its COMMIT or ROLLBACK, in the order
 * sent, with the values bound. Statements outside a transaction can run side
 * by side, so they are counted per text. Schema names stay as sent: each
 * layout has its own part of the base file.
 */
function statements(log: readonly SentStatement[]) {
  const open = new Map<number, { sql: string; values: unknown[] }[]>();
  const transactions: { sql: string; values: unknown[] }[][] = [];
  const outside = new Map<string, number>();
  for (const { connection, text, values } of log) {
    const sql = text.replace(/\s+/g, " ").trim();
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

/**
 * The statements of two connections that ran at once. Which one sends first
 * is the scheduler's choice, so each transaction is made plain on its own
 * (its ids numbered within it), and the transactions are a sorted list. Each
 * transaction's own order, values, boundaries and isolation level stay.
 */
function interleavedStatements(log: readonly SentStatement[]) {
  const { transactions, outsideTransactions } = statements(log);
  return {
    transactions: transactions
      .map((transaction) => plain(transaction))
      .sort((a, b) => {
        const [x, y] = [JSON.stringify(a), JSON.stringify(b)];
        return x < y ? -1 : x > y ? 1 : 0;
      }),
    outsideTransactions,
  };
}

/**
 * Every credit row of the fixture's payers, and every receipt of their work:
 * Tasks, events, claims, contact searches and Studio jobs.
 */
async function rows() {
  const db = mainnet();
  return {
    buckets: await db.creditBucket.findMany({
      where: billedTo(),
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        amount: true,
        userId: true,
        organizationId: true,
        projectId: true,
        consumptions: {
          orderBy: { id: "asc" },
          select: { amount: true, transactionId: true },
        },
      },
    }),
    debits: await db.transaction.findMany({
      where: { ...billedTo(), amount: { lt: 0n } },
      orderBy: { id: "asc" },
    }),
    consumptions: await db.creditConsumption.findMany({
      where: { transaction: billedTo() },
      orderBy: [{ transactionId: "asc" }, { bucket: { expiresAt: "asc" } }],
    }),
    claims: await db.taskPaymentClaim.findMany({
      where: { transaction: billedTo() },
      orderBy: { id: "asc" },
    }),
    tasks: await prisma.task.findMany({
      where: { id: { in: thisCase.taskIds } },
      orderBy: { createdAt: "asc" },
      select: { id: true, status: true },
    }),
    events: await prisma.taskEvent.findMany({
      where: { taskId: { in: thisCase.taskIds } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        taskId: true,
        status: true,
        comment: true,
        cents: true,
        transactionId: true,
        network: true,
        userId: true,
        coworkerId: true,
        channel: true,
      },
    }),
    contactSuggestions: await prisma.contactSuggestion.findMany({
      where: { workspaceId: { in: thisCase.workspaceIds } },
      orderBy: { profileKey: "asc" },
      select: {
        searchId: true,
        listId: true,
        profileKey: true,
        profileUrl: true,
        name: true,
        role: true,
        organization: true,
        location: true,
        reason: true,
        status: true,
        contactId: true,
      },
    }),
    contactSearches: await prisma.contactPeopleSearch.findMany({
      where: { workspaceId: { in: thisCase.workspaceIds } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        found: true,
        requested: true,
        chargedCents: true,
        transactionId: true,
        costUsdMicros: true,
      },
    }),
    studioJobs: await prisma.projectImageJob.findMany({
      where: { projectId: { in: thisCase.projectIds } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        status: true,
        chargedCents: true,
        transactionId: true,
        settledAt: true,
      },
    }),
    studioAssets: await prisma.projectImageAsset.findMany({
      where: { projectId: { in: thisCase.projectIds } },
      orderBy: { createdAt: "asc" },
      select: {
        jobId: true,
        version: true,
        model: true,
        prompt: true,
        contentType: true,
        mediaType: true,
        width: true,
        height: true,
        bytes: true,
        checksum: true,
      },
    }),
  };
}

/** Runs `act` and records what it answered and sent, and the rows after it. */
async function observe(
  act: () => Promise<unknown>,
  options: { interleaved?: boolean } = {},
) {
  fixture.lowBalanceAlert.mockClear();
  sent.log = [];
  sent.observing = true;
  let answer: unknown;
  try {
    answer = await act();
    while (background.length > 0) {
      await Promise.allSettled(background.splice(0));
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    answer = { threw: { name: error.name, message: error.message } };
  } finally {
    sent.observing = false;
  }
  const left = await rows();
  // Two Tasks made in the same millisecond have no order of their own: by
  // their names, each Task's events in the order they were written. Sorted
  // before ids are numbered, so the numbers follow the same order.
  const named = (id: string) => labels.get(id) ?? id;
  const byName = (a: string, b: string) =>
    named(a) < named(b) ? -1 : named(a) > named(b) ? 1 : 0;
  left.tasks.sort((a, b) => byName(a.id, b.id));
  left.events.sort((a, b) => byName(a.taskId, b.taskId));
  // Before `plain` turns ids and times into names: a debit's rows are UUID v7,
  // and a debit is one instant, its update time and each consumption's
  // creation time equal its creation time.
  for (const debit of left.debits) {
    const consumptions = left.consumptions.filter(
      (consumption) => consumption.transactionId === debit.id,
    );
    expect([debit, ...consumptions].map((row) => row.id.charAt(14))).toEqual(
      [debit, ...consumptions].map(() => "7"),
    );
    const times = [
      debit.updatedAt,
      ...consumptions.map((consumption) => consumption.createdAt),
    ];
    expect(times.map((time) => time.getTime())).toEqual(
      times.map(() => debit.createdAt.getTime()),
    );
  }
  return plain({
    answer,
    lowBalanceAlerts: fixture.lowBalanceAlert.mock.calls.map(
      ([billed]) => billed,
    ),
    statements: options.interleaved
      ? interleavedStatements(sent.log)
      : statements(sent.log),
    rows: left,
  });
}

/** A Coworker's Task event over HTTP: its status and body, without time and request id. */
async function event(
  taskId: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  const response = await app.request(`${ORIGIN}/v1/tasks/${taskId}/events`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      authorization: `Bearer ${(await theCoworker()).token}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  const meta = parsed?.meta as Record<string, unknown> | undefined;
  if (meta) {
    delete meta.timestamp;
    delete meta.requestId;
  }
  return { status: response.status, body: parsed };
}

let app: ReturnType<typeof createCoreApp>;

/**
 * Where the route stops on the split layout, as on `origin/main`: the event's
 * response read joins Transaction on the default client, which has no Network
 * table there until ticket 27, so the request answers 500 and its
 * transaction, debit included, rolls back. Each such request logs this once.
 */
function stopsOnTheSplitLayout(requests: number) {
  if (onSplitLayout)
    expectCoreLog(
      "error",
      "Kept a database schema mismatch out of Sentry",
      requests,
    );
}

describe.skipIf(!enabled)(
  "the Task writer's charge, as on origin/main (PostgreSQL)",
  () => {
    beforeEach(async () => {
      for (const ids of Object.values(thisCase)) ids.length = 0;
      // Keep the key's usage write throttled for the cases that reuse it.
      await prisma.coworkerApiKey.updateMany({
        where: { coworkerId: (await theCoworker()).id },
        data: { lastUsedAt: new Date(Date.now() + DAY) },
      });
    });

    beforeAll(async () => {
      app = createCoreApp();
      await theCoworker();
    }, SETUP_TIMEOUT);

    afterAll(async () => {
      const db = mainnet();
      await db.taskPaymentClaim.deleteMany({
        where: { transaction: billedTo(everything()) },
      });
      await prisma.contactSuggestion.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await prisma.contactPeopleSearch.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await prisma.contactList.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await prisma.projectImageAsset.deleteMany({
        where: { projectId: { in: projectIds } },
      });
      await prisma.projectImageJob.deleteMany({
        where: { projectId: { in: projectIds } },
      });
      await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
      await db.creditConsumption.deleteMany({
        where: { transaction: billedTo(everything()) },
      });
      await db.creditBucket.deleteMany({ where: billedTo(everything()) });
      await db.transaction.deleteMany({ where: billedTo(everything()) });
      for (const removal of removals.reverse()) await removal();
      await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
      await prisma.coworker.deleteMany({
        where: { vendorId: { in: vendorIds } },
      });
      await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
      await prisma.workspace.deleteMany({
        where: { id: { in: workspaceIds } },
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
      "charges a Task's Owner their personal credits, soonest expiry first",
      async () => {
        // Record the first-use write in this case even when it runs alone.
        await prisma.coworkerApiKey.updateMany({
          where: { coworkerId: (await theCoworker()).id },
          data: { lastUsedAt: null },
        });
        stopsOnTheSplitLayout(1);
        const payer = await person("funded person");
        const taskId = await task(payer, "funded person's Task");

        expectAsOnBase(
          "an Owner's personal credits",
          await observe(() =>
            event(taskId, { status: "COMPLETED", credits: 1 }),
          ),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "charges an Owner in an Organization, the Project's credits first",
      async () => {
        stopsOnTheSplitLayout(1);
        const payer = await organization("Owner's Organization");
        const taskId = await task(payer, "Organization Task");

        expectAsOnBase(
          "an Owner in an Organization",
          await observe(() =>
            event(taskId, { status: "COMPLETED", credits: 1 }),
          ),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "charges work without an Owner to the Organization pool with no member",
      async () => {
        stopsOnTheSplitLayout(1);
        const payer = await organization("ownerless Organization");
        const taskId = await task(
          { ...payer, ownerId: null },
          "ownerless Task",
        );

        expectAsOnBase(
          "an Organization pool with no Owner",
          await observe(() =>
            event(taskId, { status: "COMPLETED", credits: 1 }),
          ),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "pauses a running Task whose credits fall short, then a top-up wakes it and the charge lands",
      async () => {
        stopsOnTheSplitLayout(2);
        // Half a credit and a later full one: two credits do not fit.
        const payer = await person("short person");
        const taskId = await task(payer, "short person's Task");

        const paused = await observe(() =>
          event(taskId, { status: "COMPLETED", credits: 2 }),
        );
        const woken = await observe(async () => {
          if (!payer.ownerId) throw new Error("The fixture has an Owner");
          const ownerId = payer.ownerId;
          await grant(
            "top-up of short person",
            { userId: ownerId },
            { cents: CREDIT, expiresInDays: 30 },
          );
          await prisma.$transaction((tx) =>
            markOutOfCreditsTasksAsToppedUp({
              userId: ownerId,
              organizationId: null,
              tx,
            }),
          );
          return "topped up";
        });
        const charged = await observe(() =>
          event(taskId, { status: "COMPLETED", credits: 2 }),
        );

        expectAsOnBase("short, paused, woken and charged", {
          paused,
          woken,
          charged,
        });
      },
      CASE_TIMEOUT,
    );

    it(
      "answers a finished Task whose credits fall short with a plain 422 and no pause",
      async () => {
        const payer = await person("short person, finished Task", 0n);
        const taskId = await task(
          payer,
          "short person's finished Task",
          "COMPLETED",
        );

        expectAsOnBase(
          "short, a finished Task",
          await observe(() => event(taskId, { credits: 1 })),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "answers a charge on a Network the request may not use as on origin/main",
      async () => {
        const payer = await person("refused person");
        const taskId = await task(payer, "refused person's Task");

        expectAsOnBase(
          "a refused Network",
          await observe(() =>
            event(taskId, { credits: 1 }, { "X-Sokosumi-Network": "preprod" }),
          ),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "rolls the debit back with the event when the request fails after the charge",
      async () => {
        stopsOnTheSplitLayout(1);
        const payer = await person("rolled back person");
        const taskId = await task(payer, "rolled back person's Task");

        const failed = await observe(() => {
          fixture.failAfterCharge = true;
          return event(taskId, { status: "COMPLETED", credits: 1 });
        });
        const again = await observe(() =>
          event(taskId, { status: "COMPLETED", credits: 1 }),
        );

        expectAsOnBase("rolled back, then charged", { failed, again });
      },
      CASE_TIMEOUT,
    );

    it(
      "charges a Masumi payment and writes its claim",
      async () => {
        stopsOnTheSplitLayout(2);
        const payer = await person("paying person", 10n * CREDIT);
        const taskId = await task(payer, "paying person's Task");
        const payment = await masumiPayment("payment");

        const first = await observe(() =>
          event(taskId, { masumiPayment: payment }),
        );
        const replay = await observe(() =>
          event(taskId, { masumiPayment: payment }),
        );

        expectAsOnBase("a Masumi payment and its claim", { first, replay });
      },
      CASE_TIMEOUT,
    );

    it.each(["first", "second"] as const)(
      "lets one of two requests spend the same credits when the %s commits first",
      async (winner) => {
        stopsOnTheSplitLayout(2);
        // One and a half credits: one charge of one credit fits, two do not.
        const payer = await person(`racing person, ${winner} first`);
        const tasks = {
          first: await task(payer, `first racing Task, ${winner} first`),
          second: await task(payer, `second racing Task, ${winner} first`),
        };
        const loser = winner === "first" ? "second" : "first";
        const gates = Object.fromEntries(
          (["first", "second"] as const).map((name) => {
            let reached = () => {};
            let release = () => {};
            const atGate = new Promise<void>((resolve) => {
              reached = resolve;
            });
            const released = new Promise<void>((resolve) => {
              release = resolve;
            });
            fixture.held.set(tasks[name], { reached, release: released });
            return [name, { atGate, release }];
          }),
        ) as Record<
          "first" | "second",
          { atGate: Promise<void>; release: () => void }
        >;

        expectAsOnBase(
          `two requests, the ${winner} commits first`,
          await observe(
            async () => {
              const answers = {
                first: event(tasks.first, { status: "COMPLETED", credits: 1 }),
                second: event(tasks.second, {
                  status: "COMPLETED",
                  credits: 1,
                }),
              };
              // Both have chosen the same buckets and written their debit.
              await Promise.all([gates.first.atGate, gates.second.atGate]);
              gates[winner].release();
              const won = await answers[winner];
              gates[loser].release();
              return { [winner]: won, [loser]: await answers[loser] };
            },
            { interleaved: true },
          ),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "charges Find people per person found (contacts)",
      async () => {
        const payer = await organization("contacts Organization");
        // A search of ten asks for five credits before it searches.
        await grant(
          "pool latest of contacts Organization",
          { organizationId: payer.organizationId ?? "" },
          { cents: 5n * CREDIT, expiresInDays: 60 },
        );
        const actor = {
          workspaceId: payer.workspaceId,
          userId: payer.memberId,
          sokoBotId: null,
        };
        const list = await inContactTransaction((tx) =>
          createContactList(tx, actor, { name: "Investors", color: "blue" }),
        );
        labels.set(list.id, "<contact list>");
        const people: PeopleSearchDeps = {
          async search() {
            return {
              costUsd: 0.012,
              hits: [
                {
                  title: "Mara Lind - Partner | LinkedIn",
                  url: "https://www.linkedin.com/in/maralind/",
                  passages: ["Partner."],
                },
                {
                  title: "Jonas Berg - Angel | LinkedIn",
                  url: "https://linkedin.com/in/jonasberg",
                  passages: ["Angel."],
                },
              ],
            };
          },
          async match({ hits }) {
            return {
              costUsd: 0.001,
              matches: hits.map((hit, index) => ({
                index,
                name: hit.title.split(" - ")[0] ?? hit.title,
                role: "Partner",
                organization: "Northwind",
                location: null,
                reason: "Fits.",
              })),
            };
          },
          async identify() {
            return { costUsd: 0, identity: null };
          },
        };

        expectAsOnBase(
          "Find people",
          await observe(async () => {
            const found = await findPeopleForList(
              actor,
              list.id,
              { brief: "Pre-seed investors", size: 10 },
              people,
            );
            return { credits: found.credits, found: found.suggestions.length };
          }),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "charges a Studio image its quote when fal delivers it",
      async () => {
        const payer = await person("Studio person", 10n * CREDIT);
        const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
        resetJwksCacheForTests();
        const realFetch = globalThis.fetch;
        const fetchSpy = vi
          .spyOn(globalThis, "fetch")
          .mockImplementation(async (input, init) => {
            if (String(input) !== "https://rest.fal.ai/.well-known/jwks.json")
              return realFetch(input, init);
            const { x } = publicKey.export({ format: "jwk" });
            return Response.json({ keys: [{ kty: "OKP", crv: "Ed25519", x }] });
          });
        fixture.downloadMedia.mockResolvedValue({
          bytes: pngBytes(1024, 1024),
          contentType: "image/png",
        });
        fixture.put.mockResolvedValue({
          pathname: `projects/${payer.projectId}/x`,
        });
        const falRequestId = `fal-${randomUUID()}`;
        await prisma.projectImageJob.create({
          data: {
            projectId: payer.projectId,
            workspaceId: payer.workspaceId,
            requestedByUserId: payer.ownerId ?? "",
            kind: "GENERATE",
            model: "fal-ai/gemini-3.1-flash-image-preview",
            prompt: "a cup",
            settings: {},
            referenceAssetIds: [],
            idempotencyKey: randomUUID(),
            status: "QUEUED",
            falRequestId,
            submitAttempts: 1,
            submittedAt: new Date(),
            chargedCents: convertCreditsToCents(8),
          },
        });
        const raw = JSON.stringify({
          request_id: falRequestId,
          status: "OK",
          payload: {
            images: [
              {
                url: "https://v3b.fal.media/files/a.png",
                width: 1024,
                height: 1024,
              },
            ],
          },
        });
        const timestamp = String(Math.floor(Date.now() / 1000));
        const hash = crypto.createHash("sha256").update(raw).digest("hex");
        const message = [falRequestId, "fal-user", timestamp, hash].join("\n");

        try {
          expectAsOnBase(
            "a Studio image delivered",
            await observe(async () => {
              const response = await falImageJobs.request("/fal/image-jobs", {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  "x-fal-webhook-request-id": falRequestId,
                  "x-fal-webhook-user-id": "fal-user",
                  "x-fal-webhook-timestamp": timestamp,
                  "x-fal-webhook-signature": crypto
                    .sign(null, Buffer.from(message), privateKey)
                    .toString("hex"),
                },
                body: raw,
              });
              return { status: response.status, body: await response.json() };
            }),
          );
        } finally {
          fetchSpy.mockRestore();
        }
      },
      CASE_TIMEOUT,
    );
  },
);
