/**
 * The free grants on a real PostgreSQL, each at its own entry point: the
 * sign-up bonus of a personal Workspace (`createPersonalWorkspace`), admin
 * free credits (`freeCreditAdminService.grantFreeCredits`, what
 * `POST /v1/admin/credits` calls), the CMO Tester grant
 * (`grantCmoTesterCredits`) and the eval lane top-up (`prepareEvalLane`).
 * What each answers, every credit row, the Tasks it woke and the statements
 * PostgreSQL received, with each transaction's boundaries and isolation level.
 *
 * All of it is compared with `grant.base.json`, which this file wrote while
 * it ran on `origin/main`'s code (`81d0165d4`), before the grants moved into
 * the credits module, once per layout:
 * RECORD_GRANT_BASE=true RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter core test src/lib/credits/grant.postgres.test.ts
 * and the same with the split layout's three `DATABASE_SCHEMA_*` names.
 * Without `RECORD_GRANT_BASE` the same command compares.
 *
 * It needs the database to itself, as CI gives each worker its own
 * (`POSTGRES_TEST_DATABASE_PER_WORKER`): a case that runs two grants at once
 * waits until PostgreSQL shows one of them waiting for a lock, and another
 * file's lock wait would count.
 */
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client, type Pool } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";

/** Work handed to `waitUntil`, awaited as part of the call observed. */
const background = vi.hoisted(() => [] as Promise<unknown>[]);
/**
 * The Task wake, held or failed on demand. `hold` holds the next wake before
 * it runs, after its grant is written; `failAfter` makes the next wake throw
 * after it ran, inside the grant's transaction.
 */
const wake = vi.hoisted(() => ({
  hold: null as null | { reached: () => void; release: Promise<void> },
  failAfter: false,
}));
vi.mock("@vercel/functions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vercel/functions")>();
  const { observePool } = await import("@/test/spend-comparison");
  return {
    ...actual,
    waitUntil: (work: Promise<unknown>) => {
      background.push(work);
    },
    attachDatabasePool: (pool: Pool) => {
      observePool(pool);
      actual.attachDatabasePool(pool);
    },
  };
});
vi.mock("@/services/task-topup.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/task-topup.service")>();
  return {
    ...actual,
    markOutOfCreditsTasksAsToppedUp: async (
      params: Parameters<typeof actual.markOutOfCreditsTasksAsToppedUp>[0],
    ) => {
      const held = wake.hold;
      wake.hold = null;
      if (held) {
        held.reached();
        await held.release;
      }
      await actual.markOutOfCreditsTasksAsToppedUp(params);
      if (wake.failAfter) {
        wake.failAfter = false;
        throw new Error("Failed after the Task wake");
      }
    },
  };
});

import { getNextMonthlyPeriodEnd } from "@sokosumi/database/helpers";
import { CMO_SOKO_BOT_VERSION_IDS } from "@sokosumi/soko-bot";

import { getEnv } from "@/config/env";
import { createPersonalWorkspace } from "@/helpers/personal-workspace";
import { createNetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import { grantCmoTesterCredits } from "@/services/cmo-billing.service";
import {
  type EvalLaneRecord,
  prepareEvalLane,
} from "@/services/evals/eval-lanes.service";
import { freeCreditAdminService } from "@/services/free-credit-admin.service";
import {
  baseFile,
  inFlow,
  nextMillisecond,
  observing,
  plain,
  sendOrder,
  sentBeforeAnswered,
  statements,
} from "@/test/spend-comparison";
import { onSplitLayout, testSchemaNames } from "@/test/split-layout";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

/**
 * The setup creates workspaces through the product's own path: seconds on a
 * loaded machine, past Vitest's 10 s hook limit on CI's runner.
 */
const SETUP_TIMEOUT = 60_000;
/** A case runs whole grants, sometimes two at once, and reads every row back. */
const CASE_TIMEOUT = 90_000;
const DAY = 86_400_000;
const UUID_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const BASE_FILE = fileURLToPath(new URL("./grant.base.json", import.meta.url));
const { expectAsOnBase } = baseFile(
  BASE_FILE,
  process.env.RECORD_GRANT_BASE === "true",
  // No debit is written: every statement is compared as recorded.
  { debitMoved: false },
);
/** The layout is part of the key: `origin/main` answers differently on each. */
const layout = onSplitLayout ? "split layout" : "today's layout";
const expectAsOnBaseHere = (key: string, observed: unknown) =>
  expectAsOnBase(`${key} (${layout})`, observed);

const mainnet = () => createNetworkScope("mainnet").networkDb;

/** Random values in a statement or a row, each under a name. */
const labels = new Map<string, string>();
const made = {
  userIds: [] as string[],
  organizationIds: [] as string[],
  workspaceIds: [] as string[],
  projectIds: [] as string[],
  taskIds: [] as string[],
  sokoBotIds: [] as string[],
};

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
  made.userIds.push(id);
  labels.set(id, `<${name}>`);
  return id;
}

/** An Organization with its owner and its Workspace. */
async function createOrganization(name: string) {
  const ownerId = await createUser(`${name}'s owner`);
  const organizationId = `grant-fixture-${randomUUID()}`;
  await prisma.organization.create({
    data: {
      id: organizationId,
      name: "Grant fixture",
      slug: organizationId,
      members: { create: { userId: ownerId, role: "owner" } },
    },
  });
  made.organizationIds.push(organizationId);
  labels.set(organizationId, `<${name}>`);
  const workspace = await prisma.workspace.create({
    data: { organizationId },
    select: { id: true },
  });
  made.workspaceIds.push(workspace.id);
  labels.set(workspace.id, `<${name}'s workspace>`);
  return { organizationId, ownerId, workspaceId: workspace.id };
}

async function createProject(workspaceId: string, name: string) {
  const project = await prisma.project.create({
    data: { workspaceId, name: "Grant fixture" },
    select: { id: true },
  });
  made.projectIds.push(project.id);
  labels.set(project.id, `<${name}>`);
  return project.id;
}

/**
 * Where the Tasks of a person live before the person has a Workspace: an
 * Organization the person joins, as its notices require.
 */
let taskHome: ReturnType<typeof createOrganization> | undefined;
async function taskHomeWorkspace(userId: string): Promise<string> {
  taskHome ??= createOrganization("Task home");
  const { organizationId, workspaceId } = await taskHome;
  await prisma.member.createMany({
    data: [{ organizationId, userId, role: "member" }],
    skipDuplicates: true,
  });
  return workspaceId;
}

/**
 * A Task that waits for credits, with the unread notice that says so to
 * `noticeTo`.
 */
async function waitingTask(
  name: string,
  owner: {
    ownerId: string | null;
    organizationId: string | null;
    projectId: string | null;
    workspaceId: string;
    noticeTo: string;
  },
): Promise<string> {
  const task = await prisma.task.create({
    data: {
      name: "Grant fixture",
      status: "OUT_OF_CREDITS",
      ownerId: owner.ownerId,
      creatorUserId: owner.ownerId ?? owner.noticeTo,
      organizationId: owner.organizationId,
      projectId: owner.projectId,
      workspaceId: owner.workspaceId,
    },
    select: { id: true },
  });
  made.taskIds.push(task.id);
  labels.set(task.id, `<${name}>`);
  await prisma.notification.create({
    data: {
      userId: owner.noticeTo,
      kind: "TASK",
      referenceId: task.id,
      eventId: `grant-fixture-${task.id}`,
      messageKey: "Notifications.Task.outOfCredits",
      messageParams: "{}",
    },
  });
  return task.id;
}

/** A Cuso, live and hired, of the Organization's Project. */
async function liveCuso(workspaceId: string, projectId: string, name: string) {
  const bot = await prisma.sokoBot.create({
    data: {
      workspaceId,
      projectId,
      userId: null,
      versionId: CMO_SOKO_BOT_VERSION_IDS[0],
      name: "Cuso",
    },
    select: { id: true },
  });
  made.sokoBotIds.push(bot.id);
  labels.set(bot.id, `<${name}>`);
  return bot.id;
}

/** An eval lane of its own: an Organization, its Soko Bot and its Cuso. */
async function evalLane(name: string): Promise<EvalLaneRecord> {
  const { organizationId, ownerId, workspaceId } =
    await createOrganization(name);
  const cusoProjectId = await createProject(workspaceId, `${name}'s Project`);
  const sokoBot = await prisma.sokoBot.create({
    data: { workspaceId, userId: ownerId, name: "Soko Bot" },
    select: { id: true },
  });
  made.sokoBotIds.push(sokoBot.id);
  labels.set(sokoBot.id, `<${name}'s Soko Bot>`);
  return {
    // Its number is only the grant's note.
    lane: 7,
    userId: ownerId,
    organizationId,
    workspaceId,
    sokoBotId: sokoBot.id,
    cusoBotId: await liveCuso(workspaceId, cusoProjectId, `${name}'s Cuso`),
    cusoProjectId,
    world: {
      hannahUserId: ownerId,
      alexUserId: ownerId,
      marketingProjectId: cusoProjectId,
      outreachProjectId: cusoProjectId,
      roomId: randomUUID(),
    },
  };
}

type Owner = { userId: string } | { organizationId: string };

/** Rows of Tasks in the order the fixture made the Tasks; stable within one. */
function inTaskOrder<T>(list: T[], taskOf: (row: T) => string) {
  return list.sort(
    (a, b) => made.taskIds.indexOf(taskOf(a)) - made.taskIds.indexOf(taskOf(b)),
  );
}

/**
 * Every credit row of the owner, the Tasks given and what the wake wrote, in
 * an order the product defines: a grant's own kind, then the order its
 * bucket was first sent in (`sentAt`, from the observed statements; one that
 * was there before comes first), then its time. Two grants of one kind can
 * share a millisecond, and PostgreSQL returns them in any order.
 */
async function rows(
  owner: Owner,
  taskIds: readonly string[],
  sentAt: (id: string) => number = () => -1,
) {
  const db = mainnet();
  const buckets = await db.creditBucket.findMany({ where: owner });
  const order = (a: (typeof buckets)[number], b: (typeof buckets)[number]) =>
    `${a.referenceType}`.localeCompare(`${b.referenceType}`) ||
    sentAt(a.id) - sentAt(b.id) ||
    a.createdAt.getTime() - b.createdAt.getTime();
  buckets.sort(order);
  const transactions = await db.transaction.findMany({
    where: { id: { in: buckets.map((bucket) => bucket.sourceTransactionId) } },
  });
  transactions.sort(
    (a, b) =>
      buckets.findIndex((bucket) => bucket.sourceTransactionId === a.id) -
      buckets.findIndex((bucket) => bucket.sourceTransactionId === b.id),
  );
  return {
    transactions,
    // Every transaction of the owner, the grants' and any other: a grant
    // written without its bucket shows here.
    transactionCount: await db.transaction.count({ where: owner }),
    buckets,
    subscriptions:
      "userId" in owner
        ? await prisma.subscription.findMany({
            where: { referenceId: owner.userId },
            orderBy: { createdAt: "asc" },
          })
        : [],
    // In the fixture's order: two Tasks can share a millisecond and an id
    // order nobody defines.
    tasks: inTaskOrder(
      await prisma.task.findMany({
        where: { id: { in: [...taskIds] } },
        select: { id: true, status: true, updatedAt: true },
      }),
      (task) => task.id,
    ),
    taskEvents: inTaskOrder(
      await prisma.taskEvent.findMany({
        where: { taskId: { in: [...taskIds] } },
        orderBy: { createdAt: "asc" },
      }),
      (event) => event.taskId,
    ),
    notifications: inTaskOrder(
      await prisma.notification.findMany({
        where: { referenceId: { in: [...taskIds] } },
        select: { referenceId: true, isRead: true, readAt: true },
      }),
      (notice) => notice.referenceId,
    ),
  };
}

type Rows = Awaited<ReturnType<typeof rows>>;

/**
 * A failure's message without where it was thrown: Prisma's message names the
 * calling file and line, which differ between machines, and quotes its
 * source, and ends with the cause.
 */
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
  return Object.fromEntries(
    Object.entries(outcome).map(([key, value]) => [key, asAnswered(value)]),
  );
}

/**
 * What `plain` hides of the rows, taken from the raw values first: the kind
 * of each new id, that ids sort as their rows' times do, which times fall in
 * the call, and each expiry's distance from its grant.
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
  const changedTasks = left.tasks.filter(
    (task) =>
      before.tasks.find((was) => was.id === task.id)?.status !== task.status,
  );
  const freshEvents = left.taskEvents.filter(
    (event) => !before.taskEvents.some((was) => was.id === event.id),
  );
  return {
    uuidVersions: [...freshTransactions, ...fresh, ...freshEvents].map((row) =>
      row.id.charAt(14),
    ),
    idsSortLikeTimes: {
      transactions: inTimeOrder(left.transactions),
      buckets: inTimeOrder(left.buckets),
    },
    grantTimesWithinTheCall: [...freshTransactions, ...fresh].flatMap((row) => [
      within(row.createdAt),
      within(row.updatedAt),
    ]),
    // Each new bucket's reference, as its kind composes it from the owner,
    // checked on the raw value: `plain` hides the times in it.
    references: fresh.map((bucket) => {
      const owner = bucket.userId ?? bucket.organizationId;
      const prefix = bucket.userId ? "user:" : "org:";
      switch (bucket.referenceType) {
        case "SIGNUP_BONUS":
          return bucket.referenceId === `user:${bucket.userId}`;
        case "STRIPE_SUBSCRIPTION_PERIOD":
          return left.subscriptions.some(
            (period) =>
              bucket.referenceId ===
              `${prefix}${owner}:local-free:${period.periodEnd?.toISOString()}:subscription`,
          );
        default:
          return (
            new RegExp(`^${prefix}${owner}:free:${UUID_PATTERN}$`).test(
              bucket.referenceId ?? "",
            ) &&
            fresh.filter((other) => other.referenceId === bucket.referenceId)
              .length === 1
          );
      }
    }),
    expiries: fresh.map((bucket) => {
      if (bucket.expiresAt === null) return null;
      if (bucket.referenceType === "STRIPE_SUBSCRIPTION_PERIOD") {
        // A calendar month: the bucket ends with its period, and the period
        // ends one month on from its start, on its anchor's day.
        const period = left.subscriptions.find(
          (candidate) =>
            candidate.periodEnd?.getTime() === bucket.expiresAt?.getTime(),
        );
        return {
          endsWithItsPeriod: period !== undefined,
          periodIsOneMonthOn:
            period?.periodStart != null &&
            getNextMonthlyPeriodEnd(
              period.periodStart,
              period.createdAt,
            ).getTime() === period.periodEnd?.getTime(),
          activatesAt: bucket.activatesAt,
        };
      }
      // Whole days after the grant, and that the clock the expiry counts
      // from was read in the call.
      const days = Math.round(
        (bucket.expiresAt.getTime() - bucket.createdAt.getTime()) / DAY,
      );
      return {
        days,
        countedFromTheCall: within(
          new Date(bucket.expiresAt.getTime() - days * DAY),
        ),
      };
    }),
    wakeTimesWithinTheCall: [
      ...changedTasks.map((task) => within(task.updatedAt)),
      ...freshEvents.map((event) => within(event.createdAt)),
      ...left.notifications
        .filter((notice) => notice.isRead)
        .map((notice) => within(notice.readAt)),
    ],
  };
}

/**
 * One call: its answer, the statements it sent and in which order across
 * its transactions, which statement was sent before the one before it was
 * answered, and the rows it left. A call that
 * reaches the database and sends nothing fails here: an observation without
 * SQL proves nothing.
 */
async function observe(
  owner: Owner,
  taskIds: readonly string[],
  call: () => Promise<unknown>,
) {
  const before = await rows(owner, taskIds);
  const started = await nextMillisecond();
  const { outcome, log } = await observing(async () => {
    const result = await call();
    while (background.length > 0) await Promise.all(background.splice(0));
    return result;
  });
  const ended = Date.now();
  expect(log.length).toBeGreaterThan(0);
  const firstSent = new Map<string, number>();
  log.forEach(({ values }, at) => {
    for (const value of values) {
      if (typeof value === "string" && !firstSent.has(value))
        firstSent.set(value, at);
    }
  });
  const left = await rows(owner, taskIds, (id) => firstSent.get(id) ?? -1);
  // An object: the case adds its own entries beside it.
  return plain(
    {
      outcome: asAnswered(outcome),
      statements: statements(log, { asSent: true }),
      sendOrder: sendOrder(log),
      sentBeforeAnswered: sentBeforeAnswered(log),
      rows: left,
      raw: rawRelations(left, before, started, ended),
    },
    labels,
  ) as Record<string, unknown>;
}

/**
 * Waits until PostgreSQL shows a statement of this database waiting for a
 * lock: the second of two grants, behind the first. On a separate
 * connection, outside the pool Core's statements are recorded from.
 */
async function untilOneWaitsForALock(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    for (let tries = 0; tries < 600; tries += 1) {
      const { rows: found } = await client.query<{ waiting: number }>(
        `SELECT count(*)::int AS waiting FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock'`,
      );
      if ((found[0]?.waiting ?? 0) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("No grant waited for a lock");
  } finally {
    await client.end();
  }
}

/**
 * Two calls at once, in the one order this allows: the first runs until its
 * Task wake, after its grant is written, and holds there; then `between`
 * runs and the second starts. A second that `waits` runs until PostgreSQL
 * shows it waiting for the first's lock; otherwise it finishes. Then the
 * first goes on. A first that fails before its wake holds nothing: the
 * second starts after it ended.
 */
async function twoAtOnce<T>(
  first: () => Promise<T>,
  second: () => Promise<T>,
  options: { waits: boolean; between?: () => Promise<void> },
): Promise<{ first: T | { threw: string }; second: T | { threw: string } }> {
  let release = () => {};
  let reached = () => {};
  const hold = {
    reached: () => reached(),
    release: new Promise<void>((resolve) => {
      release = resolve;
    }),
  };
  const atTheWake = new Promise<"held">((resolve) => {
    reached = () => resolve("held");
  });
  wake.hold = hold;
  const settled = <R>(promise: Promise<R>) =>
    promise.then(
      (value) => value,
      (error: unknown) => ({
        threw: error instanceof Error ? cause(error.message) : String(error),
      }),
    );
  const firstDone = settled(inFlow("first", first));
  const held = await Promise.race([atTheWake, firstDone.then(() => "ended")]);
  wake.hold = null;
  // The gate is reached wherever the first grant is written: on the split
  // layout `origin/main` cannot write it, and the first ends before it.
  expect(held).toBe(onSplitLayout ? "ended" : "held");
  await options.between?.();
  const secondDone = settled(inFlow("second", second));
  if (held === "held") {
    if (options.waits) await untilOneWaitsForALock();
    else await secondDone;
    release();
  }
  return { first: await firstDone, second: await secondDone };
}

/** Takes a person's personal Workspace away, outside Core's pool. */
async function forgetPersonalWorkspace(userId: string): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const shared = testSchemaNames().DATABASE_SCHEMA_SHARED;
    await client.query(
      `DELETE FROM "${shared}"."workspace" WHERE "userId" = $1`,
      [userId],
    );
  } finally {
    await client.end();
  }
}

/**
 * The first grant of a case that grants again. On the split layout
 * `origin/main` cannot grant (its shared client reaches the Network's
 * tables), so what it answered there is part of what the case compares.
 */
async function firstGrant(call: () => Promise<unknown>) {
  try {
    await call();
    return "granted";
  } catch (error) {
    if (!onSplitLayout) throw error;
    return { threw: error instanceof Error ? error.name : String(error) };
  }
}

/** A personal Workspace's answer, without what differs between two runs. */
const workspaceAnswer = (workspace: { id: string; userId: string | null }) => ({
  workspace: workspace.userId,
});

describe.skipIf(!enabled)(
  "the free grants, as on origin/main (PostgreSQL)",
  () => {
    afterAll(async () => {
      const db = mainnet();
      const owners = {
        OR: [
          { userId: { in: made.userIds } },
          { organizationId: { in: made.organizationIds } },
        ],
      };
      await db.creditBucket.deleteMany({ where: owners });
      await db.transaction.deleteMany({ where: owners });
      await prisma.notification.deleteMany({
        where: { referenceId: { in: made.taskIds } },
      });
      await prisma.task.deleteMany({ where: { id: { in: made.taskIds } } });
      await prisma.sokoBot.deleteMany({
        where: { id: { in: made.sokoBotIds } },
      });
      await prisma.project.deleteMany({
        where: { id: { in: made.projectIds } },
      });
      await prisma.workspace.deleteMany({
        where: {
          OR: [
            { id: { in: made.workspaceIds } },
            { userId: { in: made.userIds } },
          ],
        },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: made.organizationIds } },
      });
      // The free plan `createPersonalWorkspace` grants is not tied to the user.
      await prisma.subscription.deleteMany({
        where: { referenceId: { in: made.userIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: made.userIds } } });
    }, SETUP_TIMEOUT);

    describe("the sign-up bonus of a personal Workspace", () => {
      async function newcomer(name: string) {
        const userId = await createUser(name);
        const taskId = await waitingTask(`${name}'s waiting Task`, {
          ownerId: userId,
          organizationId: null,
          projectId: null,
          workspaceId: await taskHomeWorkspace(userId),
          noticeTo: userId,
        });
        return { userId, taskIds: [taskId] };
      }

      it(
        "grants the bonus and the free plan once, and wakes the person's Task",
        async () => {
          const { userId, taskIds } = await newcomer("newcomer");
          // The bonus's size and life, as Core reads them.
          const { SIGNUP_BONUS_CREDITS, SIGNUP_BONUS_TTL_DAYS } = getEnv();
          expect([SIGNUP_BONUS_CREDITS, SIGNUP_BONUS_TTL_DAYS]).toEqual([
            3000, 30,
          ]);

          expectAsOnBaseHere(
            "sign-up, first",
            await observe({ userId }, taskIds, async () =>
              workspaceAnswer(await createPersonalWorkspace(userId)),
            ),
          );
        },
        CASE_TIMEOUT,
      );

      it(
        "grants nothing again and wakes no Task when the Workspace comes again",
        async () => {
          const { userId, taskIds } = await newcomer("returning newcomer");
          await createPersonalWorkspace(userId);
          await forgetPersonalWorkspace(userId);
          // A Task that waits now: a grant that is not new must not wake it.
          taskIds.push(
            await waitingTask("returning newcomer's later Task", {
              ownerId: userId,
              organizationId: null,
              projectId: null,
              workspaceId: await taskHomeWorkspace(userId),
              noticeTo: userId,
            }),
          );

          expectAsOnBaseHere(
            "sign-up, again",
            await observe({ userId }, taskIds, async () =>
              workspaceAnswer(await createPersonalWorkspace(userId)),
            ),
          );
        },
        CASE_TIMEOUT,
      );

      it(
        "grants once when two Workspace creations grant at once",
        async () => {
          const { userId, taskIds } = await newcomer("doubled newcomer");
          const create = async () =>
            workspaceAnswer(await createPersonalWorkspace(userId));

          expectAsOnBaseHere(
            "sign-up, two at once",
            await observe({ userId }, taskIds, () =>
              twoAtOnce(create, create, {
                waits: true,
                // The first Workspace is gone again, so a second is created.
                between: () => forgetPersonalWorkspace(userId),
              }),
            ),
          );
        },
        CASE_TIMEOUT,
      );

      it(
        "rolls the grants and the wake back together, and keeps the Workspace",
        async () => {
          const { userId, taskIds } = await newcomer("unlucky newcomer");
          wake.failAfter = true;

          expectAsOnBaseHere(
            "sign-up, rolled back after the wake",
            await observe({ userId }, taskIds, async () =>
              workspaceAnswer(await createPersonalWorkspace(userId)),
            ),
          );
          expect(wake.failAfter).toBe(onSplitLayout);
          wake.failAfter = false;
        },
        CASE_TIMEOUT,
      );
    });

    describe("admin free credits", () => {
      async function person(name: string) {
        const userId = await createUser(name);
        const taskId = await waitingTask(`${name}'s waiting Task`, {
          ownerId: userId,
          organizationId: null,
          projectId: null,
          workspaceId: await taskHomeWorkspace(userId),
          noticeTo: userId,
        });
        return { userId, taskIds: [taskId] };
      }
      async function organization(name: string) {
        const { organizationId, ownerId, workspaceId } =
          await createOrganization(name);
        const taskId = await waitingTask(`${name}'s waiting Task`, {
          ownerId: null,
          organizationId,
          projectId: null,
          workspaceId,
          noticeTo: ownerId,
        });
        return { organizationId, taskIds: [taskId] };
      }
      const toPerson = (userId: string) => ({
        target: { targetType: "user" as const, targetId: userId },
        credits: 500,
        ttlDays: 30,
        referenceNote: "Billing issue",
      });
      const toOrganization = (organizationId: string) => ({
        target: {
          targetType: "organization" as const,
          targetId: organizationId,
        },
        credits: 1200,
        ttlDays: null,
        referenceNote: null,
      });

      it(
        "grants a person credits with a note and an expiry, and wakes their Task",
        async () => {
          const { userId, taskIds } = await person("admin's person");

          expectAsOnBaseHere(
            "admin, a person, with note and expiry",
            await observe({ userId }, taskIds, () =>
              freeCreditAdminService.grantFreeCredits(toPerson(userId)),
            ),
          );
        },
        CASE_TIMEOUT,
      );

      it(
        "grants an Organization credits with no note and no expiry, and wakes its Task",
        async () => {
          const { organizationId, taskIds } = await organization(
            "admin's Organization",
          );

          expectAsOnBaseHere(
            "admin, an Organization, without note and expiry",
            await observe({ organizationId }, taskIds, () =>
              freeCreditAdminService.grantFreeCredits(
                toOrganization(organizationId),
              ),
            ),
          );
        },
        CASE_TIMEOUT,
      );

      it(
        "grants again when the same request comes again: there is no submission id",
        async () => {
          const { userId, taskIds } = await person("admin's repeated person");
          const first = await firstGrant(() =>
            freeCreditAdminService.grantFreeCredits(toPerson(userId)),
          );
          await prisma.task.updateMany({
            where: { id: { in: taskIds } },
            data: { status: "OUT_OF_CREDITS" },
          });

          expectAsOnBaseHere("admin, the same request again", {
            first,
            ...(await observe({ userId }, taskIds, () =>
              freeCreditAdminService.grantFreeCredits(toPerson(userId)),
            )),
          });
        },
        CASE_TIMEOUT,
      );

      it(
        "grants twice when the same request comes twice at once",
        async () => {
          const { organizationId, taskIds } = await organization(
            "admin's doubled Organization",
          );
          const call = () =>
            freeCreditAdminService.grantFreeCredits(
              toOrganization(organizationId),
            );

          expectAsOnBaseHere(
            "admin, two at once",
            await observe({ organizationId }, taskIds, () =>
              twoAtOnce(call, call, { waits: false }),
            ),
          );
        },
        CASE_TIMEOUT,
      );

      it(
        "rolls the grant and the wake back together",
        async () => {
          const { userId, taskIds } = await person("admin's unlucky person");
          wake.failAfter = true;

          expectAsOnBaseHere(
            "admin, rolled back after the wake",
            await observe({ userId }, taskIds, () =>
              freeCreditAdminService.grantFreeCredits(toPerson(userId)),
            ),
          );
          wake.failAfter = false;
        },
        CASE_TIMEOUT,
      );

      it(
        "refuses a person who does not exist, with nothing written",
        async () => {
          const missing = randomUUID();
          labels.set(missing, "<nobody>");

          expectAsOnBaseHere(
            "admin, nobody",
            await observe({ userId: missing }, [], () =>
              freeCreditAdminService.grantFreeCredits(toPerson(missing)),
            ),
          );
        },
        CASE_TIMEOUT,
      );

      /*
       * A Project id that is no Project's, or null, as callers inside Core
       * can pass it (the HTTP route takes none): the database helper checks
       * it as given and the bucket's insert writes it as given.
       */
      for (const projectId of ["", null] as const) {
        const shown = projectId === null ? "null" : "an empty";
        it(
          `grants a person credits with ${shown} Project id as origin/main does`,
          async () => {
            const { userId, taskIds } = await person(
              `admin's person with ${shown} Project id`,
            );

            expectAsOnBaseHere(
              `admin, a person, ${shown} Project id`,
              await observe({ userId }, taskIds, () =>
                freeCreditAdminService.grantFreeCredits({
                  ...toPerson(userId),
                  projectId,
                }),
              ),
            );
          },
          CASE_TIMEOUT,
        );

        it(
          `grants an Organization credits with ${shown} Project id as origin/main does`,
          async () => {
            const { organizationId, taskIds } = await organization(
              `admin's Organization with ${shown} Project id`,
            );

            expectAsOnBaseHere(
              `admin, an Organization, ${shown} Project id`,
              await observe({ organizationId }, taskIds, () =>
                freeCreditAdminService.grantFreeCredits({
                  ...toOrganization(organizationId),
                  projectId,
                }),
              ),
            );
          },
          CASE_TIMEOUT,
        );
      }

      it(
        "grants inside a transaction the caller opened, and rolls back with it",
        async () => {
          const { organizationId, taskIds } = await organization(
            "admin's Organization in a caller's transaction",
          );

          expectAsOnBaseHere(
            "admin, in the caller's transaction, rolled back by the caller",
            await observe({ organizationId }, taskIds, () =>
              prisma.$transaction(async (tx) => {
                await freeCreditAdminService.grantFreeCredits({
                  ...toOrganization(organizationId),
                  tx,
                });
                throw new Error("The caller failed after the grant");
              }),
            ),
          );
        },
        CASE_TIMEOUT,
      );
    });

    describe("the CMO Tester grant", () => {
      /** An Organization's Project with a live Cuso, and a Task of another Project. */
      async function cusoProject(name: string) {
        const { organizationId, ownerId, workspaceId } =
          await createOrganization(name);
        const projectId = await createProject(workspaceId, `${name}'s Project`);
        await liveCuso(workspaceId, projectId, `${name}'s Cuso`);
        const otherProjectId = await createProject(
          workspaceId,
          `${name}'s other Project`,
        );
        const taskIds = [
          await waitingTask(`${name}'s Project Task`, {
            ownerId: null,
            organizationId,
            projectId,
            workspaceId,
            noticeTo: ownerId,
          }),
          // Project credits must not wake another Project's Task.
          await waitingTask(`${name}'s other Project's Task`, {
            ownerId: null,
            organizationId,
            projectId: otherProjectId,
            workspaceId,
            noticeTo: ownerId,
          }),
        ];
        return { organizationId, projectId, taskIds };
      }

      it(
        "grants the Project its Tester credits and wakes only its Tasks",
        async () => {
          const { organizationId, projectId, taskIds } = await cusoProject(
            "Tester Organization",
          );

          expectAsOnBaseHere(
            "Tester, first",
            await observe({ organizationId }, taskIds, () =>
              grantCmoTesterCredits({ projectId, organizationId }),
            ),
          );
        },
        CASE_TIMEOUT,
      );

      it(
        "grants nothing again while the Tester credits last",
        async () => {
          const { organizationId, projectId, taskIds } = await cusoProject(
            "repeated Tester Organization",
          );
          const first = await firstGrant(() =>
            grantCmoTesterCredits({ projectId, organizationId }),
          );

          expectAsOnBaseHere("Tester, again", {
            first,
            ...(await observe({ organizationId }, taskIds, () =>
              grantCmoTesterCredits({ projectId, organizationId }),
            )),
          });
        },
        CASE_TIMEOUT,
      );

      it(
        "grants once when the button is clicked twice at once",
        async () => {
          const { organizationId, projectId, taskIds } = await cusoProject(
            "doubled Tester Organization",
          );
          const click = () =>
            grantCmoTesterCredits({ projectId, organizationId });

          expectAsOnBaseHere(
            "Tester, two at once",
            await observe({ organizationId }, taskIds, () =>
              twoAtOnce(click, click, { waits: true }),
            ),
          );
        },
        CASE_TIMEOUT,
      );

      it(
        "answers an empty Project id as origin/main does",
        async () => {
          const { organizationId, taskIds } = await cusoProject(
            "Tester Organization with an empty Project id",
          );

          expectAsOnBaseHere(
            "Tester, an empty Project id",
            await observe({ organizationId }, taskIds, () =>
              grantCmoTesterCredits({ projectId: "", organizationId }),
            ),
          );
        },
        CASE_TIMEOUT,
      );

      it(
        "rolls the grant, the wake and the guard's write back together",
        async () => {
          const { organizationId, projectId, taskIds } = await cusoProject(
            "unlucky Tester Organization",
          );
          wake.failAfter = true;

          expectAsOnBaseHere(
            "Tester, rolled back after the wake",
            await observe({ organizationId }, taskIds, () =>
              grantCmoTesterCredits({ projectId, organizationId }),
            ),
          );
          wake.failAfter = false;
        },
        CASE_TIMEOUT,
      );
    });

    describe("the eval lane top-up", () => {
      const versions = {
        sokoBot: "soko-bot-eval-fixture",
        cuso: CMO_SOKO_BOT_VERSION_IDS[0],
      };
      async function lane(name: string) {
        const record = await evalLane(name);
        const taskId = await waitingTask(`${name}'s waiting Task`, {
          ownerId: null,
          organizationId: record.organizationId,
          projectId: null,
          workspaceId: record.workspaceId,
          noticeTo: record.userId,
        });
        return { record, taskIds: [taskId] };
      }

      it(
        "tops an empty lane up for the day, with a note and an expiry",
        async () => {
          const { record, taskIds } = await lane("empty lane");

          expectAsOnBaseHere(
            "eval lane, empty",
            await observe(
              { organizationId: record.organizationId },
              taskIds,
              () => prepareEvalLane(record, versions),
            ),
          );
        },
        CASE_TIMEOUT,
      );

      it(
        "grants nothing to a lane that holds enough",
        async () => {
          const { record, taskIds } = await lane("full lane");
          const first = await firstGrant(() =>
            prepareEvalLane(record, versions),
          );

          expectAsOnBaseHere("eval lane, again", {
            first,
            ...(await observe(
              { organizationId: record.organizationId },
              taskIds,
              () => prepareEvalLane(record, versions),
            )),
          });
        },
        CASE_TIMEOUT,
      );

      it(
        "tops up twice when two runs prepare one lane at once",
        async () => {
          const { record, taskIds } = await lane("doubled lane");
          const prepare = () => prepareEvalLane(record, versions);

          expectAsOnBaseHere(
            "eval lane, two at once",
            await observe(
              { organizationId: record.organizationId },
              taskIds,
              () => twoAtOnce(prepare, prepare, { waits: false }),
            ),
          );
        },
        CASE_TIMEOUT,
      );

      it(
        "rolls the top-up and the wake back together",
        async () => {
          const { record, taskIds } = await lane("unlucky lane");
          wake.failAfter = true;

          expectAsOnBaseHere(
            "eval lane, rolled back after the wake",
            await observe(
              { organizationId: record.organizationId },
              taskIds,
              () => prepareEvalLane(record, versions),
            ),
          );
          wake.failAfter = false;
        },
        CASE_TIMEOUT,
      );
    });
  },
);
