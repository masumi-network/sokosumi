/**
 * The local free plan's and the enterprise contracts' grants on a real
 * PostgreSQL, each at its own entry point: an Organization's creation (its
 * Better Auth hook), Stripe's customer created and subscription deleted
 * (paid to free) webhooks, the free plan's renewal cron, an enterprise
 * contract's activation and cancellation (their routes) and the enterprise
 * renewal cron. What each answers, every credit row of the owner, its
 * Subscriptions and contract rows, and the statements PostgreSQL received,
 * with each transaction's boundaries and isolation level. The personal
 * Workspace's free plan, with its Task wake, is `grant.postgres.test.ts`'s.
 *
 * All of it is compared with `grant-plans.base.json`, which this file wrote
 * while it ran on `origin/main`'s code (`cb8a430ea`), before these grants
 * moved into the credits module, once per layout:
 * RECORD_GRANT_PLANS_BASE=true RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter core test src/lib/credits/grant-plans.postgres.test.ts
 * and the same with the split layout's three `DATABASE_SCHEMA_*` names.
 * Without `RECORD_GRANT_PLANS_BASE` the same command compares.
 *
 * The crons read every due row of the database, so the file runs in a
 * private copy of the migrated template, with no Subscription, contract or
 * lock in it: only the rows a case makes are due.
 */
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { convertCreditsToCents } from "@sokosumi/utils";
import { Hono } from "hono";
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
// As `src/test/setup.ts` stubs it, with what `captureException` was handed.
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
    captureMessage: vi.fn(),
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
// The Organization hook creates its Stripe customer after its grant.
vi.mock("@/clients/stripe.client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/clients/stripe.client")>();
  return {
    ...actual,
    stripeClient: {
      ...actual.stripeClient,
      createOrganizationCustomer: async () => undefined,
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
const MINUTE = 60_000;
const CRON_SECRET = "grant-plans-cron-secret";

const BASE_FILE = fileURLToPath(
  new URL("./grant-plans.base.json", import.meta.url),
);
const { expectAsOnBase } = baseFile(
  BASE_FILE,
  process.env.RECORD_GRANT_PLANS_BASE === "true",
  // No debit is written: every statement is compared as recorded.
  { debitMoved: false },
);
/** The layout is part of the key: `origin/main` answers differently on each. */
const layout = onSplitLayout ? "split layout" : "today's layout";
const expectAsOnBaseHere = (key: string, observed: unknown) =>
  expectAsOnBase(`${key} (${layout})`, observed);

/** A response's status and body: JSON, or the text of an `HTTPException`. */
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
    hono,
    errors,
    authOrganization,
    customerCreated,
    paidSubscription,
    personalWorkspace,
    freeRenewal,
    enterpriseRenewal,
    activate,
    cancel,
  ] = await Promise.all([
    import("@/lib/db/network-scope"),
    import("@/lib/db/prisma"),
    import("@/lib/hono"),
    import("@/helpers/error-handler"),
    import("@/lib/auth-organization"),
    import("@/services/stripe-customer-created.service"),
    import("@/services/stripe-backed-subscription.service"),
    import("@/helpers/personal-workspace"),
    import("@/routes/sync/free-subscriptions-renewal/get"),
    import("@/routes/sync/enterprise-contracts-renewal/get"),
    import("@/routes/v1/enterprise/contracts/[id]/activate/post"),
    import("@/routes/v1/enterprise/contracts/[id]/cancel/post"),
  ]);
  // Core's own error handler, as its app has it.
  const crons = new Hono();
  crons.onError(errors.errorHandler);
  freeRenewal.default(crons);
  enterpriseRenewal.default(crons);
  // The routes alone, without the auth middleware: the admin check is the
  // enterprise router's, before them.
  const contracts = hono.createNestedOpenAPIHono();
  contracts.onError(errors.errorHandler);
  activate.default(contracts);
  cancel.default(contracts);
  const hooks =
    authOrganization.createAuthOrganizationPlugin().options.organizationHooks;
  return {
    prisma: prisma.default,
    mainnet: () => scope.createNetworkScope("mainnet").networkDb,
    afterCreateOrganization: hooks.afterCreateOrganization,
    handleCustomerCreatedEvent: customerCreated.handleCustomerCreatedEvent,
    handleSubscriptionDeletedEvent:
      paidSubscription.handleSubscriptionDeletedEvent,
    createPersonalWorkspace: personalWorkspace.createPersonalWorkspace,
    /** A cron tick, with the work it hands to `waitUntil` done. */
    cron: async (path: string) => {
      const response = await crons.request(path, {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      });
      const answer = await answered(response);
      while (state.background.length > 0)
        await Promise.all(state.background.splice(0));
      return answer;
    },
    contract: async (path: string, body?: unknown) =>
      answered(
        await contracts.request(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body ?? {}),
        }),
      ),
  };
}
let core: Awaited<ReturnType<typeof loadCore>>;

if (enabled) {
  const given = process.env.DATABASE_URL;
  if (!given) throw new Error("The plan grant recording needs PostgreSQL");
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
    await client.query(`TRUNCATE "${shared}"."subscription",
      "${shared}"."enterprise_contract", "${shared}"."Lock" CASCADE`);
  } finally {
    await client.end();
  }
  core = await loadCore();
}

/** Random values in a statement or a row, each under a name. */
const labels = new Map<string, string>();
/**
 * The Core log entries a case expects: those of its observed calls, which
 * are compared with the base, and those its setup steps declare. Any other
 * entry fails the case (`src/test/core-log.ts`).
 */
const expectedLogs: { level: "warn" | "error"; message: string }[] = [];
const made = {
  userIds: [] as string[],
  organizationIds: [] as string[],
  subscriptionReferences: [] as string[],
};

/** A person; `id` names one the product would not make ("" for an empty id). */
async function createUser(
  name: string,
  id: string = randomUUID(),
): Promise<string> {
  await core.prisma.user.create({
    data: {
      id,
      name,
      email: `${id}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  made.userIds.push(id);
  made.subscriptionReferences.push(id);
  if (id !== "") labels.set(id, `<${name}>`);
  return id;
}

/** An Organization with one owner, created as Better Auth creates it. */
async function createOrganization(name: string, id?: string) {
  const ownerId = await createUser(`${name}'s owner`);
  const organizationId = id ?? `grant-plans-${randomUUID()}`;
  const organization = await core.prisma.organization.create({
    data: {
      id: organizationId,
      name: "Grant plans fixture",
      slug: `grant-plans-slug-${randomUUID()}`,
      members: { create: { userId: ownerId, role: "owner" } },
    },
    select: { id: true, name: true, slug: true, createdAt: true },
  });
  made.organizationIds.push(organizationId);
  made.subscriptionReferences.push(organizationId);
  if (organizationId !== "") labels.set(organizationId, `<${name}>`);
  labels.set(organization.slug, `<${name}'s slug>`);
  return { ...organization, ownerId };
}

type Owner = { userId: string } | { organizationId: string };
const ownerId = (owner: Owner) =>
  "userId" in owner ? owner.userId : owner.organizationId;

/**
 * Every credit row of the owner, its Subscriptions and its contracts with
 * their periods, in an order the product defines: a row's kind, then the
 * order its id was first sent in (`sentAt`, from the observed statements; a
 * row that was there before comes first), then its time.
 */
async function rows(owner: Owner, sentAt: (id: string) => number = () => -1) {
  const db = core.mainnet();
  const buckets = await db.creditBucket.findMany({ where: owner });
  buckets.sort(
    (a, b) =>
      `${a.referenceType}`.localeCompare(`${b.referenceType}`) ||
      sentAt(a.id) - sentAt(b.id) ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const transactions = await db.transaction.findMany({
    where: { id: { in: buckets.map((bucket) => bucket.sourceTransactionId) } },
  });
  transactions.sort(
    (a, b) =>
      buckets.findIndex((bucket) => bucket.sourceTransactionId === a.id) -
      buckets.findIndex((bucket) => bucket.sourceTransactionId === b.id),
  );
  const subscriptions = await core.prisma.subscription.findMany({
    where: { referenceId: ownerId(owner) },
  });
  subscriptions.sort(
    (a, b) =>
      (a.periodStart?.getTime() ?? 0) - (b.periodStart?.getTime() ?? 0) ||
      sentAt(a.id) - sentAt(b.id),
  );
  const contracts =
    "organizationId" in owner
      ? await core.prisma.enterpriseContract.findMany({
          where: { organizationId: owner.organizationId },
          include: { periods: true },
        })
      : [];
  contracts.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const contract of contracts) {
    contract.periods.sort(
      (a, b) =>
        a.periodStart.getTime() - b.periodStart.getTime() ||
        sentAt(a.id) - sentAt(b.id),
    );
  }
  return {
    transactions,
    // Every transaction of the owner: a grant written without its bucket
    // shows here.
    transactionCount: await db.transaction.count({ where: owner }),
    buckets,
    subscriptions,
    contracts,
  };
}

type Rows = Awaited<ReturnType<typeof rows>>;

/**
 * What `plain` hides of the rows, taken from the raw values first: the kind
 * of each new id, that ids sort as their rows' times do, which times fall in
 * the call, and how each new bucket's reference, activation and expiry
 * relate to the period or contract it is for.
 */
function rawRelations(
  left: Rows,
  before: Rows,
  started: number,
  ended: number,
) {
  const known = new Set(before.buckets.map((bucket) => bucket.id));
  const fresh = left.buckets.filter((bucket) => !known.has(bucket.id));
  const freshTransactions = left.transactions.filter((transaction) =>
    fresh.some((bucket) => bucket.sourceTransactionId === transaction.id),
  );
  const freshSubscriptions = left.subscriptions.filter(
    (subscription) =>
      !before.subscriptions.some((was) => was.id === subscription.id),
  );
  const periods = left.contracts.flatMap((contract) => contract.periods);
  const freshPeriods = periods.filter(
    (period) =>
      !before.contracts.some((contract) =>
        contract.periods.some((was) => was.id === period.id),
      ),
  );
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
  /** A time named by what it equals, or by the call it falls in. */
  const named = (time: Date | null, names: Record<string, Date | null>) => {
    if (time === null) return null;
    const match = Object.entries(names).find(
      ([, other]) => other?.getTime() === time.getTime(),
    );
    if (match) return match[0];
    return within(time) ? "within the call" : "other";
  };
  return {
    uuidVersions: [
      ...freshTransactions,
      ...fresh,
      ...freshSubscriptions,
      ...freshPeriods,
    ].map((row) => row.id.charAt(14)),
    idsSortLikeTimes: {
      transactions: inTimeOrder(left.transactions),
      buckets: inTimeOrder(left.buckets),
    },
    grantTimesWithinTheCall: [...freshTransactions, ...fresh].flatMap((row) => [
      within(row.createdAt),
      within(row.updatedAt),
    ]),
    // Each bucket's reference, activation and expiry against the row it is
    // for, on the raw values: `plain` hides the times in them.
    buckets: left.buckets.map((bucket) => {
      // An empty user id is a person's: only null is no person.
      const prefix = bucket.userId !== null ? "user:" : "org:";
      const owner = bucket.userId ?? bucket.organizationId;
      const fields = {
        fresh: !known.has(bucket.id),
        updatedWithinTheCall: within(bucket.updatedAt),
      };
      if (bucket.referenceType === "STRIPE_SUBSCRIPTION_PERIOD") {
        const subscription = left.subscriptions.find(
          (candidate) =>
            bucket.referenceId ===
            `${prefix}${owner}:local-free:${candidate.periodEnd?.toISOString()}:subscription`,
        );
        return {
          ...fields,
          forSubscription: subscription
            ? left.subscriptions.indexOf(subscription)
            : null,
          activatesAt: named(bucket.activatesAt, {
            "its period's start": subscription?.periodStart ?? null,
          }),
          expiresAt: named(bucket.expiresAt, {
            "its period's end": subscription?.periodEnd ?? null,
          }),
        };
      }
      const contract = left.contracts.find(
        (candidate) =>
          candidate.id === bucket.referenceId ||
          candidate.periods.some((period) => period.id === bucket.referenceId),
      );
      const period = periods.find((each) => each.id === bucket.referenceId);
      return {
        ...fields,
        forContract: contract ? left.contracts.indexOf(contract) : null,
        forPeriod: period ? periods.indexOf(period) : null,
        activatesAt: named(bucket.activatesAt, {
          "its contract's activation": contract?.activatedAt ?? null,
          "its period's start": period?.periodStart ?? null,
        }),
        expiresAt: named(bucket.expiresAt, {
          "its period's end": period?.periodEnd ?? null,
          "its top-up's expiry":
            period === undefined ? (contract?.oneTimeExpiresAt ?? null) : null,
          "its contract's cancellation": contract?.canceledAt ?? null,
        }),
      };
    }),
    subscriptions: left.subscriptions.map((subscription) => ({
      fresh: freshSubscriptions.includes(subscription),
      updatedWithinTheCall: within(subscription.updatedAt),
      periodStart: named(
        subscription.periodStart,
        Object.fromEntries(
          left.subscriptions.map((other, at) => [
            `the end of subscription ${at}`,
            other.periodEnd,
          ]),
        ),
      ),
      endedAt: named(subscription.endedAt, {
        "its period's end": subscription.periodEnd,
      }),
      canceledAt: named(subscription.canceledAt, {}),
    })),
    contracts: left.contracts.map((contract) => ({
      activatedAt: named(contract.activatedAt, {}),
      canceledAt: named(contract.canceledAt, {}),
      periods: contract.periods.map((period, at) => ({
        fresh: freshPeriods.includes(period),
        startsAt: named(period.periodStart, {
          "the contract's activation": contract.activatedAt,
          ...(at > 0
            ? {
                "the end of the period before":
                  contract.periods[at - 1]?.periodEnd ?? null,
              }
            : {}),
        }),
      })),
    })),
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
 * One call: its answer, what Sentry was handed, the statements it sent and
 * in which order, which statement was sent before the one before it was
 * answered, and the rows it left. Two flows at once (`perFlow`) are compared
 * flow by flow: the product defines each flow's order, not how two
 * interleave once both run. `sql` says whether the call reaches the
 * database: an observation that must hold SQL and holds none fails here,
 * and one that must hold none and holds some fails too.
 */
async function observe(
  owner: Owner,
  call: () => Promise<unknown>,
  { perFlow = false, sql = true }: { perFlow?: boolean; sql?: boolean } = {},
) {
  const before = await rows(owner);
  state.captured.splice(0);
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
  const left = await rows(owner, (id) => firstSent.get(id) ?? -1);
  const logged = coreLogEntries()
    .slice(loggedBefore)
    .map(({ level, message }) => ({ level, message }));
  expectedLogs.push(...logged);
  return plain(
    {
      outcome: asAnswered(outcome),
      captured: capturedErrors(),
      logged,
      ...(perFlow ? byFlow(log) : sent(log)),
      rows: left,
      raw: rawRelations(left, before, started, ended),
    },
    labels,
  ) as Record<string, unknown>;
}

/**
 * Waits until PostgreSQL shows a statement of this database waiting for a
 * lock: the second of two flows, behind the first. On a separate
 * connection, outside the pool Core's statements are recorded from.
 */
async function untilOneWaitsForALock(): Promise<"waits"> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    for (let tries = 0; tries < 600; tries += 1) {
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
 * its `commit`th COMMIT (the one of its grant's transaction) and holds
 * there, with everything of that transaction written and locked; then the
 * second starts and runs until PostgreSQL shows it waiting for a lock, or to
 * its end. Then the first commits and both go on. A first that ends before
 * that COMMIT holds nothing: the second starts after it ended. Which of
 * these happened is part of the answer.
 */
async function twoAtOnce<T>(
  first: () => Promise<T>,
  second: () => Promise<T>,
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
  const secondDone = settled(inFlow("second", second));
  let whileHeld = "after the first ended";
  if (held === "held") {
    whileHeld = await Promise.race([
      untilOneWaitsForALock(),
      secondDone.then(() => "ended" as const),
    ]);
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
  const owners = {
    OR: [
      { userId: { in: made.userIds } },
      { organizationId: { in: made.organizationIds } },
    ],
  };
  await db.creditBucket.deleteMany({ where: owners });
  await db.transaction.deleteMany({ where: owners });
  await core.prisma.subscription.deleteMany({
    where: { referenceId: { in: made.subscriptionReferences } },
  });
  await core.prisma.enterpriseContract.deleteMany({
    where: { organizationId: { in: made.organizationIds } },
  });
  await core.prisma.workspace.deleteMany({
    where: {
      OR: [
        { userId: { in: made.userIds } },
        { organizationId: { in: made.organizationIds } },
      ],
    },
  });
  await core.prisma.organization.deleteMany({
    where: { id: { in: made.organizationIds } },
  });
  await core.prisma.user.deleteMany({ where: { id: { in: made.userIds } } });
  await core.prisma.lock.deleteMany({
    where: { key: { in: [...CRON_LOCK_KEYS] } },
  });
  made.userIds = [];
  made.organizationIds = [];
  made.subscriptionReferences = [];
}

/**
 * Runs a case on rows only it owns. The private copy holds no other
 * Subscription or contract, so a cron's scan sees the case's rows alone,
 * and nothing is left for the next case's scan.
 */
function inCase(name: string, run: () => Promise<void>) {
  it(
    name,
    async () => {
      try {
        await run();
      } finally {
        await removeMade();
        declareExpectedLogs();
      }
    },
    CASE_TIMEOUT,
  );
}

/** Declares each expected Core log entry of the case, as often as expected. */
function declareExpectedLogs(): void {
  const counts = new Map<string, number>();
  for (const { level, message } of expectedLogs.splice(0)) {
    const key = JSON.stringify([level, message]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [key, times] of counts) {
    const [level, message] = JSON.parse(key) as ["warn" | "error", string];
    expectCoreLog(level, message, times);
  }
}

/**
 * A setup step through the code compared. On the split layout `origin/main`
 * cannot write these grants, so a step that fails there leaves the rows it
 * leaves, and the case compares what follows from them. It logs exactly
 * `onSplit` there (error entries, by message) and nothing on today's layout.
 */
async function prepared(
  step: () => Promise<unknown>,
  _onSplit: readonly string[] = [],
): Promise<void> {
  const loggedBefore = coreLogEntries().length;
  await step();
  const logged = coreLogEntries()
    .slice(loggedBefore)
    .map(({ level, message }) => ({ level, message }));
  expect(logged).toEqual([]);
}

/** The two crons' lock rows. */
const CRON_LOCK_KEYS = [
  "free-subscriptions-renewal-sync",
  "enterprise-contracts-renewal-sync",
] as const;

/**
 * Puts a cron's lock where a deployed cron finds it after its first run:
 * there and free. Every cron case starts from it, so no case depends on
 * another having run first, and two ticks at once never race to create it.
 */
async function freeCronLock(key: (typeof CRON_LOCK_KEYS)[number]) {
  await core.prisma.lock.upsert({
    where: { key },
    create: { key, isLocked: false, lockedAt: null, lockedBy: null },
    update: { isLocked: false, lockedAt: null, lockedBy: null },
  });
}

/** A free plan's period as the local free helpers write it, ending `endsIn` from now. */
async function freePeriod(
  referenceId: string,
  endsIn: number,
  options: { seats?: number; status?: string } = {},
) {
  const periodEnd = new Date(Date.now() + endsIn);
  const subscription = await core.prisma.subscription.create({
    data: {
      billingInterval: "month",
      cancelAtPeriodEnd: false,
      createdAt: new Date(periodEnd.getTime() - 31 * DAY),
      periodStart: new Date(periodEnd.getTime() - 31 * DAY),
      periodEnd,
      plan: "free",
      referenceId,
      seats: options.seats ?? 1,
      status: options.status ?? "active",
      stripeSubscriptionId: null,
    },
    select: { id: true },
  });
  return subscription.id;
}

/** A paid Stripe plan of the owner, as its deletion webhook finds it. */
async function paidPlan(
  referenceId: string,
  period: { endsIn: number; endedAgo: number | null },
) {
  const stripeSubscriptionId = `sub_${randomUUID()}`;
  const periodEnd = new Date(Date.now() + period.endsIn);
  await core.prisma.subscription.create({
    data: {
      billingInterval: "month",
      cancelAtPeriodEnd: false,
      createdAt: new Date(periodEnd.getTime() - 40 * DAY),
      periodStart: new Date(periodEnd.getTime() - 30 * DAY),
      periodEnd,
      plan: "starter",
      referenceId,
      seats: 2,
      status: "canceled",
      stripeCustomerId: `cus_${randomUUID()}`,
      stripeSubscriptionId,
      endedAt:
        period.endedAgo === null
          ? null
          : new Date(Date.now() - period.endedAgo),
    },
  });
  return { stripeId: stripeSubscriptionId, periodEnd };
}

const CREDIT = convertCreditsToCents(1);

/**
 * A person's local free period given before, as its writer keys it:
 * `user:<id>:local-free:<periodEnd>:subscription`, 250 credits, ending with
 * the period. Written as the fixture's own, outside the code compared.
 */
async function givenFreePeriod(userId: string, periodEnd: Date) {
  const cents = 250n * CREDIT;
  await core.mainnet().transaction.create({
    data: {
      amount: cents,
      userId,
      organizationId: null,
      sourceCreditBucket: {
        create: {
          amount: cents,
          activatesAt: null,
          expiresAt: periodEnd,
          userId,
          organizationId: null,
          referenceId: `user:${userId}:local-free:${periodEnd.toISOString()}:subscription`,
          referenceType: "STRIPE_SUBSCRIPTION_PERIOD",
        },
      },
    },
  });
}

/** A draft enterprise contract of the Organization. */
async function draftContract(
  organizationId: string,
  { topUp }: { topUp: boolean },
) {
  const contract = await core.prisma.enterpriseContract.create({
    data: {
      organizationId,
      periodCount: 3,
      seats: 2,
      centsPerMonth: 60_000n * CREDIT,
      ...(topUp && {
        oneTimeCents: 25_000n * CREDIT,
        oneTimeExpiresAt: new Date(Date.now() + 90 * DAY),
      }),
    },
    select: { id: true },
  });
  return contract.id;
}

/** Writes an enterprise grant's rows as the fixture's own, outside the code compared. */
async function fixtureGrant(
  organizationId: string,
  grant: {
    referenceId: string;
    referenceType: "ENTERPRISE_PERIOD" | "ENTERPRISE_TOP_UP";
    cents: bigint;
    activatesAt: Date;
    expiresAt: Date | null;
  },
) {
  await core.mainnet().transaction.create({
    data: {
      amount: grant.cents,
      organizationId,
      userId: null,
      sourceCreditBucket: {
        create: {
          activatesAt: grant.activatesAt,
          amount: grant.cents,
          expiresAt: grant.expiresAt,
          organizationId,
          referenceId: grant.referenceId,
          referenceType: grant.referenceType,
          userId: null,
        },
      },
    },
  });
}

/**
 * An active contract 40 days in: its first period over (its bucket expired
 * at the period's end), the second due and not granted yet, the third
 * starting within the renewal cron's look-ahead, and a top-up.
 */
async function runningContract(organizationId: string) {
  const now = Date.now();
  const activatedAt = new Date(now - 40 * DAY);
  const bounds = [
    [activatedAt, new Date(now - 10 * DAY)],
    [new Date(now - 10 * DAY), new Date(now + 2 * 60 * MINUTE)],
    [new Date(now + 2 * 60 * MINUTE), new Date(now + 30 * DAY)],
  ] as const;
  const contract = await core.prisma.enterpriseContract.create({
    data: {
      organizationId,
      periodCount: 3,
      seats: 2,
      centsPerMonth: 60_000n * CREDIT,
      oneTimeCents: 25_000n * CREDIT,
      oneTimeExpiresAt: new Date(now + 90 * DAY),
      status: "active",
      activatedAt,
      periods: {
        create: bounds.map(([periodStart, periodEnd], at) => ({
          periodStart,
          periodEnd,
          centsToGrant: 60_000n * CREDIT,
          purchasedSeats: 2,
          status: at === 0 ? ("active" as const) : ("scheduled" as const),
        })),
      },
    },
    include: { periods: { orderBy: { periodStart: "asc" } } },
  });
  const [first] = contract.periods;
  if (!first) throw new Error("No first period");
  await fixtureGrant(organizationId, {
    referenceId: first.id,
    referenceType: "ENTERPRISE_PERIOD",
    cents: 60_000n * CREDIT,
    activatesAt: activatedAt,
    expiresAt: first.periodEnd,
  });
  await fixtureGrant(organizationId, {
    referenceId: contract.id,
    referenceType: "ENTERPRISE_TOP_UP",
    cents: 25_000n * CREDIT,
    activatesAt: activatedAt,
    expiresAt: contract.oneTimeExpiresAt,
  });
  return contract;
}

/**
 * An active contract 10 days in, its first period granted and live, its
 * second pre-granted to start later, and a top-up: what a cancellation
 * expires.
 */
async function liveContract(organizationId: string) {
  const now = Date.now();
  const activatedAt = new Date(now - 10 * DAY);
  const bounds = [
    [activatedAt, new Date(now + 20 * DAY)],
    [new Date(now + 20 * DAY), new Date(now + 50 * DAY)],
    [new Date(now + 50 * DAY), new Date(now + 80 * DAY)],
  ] as const;
  const contract = await core.prisma.enterpriseContract.create({
    data: {
      organizationId,
      periodCount: 3,
      seats: 2,
      centsPerMonth: 60_000n * CREDIT,
      oneTimeCents: 25_000n * CREDIT,
      oneTimeExpiresAt: null,
      status: "active",
      activatedAt,
      periods: {
        create: bounds.map(([periodStart, periodEnd], at) => ({
          periodStart,
          periodEnd,
          centsToGrant: 60_000n * CREDIT,
          purchasedSeats: 2,
          status: at < 2 ? ("active" as const) : ("scheduled" as const),
        })),
      },
    },
    include: { periods: { orderBy: { periodStart: "asc" } } },
  });
  for (const period of contract.periods.slice(0, 2)) {
    await fixtureGrant(organizationId, {
      referenceId: period.id,
      referenceType: "ENTERPRISE_PERIOD",
      cents: 60_000n * CREDIT,
      activatesAt: period.periodStart,
      expiresAt: period.periodEnd,
    });
  }
  await fixtureGrant(organizationId, {
    referenceId: contract.id,
    referenceType: "ENTERPRISE_TOP_UP",
    cents: 25_000n * CREDIT,
    activatesAt: activatedAt,
    expiresAt: null,
  });
  return contract;
}

/** Each layout runs its own: the base keys carry the layout. */
describe.skipIf(!enabled)(
  "the local free plan's and the enterprise grants, as on origin/main (PostgreSQL)",
  () => {
    describe("an Organization's creation (its Better Auth hook)", () => {
      const create = (organization: {
        id: string;
        name: string;
        slug: string;
        createdAt: Date;
      }) => {
        const hook = core.afterCreateOrganization;
        if (!hook) throw new Error("No hook");
        // The hook reads the Organization Better Auth just created.
        return hook({ organization } as Parameters<typeof hook>[0]);
      };

      // Better Auth types the id a string; a null reaches the hook only at run time.
      inCase("answers a null Organization id as origin/main does", async () => {
        const organization = await createOrganization(
          "Organization for a null id",
        );

        expectAsOnBaseHere(
          "Organization creation, a null id",
          await observe({ organizationId: organization.id }, () =>
            create({ ...organization, id: null as unknown as string }),
          ),
        );
      });

      inCase("grants the initial free period", async () => {
        const organization = await createOrganization("new Organization");

        expectAsOnBaseHere(
          "Organization creation, first",
          await observe({ organizationId: organization.id }, () =>
            create(organization),
          ),
        );
      });

      inCase("grants nothing when the hook runs again", async () => {
        const organization = await createOrganization("again Organization");
        await prepared(() => create(organization));

        expectAsOnBaseHere(
          "Organization creation, again",
          await observe({ organizationId: organization.id }, () =>
            create(organization),
          ),
        );
      });

      inCase("grants once when the hook runs twice at once", async () => {
        const organization = await createOrganization("doubled Organization");

        expectAsOnBaseHere(
          "Organization creation, two at once",
          await observe(
            { organizationId: organization.id },
            () =>
              // Its Workspace's transaction commits first, then its grant's.
              twoAtOnce(
                () => create(organization),
                () => create(organization),
                2,
              ),
            { perFlow: true },
          ),
        );
      });

      inCase(
        "answers an empty Organization id as origin/main does",
        async () => {
          const organization = await createOrganization(
            "Organization with an empty id",
            "",
          );

          expectAsOnBaseHere(
            "Organization creation, an empty id",
            await observe({ organizationId: "" }, () => create(organization)),
          );
        },
      );
    });

    describe("Stripe's customer created webhook", () => {
      const created = (organizationId: string) =>
        core.handleCustomerCreatedEvent({
          id: `cus_${organizationId}`,
          metadata: { customerType: "organization", organizationId },
        } as unknown as Parameters<typeof core.handleCustomerCreatedEvent>[0]);

      for (const [shown, metadata] of [
        [
          "a null Organization id",
          { customerType: "organization", organizationId: null },
        ],
        ["an empty user id", { customerType: "user", userId: "" }],
        ["a null user id", { customerType: "user", userId: null }],
      ] as const) {
        inCase(`writes nothing for ${shown}`, async () => {
          expectAsOnBaseHere(
            `customer created, ${shown}`,
            await observe(
              { userId: "" },
              () =>
                core.handleCustomerCreatedEvent({
                  id: "cus_fixture",
                  metadata,
                } as unknown as Parameters<
                  typeof core.handleCustomerCreatedEvent
                >[0]),
              { sql: false },
            ),
          );
        });
      }

      inCase("grants the initial free period it finds missing", async () => {
        const { id } = await createOrganization("customer Organization");

        expectAsOnBaseHere(
          "customer created, first",
          await observe({ organizationId: id }, () => created(id)),
        );
      });

      inCase("grants nothing again on a second delivery", async () => {
        const { id } = await createOrganization("again customer Organization");
        await prepared(() => created(id));

        expectAsOnBaseHere(
          "customer created, again",
          await observe({ organizationId: id }, () => created(id)),
        );
      });

      inCase("grants once for two deliveries at once", async () => {
        const { id } = await createOrganization(
          "doubled customer Organization",
        );

        expectAsOnBaseHere(
          "customer created, two at once",
          await observe(
            { organizationId: id },
            () =>
              twoAtOnce(
                () => created(id),
                () => created(id),
              ),
            { perFlow: true },
          ),
        );
      });

      inCase("writes nothing for an empty Organization id", async () => {
        expectAsOnBaseHere(
          "customer created, an empty id",
          await observe({ organizationId: "" }, () => created(""), {
            sql: false,
          }),
        );
      });
    });

    describe("the free plan's renewal cron", () => {
      const renew = () => core.cron("/free-subscriptions-renewal");
      const lock = () => freeCronLock("free-subscriptions-renewal-sync");

      inCase(
        "rolls over the period of a person whose id is empty",
        async () => {
          await lock();
          await createUser("person with an empty id", "");
          await freePeriod("", -5 * MINUTE);

          expectAsOnBaseHere(
            "free renewal, a person with an empty id",
            await observe({ userId: "" }, renew),
          );
        },
      );

      inCase(
        "rolls over the period of an Organization whose id is empty",
        async () => {
          await lock();
          await createOrganization("Organization with an empty id", "");
          await freePeriod("", -5 * MINUTE);

          expectAsOnBaseHere(
            "free renewal, an Organization with an empty id",
            await observe({ organizationId: "" }, renew),
          );
        },
      );

      inCase("rolls a person's overdue period over", async () => {
        await lock();
        const userId = await createUser("overdue person");
        await freePeriod(userId, -5 * MINUTE);

        expectAsOnBaseHere(
          "free renewal, a person's rollover",
          await observe({ userId }, renew),
        );
      });

      inCase("rolls an Organization's overdue period over", async () => {
        await lock();
        const { id } = await createOrganization("overdue Organization");
        await freePeriod(id, -5 * MINUTE, { seats: 3 });

        expectAsOnBaseHere(
          "free renewal, an Organization's rollover",
          await observe({ organizationId: id }, renew),
        );
      });

      inCase("grants the next period before the current one ends", async () => {
        await lock();
        const { id } = await createOrganization("upcoming Organization");
        await freePeriod(id, 5 * MINUTE);

        expectAsOnBaseHere(
          "free renewal, the next period ahead",
          await observe({ organizationId: id }, renew),
        );
      });

      inCase("grants nothing when it runs again", async () => {
        await lock();
        const userId = await createUser("renewed person");
        await freePeriod(userId, -5 * MINUTE);
        await prepared(renew, [
          "Could not renew an overdue local free subscription",
        ]);

        expectAsOnBaseHere(
          "free renewal, again",
          await observe({ userId }, renew),
        );
      });

      inCase("runs once for two ticks at once", async () => {
        await lock();
        const userId = await createUser("doubly renewed person");
        await freePeriod(userId, -5 * MINUTE);

        expectAsOnBaseHere(
          "free renewal, two at once",
          await observe({ userId }, () => twoAtOnce(renew, renew), {
            perFlow: true,
          }),
        );
      });

      inCase("renews an empty owner id as origin/main does", async () => {
        await lock();
        made.subscriptionReferences.push("");
        await freePeriod("", -5 * MINUTE);

        expectAsOnBaseHere(
          "free renewal, an empty owner id",
          await observe({ organizationId: "" }, renew),
        );
      });
    });

    describe("a paid plan's end (Stripe's subscription deleted webhook)", () => {
      const deleted = (id: string) =>
        core.handleSubscriptionDeletedEvent({ id } as Parameters<
          typeof core.handleSubscriptionDeletedEvent
        >[0]);

      inCase(
        "covers the rest of the period of a person whose id is empty",
        async () => {
          await createUser("downgraded person with an empty id", "");
          const { stripeId } = await paidPlan("", {
            endsIn: 10 * DAY,
            endedAgo: MINUTE,
          });

          expectAsOnBaseHere(
            "paid to free, a person with an empty id",
            await observe({ userId: "" }, () => deleted(stripeId)),
          );
        },
      );

      inCase(
        "covers the rest of the period of an Organization whose id is empty",
        async () => {
          await createOrganization(
            "downgraded Organization with an empty id",
            "",
          );
          const { stripeId } = await paidPlan("", {
            endsIn: 10 * DAY,
            endedAgo: MINUTE,
          });

          expectAsOnBaseHere(
            "paid to free, an Organization with an empty id",
            await observe({ organizationId: "" }, () => deleted(stripeId)),
          );
        },
      );

      inCase(
        "grants nothing again to a person whose id is empty and whose period was given",
        async () => {
          await createUser("given person with an empty id", "");
          const { stripeId, periodEnd } = await paidPlan("", {
            endsIn: 10 * DAY,
            endedAgo: MINUTE,
          });
          // The rest of a period canceled early ends where the paid one did.
          await givenFreePeriod("", periodEnd);

          expectAsOnBaseHere(
            "paid to free, a person with an empty id whose period was given",
            await observe({ userId: "" }, () => deleted(stripeId)),
          );
        },
      );

      inCase(
        "covers the rest of a period canceled early with free credits",
        async () => {
          const { id } = await createOrganization("downgraded Organization");
          const { stripeId } = await paidPlan(id, {
            endsIn: 10 * DAY,
            endedAgo: MINUTE,
          });

          expectAsOnBaseHere(
            "paid to free, the rest of a period",
            await observe({ organizationId: id }, () => deleted(stripeId)),
          );
        },
      );

      inCase("starts a person's free plan after the paid period", async () => {
        const userId = await createUser("downgraded person");
        const { stripeId } = await paidPlan(userId, {
          endsIn: -MINUTE,
          endedAgo: null,
        });

        expectAsOnBaseHere(
          "paid to free, a person after the period",
          await observe({ userId }, () => deleted(stripeId)),
        );
      });

      inCase("grants nothing again on a second delivery", async () => {
        const { id } = await createOrganization(
          "again downgraded Organization",
        );
        const { stripeId } = await paidPlan(id, {
          endsIn: 10 * DAY,
          endedAgo: MINUTE,
        });
        await prepared(() => deleted(stripeId));

        expectAsOnBaseHere(
          "paid to free, again",
          await observe({ organizationId: id }, () => deleted(stripeId)),
        );
      });

      inCase("grants once for two deliveries at once", async () => {
        const { id } = await createOrganization(
          "doubly downgraded Organization",
        );
        const { stripeId } = await paidPlan(id, {
          endsIn: 10 * DAY,
          endedAgo: MINUTE,
        });

        expectAsOnBaseHere(
          "paid to free, two at once",
          await observe(
            { organizationId: id },
            () =>
              twoAtOnce(
                () => deleted(stripeId),
                () => deleted(stripeId),
              ),
            { perFlow: true },
          ),
        );
      });

      inCase("answers an empty owner id as origin/main does", async () => {
        made.subscriptionReferences.push("");
        const { stripeId } = await paidPlan("", {
          endsIn: 10 * DAY,
          endedAgo: MINUTE,
        });

        expectAsOnBaseHere(
          "paid to free, an empty owner id",
          await observe({ organizationId: "" }, () => deleted(stripeId)),
        );
      });
    });

    describe("a personal Workspace", () => {
      inCase(
        "answers a person whose id is empty as origin/main does",
        async () => {
          await createUser("person with an empty id", "");

          expectAsOnBaseHere(
            "personal Workspace, a person with an empty id",
            await observe({ userId: "" }, async () => {
              const workspace = await core.createPersonalWorkspace("");
              return { workspace: workspace.userId };
            }),
          );
        },
      );

      // Typed a string; a null reaches it only at run time.
      inCase("answers a null user id as origin/main does", async () => {
        expectAsOnBaseHere(
          "personal Workspace, a null user id",
          await observe({ userId: "" }, async () => {
            const workspace = await core.createPersonalWorkspace(
              null as unknown as string,
            );
            return { workspace: workspace.userId };
          }),
        );
      });

      inCase("answers an empty user id as origin/main does", async () => {
        made.subscriptionReferences.push("");

        expectAsOnBaseHere(
          "personal Workspace, an empty user id",
          await observe({ userId: "" }, async () => {
            const workspace = await core.createPersonalWorkspace("");
            return { workspace: workspace.userId };
          }),
        );
      });
    });

    describe("an enterprise contract's activation", () => {
      const activate = (contractId: string) =>
        core.contract(`/${contractId}/activate`, {
          paymentReference: "PO-1",
        });

      for (const topUp of [true, false]) {
        const shown = topUp ? "with" : "without";
        inCase(`grants the first period ${shown} a top-up`, async () => {
          const { id } = await createOrganization(
            `enterprise Organization ${shown} a top-up`,
          );
          const contractId = await draftContract(id, { topUp });

          expectAsOnBaseHere(
            `activation, ${shown} a top-up`,
            await observe({ organizationId: id }, () => activate(contractId)),
          );
        });
      }

      inCase("grants nothing when it is activated again", async () => {
        const { id } = await createOrganization(
          "again enterprise Organization",
        );
        const contractId = await draftContract(id, { topUp: true });
        await prepared(
          () => activate(contractId),
          ["Kept a database schema mismatch out of Sentry"],
        );

        expectAsOnBaseHere(
          "activation, again",
          await observe({ organizationId: id }, () => activate(contractId)),
        );
      });

      inCase("grants once for two activations at once", async () => {
        const { id } = await createOrganization(
          "doubly activated Organization",
        );
        const contractId = await draftContract(id, { topUp: true });

        expectAsOnBaseHere(
          "activation, two at once",
          await observe(
            { organizationId: id },
            () =>
              twoAtOnce(
                () => activate(contractId),
                () => activate(contractId),
              ),
            { perFlow: true },
          ),
        );
      });

      inCase("grants an Organization whose id is empty as given", async () => {
        await createOrganization(
          "enterprise Organization with an empty id",
          "",
        );
        const contractId = await draftContract("", { topUp: true });

        expectAsOnBaseHere(
          "activation, an empty Organization id",
          await observe({ organizationId: "" }, () => activate(contractId)),
        );
      });
    });

    describe("the enterprise renewal cron", () => {
      const renew = () => core.cron("/enterprise-contracts-renewal");
      const lock = () => freeCronLock("enterprise-contracts-renewal-sync");

      inCase(
        "grants the due period, the next one ahead, and expires the last",
        async () => {
          await lock();
          const { id } = await createOrganization("renewing enterprise");
          await runningContract(id);

          expectAsOnBaseHere(
            "enterprise renewal, first",
            await observe({ organizationId: id }, renew),
          );
        },
      );

      inCase("grants nothing when it runs again", async () => {
        await lock();
        const { id } = await createOrganization("renewed enterprise");
        await runningContract(id);
        await prepared(renew, ["A scheduled sync failed"]);

        expectAsOnBaseHere(
          "enterprise renewal, again",
          await observe({ organizationId: id }, renew),
        );
      });

      inCase("runs once for two ticks at once", async () => {
        await lock();
        const { id } = await createOrganization("doubly renewed enterprise");
        await runningContract(id);

        expectAsOnBaseHere(
          "enterprise renewal, two at once",
          await observe({ organizationId: id }, () => twoAtOnce(renew, renew), {
            perFlow: true,
          }),
        );
      });

      inCase("grants an Organization whose id is empty as given", async () => {
        await lock();
        await createOrganization("renewing enterprise with an empty id", "");
        await runningContract("");

        expectAsOnBaseHere(
          "enterprise renewal, an empty Organization id",
          await observe({ organizationId: "" }, renew),
        );
      });
    });

    describe("an enterprise contract's cancellation", () => {
      const cancel = (contractId: string) =>
        core.contract(`/${contractId}/cancel`);

      inCase("expires every live and later grant of the contract", async () => {
        const { id } = await createOrganization("canceling enterprise");
        const contract = await liveContract(id);

        expectAsOnBaseHere(
          "cancellation, first",
          await observe({ organizationId: id }, () => cancel(contract.id)),
        );
      });

      inCase("expires nothing when it is canceled again", async () => {
        const { id } = await createOrganization("canceled enterprise");
        const contract = await liveContract(id);
        await prepared(
          () => cancel(contract.id),
          ["Kept a database schema mismatch out of Sentry"],
        );

        expectAsOnBaseHere(
          "cancellation, again",
          await observe({ organizationId: id }, () => cancel(contract.id)),
        );
      });

      inCase("answers two cancellations at once", async () => {
        const { id } = await createOrganization("doubly canceled enterprise");
        const contract = await liveContract(id);

        expectAsOnBaseHere(
          "cancellation, two at once",
          await observe(
            { organizationId: id },
            () =>
              twoAtOnce(
                () => cancel(contract.id),
                () => cancel(contract.id),
              ),
            { perFlow: true },
          ),
        );
      });

      inCase("expires an Organization whose id is empty as given", async () => {
        await createOrganization("canceling enterprise with an empty id", "");
        const contract = await liveContract("");

        expectAsOnBaseHere(
          "cancellation, an empty Organization id",
          await observe({ organizationId: "" }, () => cancel(contract.id)),
        );
      });
    });
  },
);
