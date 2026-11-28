/**
 * The Polar grants and the write-off on a real PostgreSQL, each at its own
 * entry point: Polar's webhook (a plan's month, a plan change's one-time
 * payment, a Project top-up and a refund), the yearly grant cron
 * (`/sync/polar-yearly-grants`) and a Project's close
 * (`requestProjectClose`), which writes off its Cuso's credits. What each
 * answers, every credit row of the fixture's Organization and Projects with
 * their consumptions, the Polar orders and subscriptions, the Cuso, the
 * waiting Task, and the statements PostgreSQL received, with each
 * transaction's boundaries and isolation level. The closed-Project write-off
 * of a credit refund (a failed hire's) is `refund.postgres.test.ts`'s.
 *
 * All of it is compared with `grant-polar.base.json`, which this file wrote
 * while it ran on `origin/main`'s code (`7c3310913`), before these grants
 * and the write-off moved into the credits module, once per layout:
 * RECORD_GRANT_POLAR_BASE=true RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter core test src/lib/credits/grant-polar.postgres.test.ts
 * and the same with the split layout's three `DATABASE_SCHEMA_*` names.
 * Without `RECORD_GRANT_POLAR_BASE` the same command compares.
 *
 * The cron reads every yearly subscription of the database, so the file runs
 * in a private copy of the migrated template, with no Polar subscription or
 * lock in it: only the rows a case makes are due.
 */
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { CMO_SOKO_BOT_VERSION_IDS } from "@sokosumi/soko-bot";
import { Hono } from "hono";
import { ok } from "neverthrow";
import { Client, type Pool } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";

import { coreLogEntries, expectCoreLog } from "@/test/core-log";
import { copyPostgresTestDatabase } from "@/test/postgres-database-copy";
import {
  baseFile,
  holdCommit,
  inFlow,
  nextMillisecond,
  observing,
  plain,
  sendOrder,
  sentBeforeAnswered,
  statements,
} from "@/test/spend-comparison";
import { onSplitLayout, testSchemaNames } from "@/test/split-layout";

const state = vi.hoisted(() => ({
  pools: [] as Pool[],
  /** Work handed to `waitUntil`, awaited as part of the call observed. */
  background: [] as Promise<unknown>[],
  /** What Sentry was handed: a fail-soft path's only trace. */
  captured: [] as unknown[],
  /** Polar: the event the next delivery verifies, and the revokes asked. */
  event: null as unknown,
  revoked: [] as string[],
  /** The next Task wake throws after it ran, inside the grant's transaction. */
  wakeFailsAfter: false,
}));
vi.mock("@vercel/functions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vercel/functions")>();
  const { observePool } = await import("@/test/spend-comparison");
  return {
    ...actual,
    waitUntil: (work: Promise<unknown>) => {
      state.background.push(work);
    },
    attachDatabasePool: (pool: Pool) => {
      state.pools.push(pool);
      observePool(pool);
      actual.attachDatabasePool(pool);
    },
  };
});
// As `src/test/setup.ts` stubs it, with what Sentry was handed.
vi.mock("@sentry/node", () => {
  const scope: Record<string, unknown> = new Proxy(
    {},
    {
      get: (target: Record<string, unknown>, key: string) =>
        key === "then" ? undefined : (target[key] ??= vi.fn()),
    },
  );
  return {
    init: vi.fn(),
    captureException: (error: unknown) => {
      state.captured.push(error);
      return "captured";
    },
    captureMessage: (message: unknown) => {
      state.captured.push(String(message));
      return "captured";
    },
    captureCheckIn: vi.fn(() => "check-in-id"),
    flush: vi.fn(async () => true),
    addBreadcrumb: vi.fn(),
    getCurrentScope: () => scope,
    getActiveSpan: () => undefined,
    withScope: (callback: (s: typeof scope) => unknown) => callback(scope),
    withIsolationScope: (callback: (s: typeof scope) => unknown) =>
      callback(scope),
    startSpan: (_options: unknown, callback: (span: undefined) => unknown) =>
      callback(undefined),
    httpIntegration: () => ({}),
    requestDataIntegration: () => ({}),
  };
});
/** Polar itself: the webhook's verification, the catalog and the revokes. */
const PRODUCTS = [
  {
    id: "prod_growth_month",
    name: "Growth",
    is_recurring: true,
    recurring_interval: "month",
    recurring_interval_count: 1,
    metadata: { kind: "plan", tier: "growth", credits: "25000" },
    prices: [
      {
        amount_type: "fixed",
        is_archived: false,
        price_amount: 100,
        price_currency: "usd",
      },
    ],
  },
  {
    id: "prod_growth_year",
    name: "Growth yearly",
    is_recurring: true,
    recurring_interval: "year",
    recurring_interval_count: 1,
    metadata: { kind: "plan", tier: "growth", credits: "25000" },
    prices: [
      {
        amount_type: "fixed",
        is_archived: false,
        price_amount: 1000,
        price_currency: "usd",
      },
    ],
  },
];
vi.mock("@/clients/polar.client", () => ({
  verifyPolarWebhook: async () => ok(state.event),
  listPolarProducts: async () => PRODUCTS,
  revokePolarSubscription: async (id: string) => {
    state.revoked.push(id);
  },
}));
vi.mock("@/services/ga4-measurement.service", () => ({
  reportPolarEventToGa4: async () => undefined,
}));
vi.mock("@/services/task-topup.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/task-topup.service")>();
  return {
    ...actual,
    markOutOfCreditsTasksAsToppedUp: async (
      params: Parameters<typeof actual.markOutOfCreditsTasksAsToppedUp>[0],
    ) => {
      await actual.markOutOfCreditsTasksAsToppedUp(params);
      if (state.wakeFailsAfter) {
        state.wakeFailsAfter = false;
        throw new Error("Failed after the Task wake");
      }
    },
  };
});
vi.unmock("@/lib/db/prisma");

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

/** Copying the database and loading Core: seconds here, more on CI's runner. */
const SETUP_TIMEOUT = 120_000;
/** A case runs whole flows, sometimes two at once, and reads every row back. */
const CASE_TIMEOUT = 90_000;
const DAY = 86_400_000;
const CRON_SECRET = "grant-polar-cron-secret";
/** 10^10 ledger units are one credit. */
const CREDIT = 10_000_000_000n;

const BASE_FILE = fileURLToPath(
  new URL("./grant-polar.base.json", import.meta.url),
);
const { expectAsOnBase } = baseFile(
  BASE_FILE,
  process.env.RECORD_GRANT_POLAR_BASE === "true",
  // No debit is written by `recordSpend`: every statement as recorded.
  { debitMoved: false },
);
/** The layout is part of the key: `origin/main` answers differently on each. */
const layout = onSplitLayout ? "split layout" : "today's layout";
const expectAsOnBaseHere = (key: string, observed: unknown) =>
  expectAsOnBase(`${key} (${layout})`, observed);

/** A response's status and body: JSON, or its text. */
async function answered(response: Response) {
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) as unknown };
  } catch {
    return { status: response.status, body: text };
  }
}

/** Core, imported once `DATABASE_URL` names the private copy. */
async function loadCore() {
  const [
    scope,
    prisma,
    errors,
    webhooks,
    sync,
    projectClose,
    polarGrant,
    cusoCredits,
  ] = await Promise.all([
    import("@/lib/db/network-scope"),
    import("@/lib/db/prisma"),
    import("@/helpers/error-handler"),
    import("@/routes/v1/webhooks/index"),
    import("@/routes/sync/polar-yearly-grants/get"),
    import("@/services/project-close-lifecycle.service"),
    import("@/services/polar-credit-grant.service"),
    import("@/helpers/cuso-project-credits"),
  ]);
  const app = new Hono();
  app.onError(errors.errorHandler);
  app.route("/v1/webhooks", webhooks.default);
  const crons = new Hono();
  crons.onError(errors.errorHandler);
  sync.default(crons);
  return {
    prisma: prisma.default,
    mainnet: () => scope.createNetworkScope("mainnet").networkDb,
    scope: () => scope.createNetworkScope("mainnet"),
    /** One Polar delivery, as its route answers it. */
    deliver: async (event: unknown) => {
      state.event = event;
      return answered(
        await app.request("/v1/webhooks/polar", { method: "POST", body: "{}" }),
      );
    },
    /** A cron tick, with the work it hands to `waitUntil` done. */
    cron: async () => {
      const response = await crons.request("/polar-yearly-grants", {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      });
      const answer = await answered(response);
      while (state.background.length > 0)
        await Promise.all(state.background.splice(0));
      return answer;
    },
    requestProjectClose: projectClose.requestProjectClose,
    grantPolarCredits: polarGrant.grantPolarCredits,
    writeOffUnlessLiveCuso: cusoCredits.writeOffUnlessLiveCuso,
  };
}
let core: Awaited<ReturnType<typeof loadCore>>;

if (enabled) {
  const given = process.env.DATABASE_URL;
  if (!given) throw new Error("The Polar grant recording needs PostgreSQL");
  const copy = await copyPostgresTestDatabase(
    process.env.POSTGRES_TEST_TEMPLATE_URL ?? given,
    "credit_grant_test",
  );
  afterAll(async () => {
    try {
      await Promise.all(state.pools.map((pool) => pool.end()));
    } finally {
      vi.unstubAllEnvs();
      await copy.drop();
    }
  }, SETUP_TIMEOUT);
  vi.stubEnv("DATABASE_URL", copy.url);
  vi.stubEnv("DATABASE_URL_UNPOOLED", copy.url);
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  const shared = testSchemaNames().DATABASE_SCHEMA_SHARED;
  const client = new Client({ connectionString: copy.url });
  await client.connect();
  try {
    // The names come from the layout's own settings, quoted: no input.
    await client.query(`TRUNCATE "${shared}"."polar_subscription",
      "${shared}"."polar_order", "${shared}"."Lock" CASCADE`);
  } finally {
    await client.end();
  }
  core = await loadCore();
}

/** Random values in a statement or a row, each under a name. */
const labels = new Map<string, string>();
const made = {
  userIds: [] as string[],
  organizationIds: [] as string[],
  projectIds: [] as string[],
  orderIds: [] as string[],
};

function label(value: string, name: string): string {
  if (value !== "") labels.set(value, `<${name}>`);
  return value;
}

/**
 * An Organization with its owner, its Workspace, a Project with a live Cuso,
 * a second Project without one, and a Task of the Cuso's Project that waits
 * for credits, with the unread notice that says so.
 */
async function createFixture(name: string, organizationId?: string) {
  const ownerId = label(randomUUID(), `${name}'s owner`);
  await core.prisma.user.create({
    data: {
      id: ownerId,
      name: "Polar grant fixture",
      email: `${ownerId}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  made.userIds.push(ownerId);
  const id = organizationId ?? label(`grant-polar-${randomUUID()}`, name);
  await core.prisma.organization.create({
    data: {
      id,
      name: "Polar grant fixture",
      slug: label(`grant-polar-slug-${randomUUID()}`, `${name}'s slug`),
      members: { create: { userId: ownerId, role: "owner" } },
    },
  });
  made.organizationIds.push(id);
  const workspace = await core.prisma.workspace.create({
    data: { organizationId: id },
    select: { id: true },
  });
  label(workspace.id, `${name}'s Workspace`);
  const projectIds: string[] = [];
  for (const which of ["Cuso's Project", "other Project"]) {
    const project = await core.prisma.project.create({
      data: { workspaceId: workspace.id, name: "Polar grant fixture" },
      select: { id: true },
    });
    made.projectIds.push(project.id);
    projectIds.push(label(project.id, `${name}'s ${which}`));
  }
  const [projectId, otherProjectId] = projectIds as [string, string];
  const cuso = await core.prisma.sokoBot.create({
    data: {
      workspaceId: workspace.id,
      projectId,
      userId: null,
      versionId: CMO_SOKO_BOT_VERSION_IDS[0],
      name: "Cuso",
    },
    select: { id: true },
  });
  label(cuso.id, `${name}'s Cuso`);
  const task = await core.prisma.task.create({
    data: {
      name: "Polar grant fixture",
      status: "OUT_OF_CREDITS",
      ownerId: null,
      creatorUserId: ownerId,
      organizationId: id,
      projectId,
      workspaceId: workspace.id,
    },
    select: { id: true },
  });
  label(task.id, `${name}'s waiting Task`);
  await core.prisma.notification.create({
    data: {
      userId: ownerId,
      kind: "TASK",
      referenceId: task.id,
      eventId: `grant-polar-fixture-${task.id}`,
      messageKey: "Notifications.Task.outOfCredits",
      messageParams: "{}",
    },
  });
  return {
    organizationId: id,
    ownerId,
    workspaceId: workspace.id,
    projectId,
    otherProjectId,
    cusoId: cuso.id,
    taskId: task.id,
  };
}
type Fixture = Awaited<ReturnType<typeof createFixture>>;

function orderId(name: string): string {
  const id = label(`order-${randomUUID()}`, name);
  made.orderIds.push(id);
  return id;
}

/** A subscription row of the Cuso's Project, as the webhook writes it. */
async function subscriptionRow(
  fixture: Fixture,
  row: {
    interval: "month" | "year";
    periodStart: Date;
    periodEnd: Date;
    lastPaidOrderId: string | null;
  },
) {
  const polarSubscriptionId = label(`sub-${randomUUID()}`, "the subscription");
  const created = await core.prisma.polarSubscription.create({
    data: {
      kind: "CMO",
      projectId: fixture.projectId,
      organizationId: fixture.organizationId,
      polarSubscriptionId,
      polarProductId:
        row.interval === "month" ? "prod_growth_month" : "prod_growth_year",
      tier: "growth",
      interval: row.interval,
      status: "active",
      currentPeriodStart: row.periodStart,
      currentPeriodEnd: row.periodEnd,
      lastPaidOrderId: row.lastPaidOrderId,
      lastPaidAt: row.lastPaidOrderId ? row.periodStart : null,
      polarEventAt: row.periodStart,
    },
    select: { id: true },
  });
  label(created.id, "the subscription's row");
  return { id: created.id, polarSubscriptionId };
}

/**
 * A grant's rows as the fixture's own, written outside the code compared,
 * with `spent` of it consumed.
 */
async function fixtureBucket(
  fixture: Fixture,
  bucket: {
    referenceId: string;
    referenceType:
      | "POLAR_SUBSCRIPTION_MONTH"
      | "PROJECT_TOP_UP"
      | "CMO_TESTER_CREDITS";
    projectId: string | null;
    credits: bigint;
    expiresAt: Date | null;
    spent?: bigint;
  },
): Promise<string> {
  const db = core.mainnet();
  const granted = await db.transaction.create({
    data: {
      amount: bucket.credits * CREDIT,
      organizationId: fixture.organizationId,
      userId: null,
      sourceCreditBucket: {
        create: {
          amount: bucket.credits * CREDIT,
          expiresAt: bucket.expiresAt,
          organizationId: fixture.organizationId,
          projectId: bucket.projectId,
          referenceId: bucket.referenceId,
          referenceNote: "Growth",
          referenceType: bucket.referenceType,
          userId: null,
        },
      },
    },
    select: { sourceCreditBucket: { select: { id: true } } },
  });
  const bucketId = granted.sourceCreditBucket?.id;
  if (!bucketId) throw new Error("The fixture's grant has no bucket");
  if (bucket.spent) {
    await db.transaction.create({
      data: {
        amount: -bucket.spent * CREDIT,
        organizationId: fixture.organizationId,
        creditConsumptions: {
          create: { amount: bucket.spent * CREDIT, bucketId },
        },
      },
    });
  }
  return bucketId;
}

/** A value with each random id in it written as its name. */
function named(value: string): string {
  let text = value;
  for (const [random, name] of labels) text = text.replaceAll(random, name);
  return text;
}

/**
 * Every credit row of the fixture's Organization and Projects, its Polar
 * orders and subscriptions, its Cuso and its waiting Task, in an order the
 * product defines: a bucket's reference, then the order its id was first
 * sent in (`sentAt`, from the observed statements; a row that was there
 * before comes first), then its time.
 */
async function rows(
  fixture: Fixture,
  sentAt: (id: string) => number = () => -1,
) {
  const db = core.mainnet();
  const owner = {
    OR: [
      { organizationId: fixture.organizationId },
      { projectId: { in: [fixture.projectId, fixture.otherProjectId] } },
    ],
  };
  const buckets = await db.creditBucket.findMany({
    where: owner,
    include: { consumptions: true },
  });
  const byTime = <T extends { id: string; createdAt: Date }>(a: T, b: T) =>
    sentAt(a.id) - sentAt(b.id) ||
    a.createdAt.getTime() - b.createdAt.getTime();
  buckets.sort(
    (a, b) =>
      `${a.referenceType}:${named(a.referenceId ?? "")}`.localeCompare(
        `${b.referenceType}:${named(b.referenceId ?? "")}`,
      ) || byTime(a, b),
  );
  for (const bucket of buckets) {
    bucket.consumptions.sort(
      (a, b) => byTime(a, b) || Number(a.amount - b.amount),
    );
  }
  // Each bucket's grant, then the spends of it, in the buckets' order; any
  // other transaction of the Organization after them, by time.
  const linked = buckets.flatMap((bucket) => [
    bucket.sourceTransactionId,
    ...bucket.consumptions.map((each) => each.transactionId),
  ]);
  const position = (id: string) =>
    linked.includes(id) ? linked.indexOf(id) : linked.length;
  const transactions = await db.transaction.findMany({
    where: { organizationId: fixture.organizationId },
  });
  transactions.sort((a, b) => position(a.id) - position(b.id) || byTime(a, b));
  const orders = await core.prisma.polarOrder.findMany({
    where: { polarOrderId: { in: made.orderIds } },
  });
  orders.sort((a, b) =>
    named(a.polarOrderId).localeCompare(named(b.polarOrderId)),
  );
  const subscriptions = await core.prisma.polarSubscription.findMany({
    where: { projectId: fixture.projectId },
    orderBy: { polarSubscriptionId: "asc" },
  });
  const cuso = await core.prisma.sokoBot.findUnique({
    where: { id: fixture.cusoId },
    select: { archivedAt: true, status: true, updatedAt: true },
  });
  const task = await core.prisma.task.findUnique({
    where: { id: fixture.taskId },
    select: {
      status: true,
      events: { select: { status: true, userId: true, coworkerId: true } },
    },
  });
  const notices = await core.prisma.notification.findMany({
    where: { referenceId: fixture.taskId },
    select: { isRead: true, readAt: true },
  });
  const project = await core.prisma.project.findUnique({
    where: { id: fixture.projectId },
    select: { closingAt: true, projectRevision: true },
  });
  return {
    buckets,
    transactions,
    orders,
    subscriptions,
    cuso,
    task,
    notices,
    project,
  };
}
type Rows = Awaited<ReturnType<typeof rows>>;

/**
 * What `plain` hides of the rows, taken from the raw values first: the kind
 * of each new id, that ids sort as their rows' times do, which times fall in
 * the call, and each new bucket's expiry and each write-off's time named by
 * what they equal.
 */
function rawRelations(
  left: Rows,
  before: Rows,
  started: number,
  ended: number,
  times: Record<string, Date>,
) {
  const knownBuckets = new Set(before.buckets.map((bucket) => bucket.id));
  const knownTransactions = new Set(before.transactions.map((each) => each.id));
  const knownConsumptions = new Set(
    before.buckets.flatMap((bucket) => bucket.consumptions.map((c) => c.id)),
  );
  const consumptions = left.buckets.flatMap((bucket) => bucket.consumptions);
  const fresh = {
    buckets: left.buckets.filter((bucket) => !knownBuckets.has(bucket.id)),
    transactions: left.transactions.filter(
      (each) => !knownTransactions.has(each.id),
    ),
    consumptions: consumptions.filter(
      (each) => !knownConsumptions.has(each.id),
    ),
  };
  const within = (time: Date | null) =>
    time !== null && time.getTime() >= started && time.getTime() <= ended;
  const inTimeOrder = <T extends { id: string; createdAt: Date }>(
    list: readonly T[],
  ) =>
    list.every((a) =>
      list.every(
        (b) =>
          a.createdAt.getTime() >= b.createdAt.getTime() ||
          a.id.localeCompare(b.id) < 0,
      ),
    );
  const namedTime = (time: Date | null) => {
    if (time === null) return null;
    const match = Object.entries(times).find(
      ([, other]) => other.getTime() === time.getTime(),
    );
    if (match) return match[0];
    return within(time) ? "within the call" : "other";
  };
  return {
    uuidVersions: [
      ...fresh.transactions,
      ...fresh.buckets,
      ...fresh.consumptions,
    ].map((row) => row.id.charAt(14)),
    idsSortLikeTimes: {
      transactions: inTimeOrder(left.transactions),
      buckets: inTimeOrder(left.buckets),
      consumptions: inTimeOrder(consumptions),
    },
    freshTimesWithinTheCall: [
      ...fresh.transactions.flatMap((row) => [
        within(row.createdAt),
        within(row.updatedAt),
      ]),
      ...fresh.buckets.flatMap((row) => [
        within(row.createdAt),
        within(row.updatedAt),
      ]),
      ...fresh.consumptions.map((row) => within(row.createdAt)),
    ],
    buckets: left.buckets.map((bucket) => ({
      fresh: !knownBuckets.has(bucket.id),
      expiresAt: namedTime(bucket.expiresAt),
      activatesAt: namedTime(bucket.activatesAt),
      // Each write-off's consumption shares its transaction's time.
      consumptions: bucket.consumptions.map((consumption) => {
        const transaction = left.transactions.find(
          (each) => each.id === consumption.transactionId,
        );
        return {
          fresh: !knownConsumptions.has(consumption.id),
          sameTimeAsItsTransaction:
            transaction?.createdAt.getTime() ===
            consumption.createdAt.getTime(),
        };
      }),
    })),
    orders: left.orders.map((order) => ({
      refundedAt: namedTime(order.refundedAt),
    })),
    subscriptions: left.subscriptions.map((row) => ({
      lastPaidAt: namedTime(row.lastPaidAt),
      lastPaidOrderRefundedAt: namedTime(row.lastPaidOrderRefundedAt),
      endedAt: namedTime(row.endedAt),
      updatedWithinTheCall: within(row.updatedAt),
    })),
    cuso: {
      archivedAt: namedTime(left.cuso?.archivedAt ?? null),
      updatedWithinTheCall: within(left.cuso?.updatedAt ?? null),
    },
    notices: left.notices.map((notice) => namedTime(notice.readAt)),
    projectClosingAt: namedTime(left.project?.closingAt ?? null),
  };
}

/** A failure's message without where it was thrown: its last line. */
function cause(message: string): string {
  return message.trim().split("\n").at(-1)?.trim() ?? "";
}

/** A call's answer, any failure in it as its name and its cause. */
function asAnswered(outcome: unknown): unknown {
  if (typeof outcome !== "object" || outcome === null) return outcome;
  if ("threw" in outcome) {
    const { threw } = outcome as { threw: unknown };
    if (typeof threw === "string") return { threw: cause(threw) };
    const { name, message } = threw as { name: unknown; message: unknown };
    return { threw: { name, message: cause(String(message)) } };
  }
  if (Array.isArray(outcome)) return outcome.map(asAnswered);
  return Object.fromEntries(
    Object.entries(outcome).map(([key, value]) => [key, asAnswered(value)]),
  );
}

/** What Sentry was handed during the call, as name and cause. */
function capturedErrors(): unknown[] {
  return state.captured
    .splice(0)
    .map((error) =>
      error instanceof Error
        ? { name: error.name, message: cause(error.message) }
        : String(error),
    );
}

type Log = Awaited<ReturnType<typeof observing>>["log"];

/** The statements, their order and their awaits, of one flow or of all. */
function sent(log: Log) {
  return {
    statements: statements(log, { asSent: true }),
    sendOrder: sendOrder(log),
    sentBeforeAnswered: sentBeforeAnswered(log),
  };
}

/**
 * Two flows' statements, flow by flow in the order of their names: each
 * flow's transactions, its statements outside them, its send order and its
 * awaits.
 */
function byFlow(log: Log) {
  const flows = [...new Set(log.map((entry) => entry.flow))].sort();
  const each = flows.map((flow) => ({
    flow,
    ...sent(log.filter((entry) => entry.flow === flow)),
  }));
  return {
    statements: {
      transactions: each.flatMap((one) => one.statements.transactions),
      outsideTransactions: Object.fromEntries(
        each.map((one) => [one.flow, one.statements.outsideTransactions]),
      ),
    },
    flows: Object.fromEntries(
      each.map((one) => [
        one.flow,
        {
          transactions: one.statements.transactions.length,
          sendOrder: one.sendOrder,
          sentBeforeAnswered: one.sentBeforeAnswered,
        },
      ]),
    ),
  };
}

/**
 * One call: its answer, what Sentry was handed, what Core logged, the Polar
 * revokes it asked, the statements it sent and in which order, which
 * statement was sent before the one before it was answered, and the rows it
 * left. Two flows at once (`perFlow`) are compared flow by flow: the product
 * defines each flow's order, not how two interleave once both run. `sql`
 * says whether the call reaches the database: an observation that must hold
 * SQL and holds none fails here, and one that must hold none and holds some
 * fails too. `times` names the times a new row's may equal.
 */
async function observe(
  fixture: Fixture,
  call: () => Promise<unknown>,
  {
    perFlow = false,
    sql = true,
    times = {},
  }: { perFlow?: boolean; sql?: boolean; times?: Record<string, Date> } = {},
) {
  const before = await rows(fixture);
  state.captured.splice(0);
  state.revoked.splice(0);
  const loggedBefore = coreLogEntries().length;
  const started = await nextMillisecond();
  const { outcome, log } = await observing(async () => {
    const result = await call();
    while (state.background.length > 0)
      await Promise.all(state.background.splice(0));
    return result;
  });
  const ended = Date.now();
  if (sql) expect(log.length).toBeGreaterThan(0);
  else expect(log).toEqual([]);
  const firstSent = new Map<string, number>();
  log.forEach(({ values }, at) => {
    for (const value of values) {
      if (typeof value === "string" && !firstSent.has(value))
        firstSent.set(value, at);
    }
  });
  const left = await rows(fixture, (id) => firstSent.get(id) ?? -1);
  return plain(
    {
      outcome: asAnswered(outcome),
      captured: capturedErrors(),
      revoked: state.revoked.splice(0),
      logged: coreLogEntries()
        .slice(loggedBefore)
        .map(({ level, message }) => ({ level, message })),
      ...(perFlow ? byFlow(log) : sent(log)),
      rows: left,
      raw: rawRelations(left, before, started, ended, times),
    },
    labels,
  ) as Record<string, unknown>;
}

/**
 * Waits until PostgreSQL shows a statement of this database waiting for a
 * lock, or until `stop` says to: the second of two flows, behind the first.
 * On a separate connection, outside the pool Core's statements are recorded
 * from.
 */
async function untilOneWaitsForALock(
  stop: () => boolean,
): Promise<"waits" | "stopped"> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    for (let tries = 0; tries < 600; tries += 1) {
      if (stop()) return "stopped";
      const { rows: found } = await client.query<{ waiting: number }>(
        `SELECT count(*)::int AS waiting FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock'`,
      );
      if ((found[0]?.waiting ?? 0) > 0) return "waits";
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("No flow waited for a lock");
  } finally {
    await client.end();
  }
}

/**
 * Two calls at once, in the one order this allows: the first runs until
 * its `commit`th COMMIT and holds there, with everything of that
 * transaction written and locked; then the second starts and runs until
 * PostgreSQL shows it waiting for a lock, or to its end. Then the first
 * commits and both go on. A first that ends before that COMMIT holds
 * nothing: the second starts after it ended. Which of these happened is part
 * of the answer.
 */
async function twoAtOnce<First, Second>(
  first: () => Promise<First>,
  second: () => Promise<Second>,
  commit = 1,
) {
  const gate = holdCommit("first", commit);
  const settled = <R>(promise: Promise<R>) =>
    promise.then(
      (value) => value,
      (error: unknown) => ({
        threw: error instanceof Error ? cause(error.message) : String(error),
      }),
    );
  const firstDone = settled(inFlow("first", first));
  const held = await Promise.race([
    gate.reached.then(() => "held" as const),
    firstDone.then(() => "ended" as const),
  ]);
  gate.cancel();
  let secondEnded = false;
  const secondDone = settled(inFlow("second", second)).then((answer) => {
    secondEnded = true;
    return answer;
  });
  let whileHeld = "after the first ended";
  if (held === "held") {
    const waited = await untilOneWaitsForALock(() => secondEnded);
    whileHeld = waited === "waits" ? "waits" : "ended";
    gate.release();
  }
  return {
    first: { held, answer: await firstDone },
    second: { whileHeld, answer: await secondDone },
  };
}

/** Removes every row a case made, by the ids it made, outside Core's pool. */
async function removeMade(): Promise<void> {
  const db = core.mainnet();
  const organizations = { organizationId: { in: made.organizationIds } };
  // Consumptions go with their bucket or their transaction.
  await db.creditBucket.deleteMany({
    where: {
      OR: [organizations, { projectId: { in: made.projectIds } }],
    },
  });
  await db.transaction.deleteMany({ where: organizations });
  await core.prisma.polarOrder.deleteMany({
    where: { polarOrderId: { in: made.orderIds } },
  });
  await core.prisma.polarSubscription.deleteMany({
    where: { projectId: { in: made.projectIds } },
  });
  await core.prisma.notification.deleteMany({
    where: { userId: { in: made.userIds } },
  });
  await core.prisma.task.deleteMany({ where: organizations });
  await core.prisma.projectCloseOperation.deleteMany({
    where: { projectId: { in: made.projectIds } },
  });
  await core.prisma.projectEvent.deleteMany({
    where: { projectId: { in: made.projectIds } },
  });
  await core.prisma.sokoBot.deleteMany({
    where: { projectId: { in: made.projectIds } },
  });
  await core.prisma.project.deleteMany({
    where: { id: { in: made.projectIds } },
  });
  await core.prisma.workspace.deleteMany({ where: organizations });
  await core.prisma.organization.deleteMany({
    where: { id: { in: made.organizationIds } },
  });
  await core.prisma.user.deleteMany({ where: { id: { in: made.userIds } } });
  made.userIds = [];
  made.organizationIds = [];
  made.projectIds = [];
  made.orderIds = [];
}

/** Declares each Core log entry of the test as many times as it came. */
function declareEverythingLogged(): void {
  const counts = new Map<string, number>();
  for (const { level, message } of coreLogEntries()) {
    const key = JSON.stringify([level, message]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [key, times] of counts) {
    const [level, message] = JSON.parse(key) as ["warn" | "error", string];
    expectCoreLog(level, message, times);
  }
}

/** Runs a case on rows only it owns, removed after it. */
function inCase(name: string, run: () => Promise<void>) {
  it(
    name,
    async () => {
      try {
        await run();
      } finally {
        state.wakeFailsAfter = false;
        await removeMade();
        // What the observed call logged is compared with the base (`logged`);
        // a setup step that fails on the split layout logs too.
        declareEverythingLogged();
      }
    },
    CASE_TIMEOUT,
  );
}

/**
 * A plan's first order, of a month that started a minute ago, paid `ago`
 * milliseconds ago.
 */
function monthPaid(
  fixture: Fixture,
  order: string,
  subscriptionId: string,
  ago = 30_000,
) {
  const now = Date.now();
  const periodStart = new Date(now - 60_000);
  const periodEnd = new Date(now + 30 * DAY);
  return {
    periodStart,
    periodEnd,
    paidAt: new Date(now - ago),
    event: {
      type: "order.paid",
      timestamp: new Date(now - ago).toISOString(),
      data: {
        id: order,
        billing_reason: "subscription_create",
        metadata: {
          kind: "plan",
          projectId: fixture.projectId,
          organizationId: fixture.organizationId,
          userId: fixture.ownerId,
        },
        items: [
          {
            proration: false,
            start_timestamp: periodStart.toISOString(),
            end_timestamp: periodEnd.toISOString(),
          },
        ],
        customer: { id: "cus_1", external_id: fixture.organizationId },
        product: PRODUCTS[0],
        subscription: {
          id: subscriptionId,
          status: "active",
          product_id: "prod_growth_month",
          recurring_interval: "month",
          current_period_start: periodStart.toISOString(),
          current_period_end: periodEnd.toISOString(),
          cancel_at_period_end: false,
          ended_at: null,
          metadata: {},
        },
      },
    },
  };
}

/** A one-time purchase of a Project top-up pack. */
function topUpPaid(
  fixture: Pick<Fixture, "projectId" | "organizationId" | "ownerId">,
  order: string,
  externalId: string | null = fixture.organizationId,
) {
  const paidAt = new Date(Date.now() - 30_000);
  const expiresAt = new Date(paidAt);
  expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1);
  return {
    paidAt,
    expiresAt,
    event: {
      type: "order.paid",
      timestamp: paidAt.toISOString(),
      data: {
        id: order,
        billing_reason: "purchase",
        metadata: {
          projectId: fixture.projectId,
          organizationId: fixture.organizationId,
          userId: fixture.ownerId,
        },
        customer: { id: "cus_1", external_id: externalId },
        product: {
          id: "prod_top_up_5000",
          name: "5,000 credits",
          metadata: { kind: "top-up", credits: "5000" },
        },
        subscription: null,
      },
    },
  };
}

function refunded(order: string) {
  const refundedAt = new Date(Date.now() - 10_000);
  return {
    refundedAt,
    event: {
      type: "order.refunded",
      timestamp: refundedAt.toISOString(),
      data: { id: order, metadata: {} },
    },
  };
}

/** Each layout runs its own: the base keys carry the layout. */
describe.skipIf(!enabled)(
  "the Polar grants and the write-off, as on origin/main (PostgreSQL)",
  () => {
    describe("a plan's month (order.paid)", () => {
      inCase(
        "grants the month to the Cuso's Project and wakes its Task",
        async () => {
          const fixture = await createFixture("subscriber");
          const order = orderId("the order");
          const paid = monthPaid(fixture, order, `sub-${randomUUID()}`);
          label(paid.event.data.subscription.id, "the subscription");

          expectAsOnBaseHere(
            "a plan's month, first",
            await observe(fixture, () => core.deliver(paid.event), {
              times: {
                "the billed period's end": paid.periodEnd,
                "the payment": paid.paidAt,
              },
            }),
          );
        },
      );

      inCase("grants nothing when the delivery comes again", async () => {
        const fixture = await createFixture("again subscriber");
        const order = orderId("the order");
        const paid = monthPaid(fixture, order, `sub-${randomUUID()}`);
        label(paid.event.data.subscription.id, "the subscription");
        await core.deliver(paid.event);

        expectAsOnBaseHere(
          "a plan's month, again",
          await observe(fixture, () => core.deliver(paid.event), {
            times: {
              "the billed period's end": paid.periodEnd,
              "the payment": paid.paidAt,
            },
          }),
        );
      });

      inCase("grants once for two deliveries at once", async () => {
        const fixture = await createFixture("doubled subscriber");
        const order = orderId("the order");
        const paid = monthPaid(fixture, order, `sub-${randomUUID()}`);
        label(paid.event.data.subscription.id, "the subscription");

        expectAsOnBaseHere(
          "a plan's month, two at once",
          await observe(
            fixture,
            () =>
              twoAtOnce(
                () => core.deliver(paid.event),
                () => core.deliver(paid.event),
              ),
            {
              perFlow: true,
              times: {
                "the billed period's end": paid.periodEnd,
                "the payment": paid.paidAt,
              },
            },
          ),
        );
      });

      inCase("rolls the grant and the Task wake back together", async () => {
        const fixture = await createFixture("rolled back subscriber");
        const order = orderId("the order");
        const paid = monthPaid(fixture, order, `sub-${randomUUID()}`);
        label(paid.event.data.subscription.id, "the subscription");
        state.wakeFailsAfter = true;

        expectAsOnBaseHere(
          "a plan's month, the wake fails",
          await observe(fixture, () => core.deliver(paid.event), {
            times: {
              "the billed period's end": paid.periodEnd,
              "the payment": paid.paidAt,
            },
          }),
        );
      });

      inCase(
        "answers a customer without an id as origin/main does",
        async () => {
          const fixture = await createFixture("subscriber without an id");
          const order = orderId("the order");
          const paid = monthPaid(fixture, order, `sub-${randomUUID()}`);
          label(paid.event.data.subscription.id, "the subscription");
          const event = {
            ...paid.event,
            data: {
              ...paid.event.data,
              customer: { id: "cus_1", external_id: null },
            },
          };

          expectAsOnBaseHere(
            "a plan's month, a null customer id",
            await observe(fixture, () => core.deliver(event)),
          );
        },
      );
    });

    describe("a plan change's one-time payment (order.paid, subscription_update)", () => {
      inCase("grants the prorated rest of the month", async () => {
        const fixture = await createFixture("upgrading subscriber");
        const now = Date.now();
        const periodStart = new Date(now - 10 * DAY);
        const periodEnd = new Date(now + 20 * DAY);
        const row = await subscriptionRow(fixture, {
          interval: "month",
          periodStart,
          periodEnd,
          lastPaidOrderId: null,
        });
        const order = orderId("the upgrade's order");
        const event = {
          type: "order.paid",
          timestamp: new Date(now - 30_000).toISOString(),
          data: {
            id: order,
            billing_reason: "subscription_update",
            created_at: new Date(now - 60_000).toISOString(),
            metadata: {},
            items: [],
            customer: { id: "cus_1", external_id: fixture.organizationId },
            product: PRODUCTS[0],
            subscription: {
              id: row.polarSubscriptionId,
              status: "active",
              product_id: "prod_growth_month",
              recurring_interval: "month",
              current_period_start: periodStart.toISOString(),
              current_period_end: periodEnd.toISOString(),
              cancel_at_period_end: false,
              ended_at: null,
              metadata: { upgradeFromCredits: "10000" },
            },
          },
        };

        expectAsOnBaseHere(
          "a plan change's payment",
          await observe(fixture, () => core.deliver(event), {
            times: { "the period's end": periodEnd },
          }),
        );
      });
    });

    describe("a Project top-up (order.paid, purchase)", () => {
      inCase("grants the pack to the Project for a year", async () => {
        const fixture = await createFixture("topping up subscriber");
        await subscriptionRow(fixture, {
          interval: "month",
          periodStart: new Date(Date.now() - DAY),
          periodEnd: new Date(Date.now() + 29 * DAY),
          lastPaidOrderId: null,
        });
        const paid = topUpPaid(fixture, orderId("the top-up's order"));

        expectAsOnBaseHere(
          "a top-up, first",
          await observe(fixture, () => core.deliver(paid.event), {
            times: { "a year after the payment": paid.expiresAt },
          }),
        );
      });

      inCase("grants once for two deliveries at once", async () => {
        const fixture = await createFixture("doubly topping up subscriber");
        await subscriptionRow(fixture, {
          interval: "month",
          periodStart: new Date(Date.now() - DAY),
          periodEnd: new Date(Date.now() + 29 * DAY),
          lastPaidOrderId: null,
        });
        const paid = topUpPaid(fixture, orderId("the top-up's order"));

        expectAsOnBaseHere(
          "a top-up, two at once",
          await observe(
            fixture,
            () =>
              twoAtOnce(
                () => core.deliver(paid.event),
                () => core.deliver(paid.event),
              ),
            {
              perFlow: true,
              times: { "a year after the payment": paid.expiresAt },
            },
          ),
        );
      });

      inCase("grants nothing without a live subscription", async () => {
        const fixture = await createFixture("unsubscribed topper");
        const paid = topUpPaid(fixture, orderId("the top-up's order"));

        expectAsOnBaseHere(
          "a top-up, no subscription",
          await observe(fixture, () => core.deliver(paid.event)),
        );
      });

      inCase(
        "answers an empty Organization id as origin/main does",
        async () => {
          const fixture = await createFixture("topper with an empty id", "");
          await subscriptionRow(fixture, {
            interval: "month",
            periodStart: new Date(Date.now() - DAY),
            periodEnd: new Date(Date.now() + 29 * DAY),
            lastPaidOrderId: null,
          });
          const paid = topUpPaid(fixture, orderId("the top-up's order"));

          expectAsOnBaseHere(
            "a top-up, an empty Organization id",
            // The checkout's metadata refuses it before any statement.
            await observe(fixture, () => core.deliver(paid.event), {
              sql: false,
            }),
          );
        },
      );
    });

    describe("the yearly grant cron", () => {
      /** A yearly plan paid 40 days ago, its month 0 granted: month 1 is due. */
      async function yearlySubscriber(name: string, organizationId?: string) {
        const fixture = await createFixture(name, organizationId);
        const order = orderId("the year's order");
        const periodStart = new Date(Date.now() - 40 * DAY);
        const row = await subscriptionRow(fixture, {
          interval: "year",
          periodStart,
          periodEnd: new Date(periodStart.getTime() + 365 * DAY),
          lastPaidOrderId: order,
        });
        await fixtureBucket(fixture, {
          referenceId: `${order}:0`,
          referenceType: "POLAR_SUBSCRIPTION_MONTH",
          projectId: fixture.projectId,
          credits: 25_000n,
          expiresAt: new Date(periodStart.getTime() + 31 * DAY),
          spent: 25_000n,
        });
        return { fixture, order, row, periodStart };
      }

      inCase("grants the started month the year lacks", async () => {
        const { fixture } = await yearlySubscriber("yearly subscriber");

        expectAsOnBaseHere(
          "the yearly cron, first",
          await observe(fixture, core.cron),
        );
      });

      inCase("grants nothing when it runs again", async () => {
        const { fixture } = await yearlySubscriber("renewed yearly subscriber");
        await core.cron();

        expectAsOnBaseHere(
          "the yearly cron, again",
          await observe(fixture, core.cron),
        );
      });

      inCase("grants a month once for two ticks at once", async () => {
        const { fixture } = await yearlySubscriber("doubly renewed subscriber");

        expectAsOnBaseHere(
          "the yearly cron, two at once",
          await observe(fixture, () => twoAtOnce(core.cron, core.cron), {
            perFlow: true,
          }),
        );
      });

      inCase("grants nothing for a refunded order", async () => {
        const { fixture, order } = await yearlySubscriber(
          "refunded yearly subscriber",
        );
        await core.deliver(refunded(order).event);

        expectAsOnBaseHere(
          "the yearly cron, a refunded order",
          await observe(fixture, core.cron),
        );
      });
    });

    describe("a Polar refund's write-off (order.refunded)", () => {
      /**
       * An order's grants: a month partly spent, one expired, one untouched;
       * an order whose id starts with this one's, another Project's bucket,
       * and a pool bucket.
       */
      async function refundable(name: string) {
        const fixture = await createFixture(name);
        const order = orderId("the order");
        // Its id starts with this order's: not one of its grants.
        const lookalike = `${order}0`;
        made.orderIds.push(lookalike);
        const later = new Date(Date.now() + 300 * DAY);
        const yesterday = new Date(Date.now() - DAY);
        await fixtureBucket(fixture, {
          referenceId: `${order}:0`,
          referenceType: "POLAR_SUBSCRIPTION_MONTH",
          projectId: fixture.projectId,
          credits: 25_000n,
          expiresAt: later,
          spent: 7_000n,
        });
        await fixtureBucket(fixture, {
          referenceId: `${order}:1`,
          referenceType: "POLAR_SUBSCRIPTION_MONTH",
          projectId: fixture.projectId,
          credits: 25_000n,
          expiresAt: yesterday,
        });
        await fixtureBucket(fixture, {
          referenceId: `${order}:2`,
          referenceType: "POLAR_SUBSCRIPTION_MONTH",
          projectId: fixture.projectId,
          credits: 25_000n,
          expiresAt: new Date(later.getTime() + DAY),
        });
        await fixtureBucket(fixture, {
          referenceId: `${lookalike}:0`,
          referenceType: "PROJECT_TOP_UP",
          projectId: fixture.projectId,
          credits: 5_000n,
          expiresAt: later,
        });
        await fixtureBucket(fixture, {
          referenceId: `${orderId("another Project's order")}:0`,
          referenceType: "POLAR_SUBSCRIPTION_MONTH",
          projectId: fixture.otherProjectId,
          credits: 25_000n,
          expiresAt: later,
        });
        await fixtureBucket(fixture, {
          referenceId: label(randomUUID(), "the pool's grant"),
          referenceType: "CMO_TESTER_CREDITS",
          projectId: null,
          credits: 1_000n,
          expiresAt: null,
        });
        return {
          fixture,
          order,
          times: { "a later expiry": later, yesterday },
        };
      }

      inCase(
        "writes off what is left of each of the order's live buckets",
        async () => {
          const { fixture, order, times } = await refundable(
            "refunded subscriber",
          );
          const refund = refunded(order);

          expectAsOnBaseHere(
            "a refund, first",
            await observe(fixture, () => core.deliver(refund.event), {
              times: { ...times, "the refund": refund.refundedAt },
            }),
          );
        },
      );

      inCase("writes off nothing more when it comes again", async () => {
        const { fixture, order, times } = await refundable(
          "again refunded subscriber",
        );
        const refund = refunded(order);
        await core.deliver(refund.event);

        expectAsOnBaseHere(
          "a refund, again",
          await observe(fixture, () => core.deliver(refund.event), {
            times: { ...times, "the refund": refund.refundedAt },
          }),
        );
      });

      inCase("answers an empty order id as origin/main does", async () => {
        const fixture = await createFixture("refund with an empty order id");
        made.orderIds.push("");
        const refund = refunded("");

        expectAsOnBaseHere(
          "a refund, an empty order id",
          await observe(fixture, () => core.deliver(refund.event), {
            times: { "the refund": refund.refundedAt },
          }),
        );
      });

      inCase(
        "a refund racing the payment it refunds, the payment first",
        async () => {
          const fixture = await createFixture("racing refund");
          const order = orderId("the order");
          const paid = monthPaid(fixture, order, `sub-${randomUUID()}`);
          label(paid.event.data.subscription.id, "the subscription");
          const refund = refunded(order);
          // The subscription's row is there, from an older payment: the
          // grant's is the first COMMIT.
          await core.deliver(
            monthPaid(
              fixture,
              orderId("an earlier order"),
              paid.event.data.subscription.id,
              50_000,
            ).event,
          );

          expectAsOnBaseHere(
            "a refund racing its payment",
            await observe(
              fixture,
              () =>
                twoAtOnce(
                  () => core.deliver(paid.event),
                  () => core.deliver(refund.event),
                ),
              {
                perFlow: true,
                times: {
                  "the billed period's end": paid.periodEnd,
                  "the payment": paid.paidAt,
                  "the refund": refund.refundedAt,
                },
              },
            ),
          );
        },
      );
    });

    describe("a Project's close", () => {
      const close = (fixture: Fixture) =>
        core.requestProjectClose(
          {
            projectId: fixture.projectId,
            workspaceId: fixture.workspaceId,
            actorUserId: fixture.ownerId,
          },
          {
            operationId: label(randomUUID(), "the close"),
            expectedProjectRevision: 0,
          },
        );

      /** A Cuso's Project with a plan, a used month, an expired one, a top-up. */
      async function closable(name: string) {
        const fixture = await createFixture(name);
        const order = orderId("the order");
        const later = new Date(Date.now() + 20 * DAY);
        await subscriptionRow(fixture, {
          interval: "month",
          periodStart: new Date(Date.now() - 10 * DAY),
          periodEnd: later,
          lastPaidOrderId: order,
        });
        await fixtureBucket(fixture, {
          referenceId: `${order}:0`,
          referenceType: "POLAR_SUBSCRIPTION_MONTH",
          projectId: fixture.projectId,
          credits: 25_000n,
          expiresAt: later,
          spent: 7_000n,
        });
        await fixtureBucket(fixture, {
          referenceId: `${orderId("an earlier order")}:0`,
          referenceType: "POLAR_SUBSCRIPTION_MONTH",
          projectId: fixture.projectId,
          credits: 25_000n,
          expiresAt: new Date(Date.now() - 10 * DAY),
        });
        await fixtureBucket(fixture, {
          referenceId: `${orderId("the top-up's order")}:0`,
          referenceType: "PROJECT_TOP_UP",
          projectId: fixture.projectId,
          credits: 5_000n,
          expiresAt: new Date(Date.now() + 300 * DAY),
        });
        await fixtureBucket(fixture, {
          referenceId: `${orderId("another Project's order")}:0`,
          referenceType: "POLAR_SUBSCRIPTION_MONTH",
          projectId: fixture.otherProjectId,
          credits: 25_000n,
          expiresAt: later,
        });
        return { fixture, order, times: { "the plan's end": later } };
      }

      inCase("writes off what is left of the Cuso's Project", async () => {
        const { fixture, times } = await closable("closing subscriber");

        expectAsOnBaseHere(
          "a Project's close",
          await observe(fixture, () => close(fixture), { times }),
        );
      });

      inCase("a refund racing the close, the refund first", async () => {
        const { fixture, order, times } = await closable("racing close");
        const refund = refunded(order);

        expectAsOnBaseHere(
          "a refund racing a Project's close",
          await observe(
            fixture,
            () =>
              twoAtOnce(
                () => core.deliver(refund.event),
                () => close(fixture),
              ),
            {
              perFlow: true,
              times: { ...times, "the refund": refund.refundedAt },
            },
          ),
        );
      });

      inCase(
        "a payment racing the close, the close first, grants nothing",
        async () => {
          const { fixture } = await closable("paying while closing");
          const paid = topUpPaid(fixture, orderId("a late top-up's order"));

          expectAsOnBaseHere(
            "a payment racing a Project's close",
            await observe(
              fixture,
              () =>
                twoAtOnce(
                  () => close(fixture),
                  () => core.deliver(paid.event),
                ),
              {
                perFlow: true,
                times: { "a year after the payment": paid.expiresAt },
              },
            ),
          );
        },
      );
    });

    describe("the shared Polar grant, with ids no entry point sends", () => {
      inCase("an empty Project id", async () => {
        const fixture = await createFixture("grant with an empty Project id");

        expectAsOnBaseHere(
          "the Polar grant, an empty Project id",
          await observe(fixture, () =>
            core.grantPolarCredits({
              scope: core.scope(),
              amount: 5_000n * CREDIT,
              expiresAt: new Date(Date.now() + 300 * DAY),
              organizationId: fixture.organizationId,
              projectId: "",
              referenceId: `${orderId("the order")}:0`,
              referenceNote: "5,000 credits",
              referenceType: "PROJECT_TOP_UP",
              subscription: { projectId: "" },
            }),
          ),
        );
      });

      inCase("an empty Project id written off", async () => {
        const fixture = await createFixture("write-off of an empty Project id");

        expectAsOnBaseHere(
          "the write-off, an empty Project id",
          await observe(fixture, () =>
            core.prisma.$transaction((tx) =>
              core.writeOffUnlessLiveCuso("", tx),
            ),
          ),
        );
      });
    });
  },
);
