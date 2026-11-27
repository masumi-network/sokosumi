/**
 * The three credit refunds on a real PostgreSQL: a paid Job's (the refund
 * phase of Job sync), a Cardano Task payment claim's, and a Task x402
 * payment's (node refusal, operator goodwill refund, operator resolve). Each
 * runs through its own entry point, which opens its own transaction, on a
 * deployment whose `NETWORK` is Mainnet and on one whose `NETWORK` is Preprod
 * (the old Preprod), Preprod off. For each case: the answer, every credit row
 * of the fixture's payers in history order, the record's link, its audit
 * rows and the Cuso rows the refund touches, and the statements PostgreSQL
 * received, with each transaction's boundaries and isolation level.
 *
 * All of it is compared with `refund.base.json`, which this file wrote while
 * it ran on `origin/main`'s code:
 * RECORD_CREDIT_REFUND_BASE=true RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter core test src/lib/credits/refund.postgres.test.ts
 * Without `RECORD_CREDIT_REFUND_BASE` the same command compares. Each layout
 * has its own cases in the file.
 */
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { convertCreditsToCents } from "@sokosumi/utils";
import { Client, type Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { baseFile, plain, statements, thrown } from "@/test/spend-comparison";
import { onSplitLayout, testSchemaNames } from "@/test/split-layout";

const pools = vi.hoisted(() => [] as Pool[]);
const outside = vi.hoisted(() => ({
  /** The next refund waits for its release after it wrote its rows. */
  hold: undefined as
    | { reached: () => void; release: Promise<void> }
    | undefined,
  /** See the x402 comparison: the recorder instance every pool reports to. */
  observing: undefined as
    | typeof import("@/test/spend-comparison").observing
    | undefined,
}));
vi.mock("@vercel/functions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vercel/functions")>();
  const { observePool, observing } = await import("@/test/spend-comparison");
  outside.observing = observing;
  return {
    ...actual,
    attachDatabasePool: (pool: Pool) => {
      pools.push(pool);
      observePool(pool);
      actual.attachDatabasePool(pool);
    },
  };
});
vi.unmock("@/lib/db/prisma");
// The step every refund takes, on `origin/main` and now: a case makes the
// first one wait, inside its transaction, after its rows. No statement of its own.
vi.mock("@/helpers/compensating-refund", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/helpers/compensating-refund")>();
  return {
    ...actual,
    createCompensatingRefund: (async (tx, input) => {
      const id = await actual.createCompensatingRefund(tx, input);
      const held = outside.hold;
      if (held) {
        outside.hold = undefined;
        held.reached();
        await held.release;
      }
      return id;
    }) satisfies typeof actual.createCompensatingRefund,
  };
});

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

/** Reloads Core's modules: seconds on a loaded machine, past CI's 10 s hook limit. */
const SETUP_TIMEOUT = 60_000;
const CASE_TIMEOUT = 60_000;
const DAY = 86_400_000;
const CREDIT = convertCreditsToCents(1);
const LAYOUT = onSplitLayout ? "split layout" : "today's layout";

const base = baseFile(
  fileURLToPath(new URL("./refund.base.json", import.meta.url)),
  process.env.RECORD_CREDIT_REFUND_BASE === "true",
  // No debit is written: every statement is compared as recorded.
  { debitMoved: false },
);

/** Core's modules as a fresh start in this environment loads them. */
async function load(env: Record<string, string>) {
  delete (globalThis as { coreDatabase?: unknown }).coreDatabase;
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const fixture = await import("@/test-fixtures/core-session");
  const { default: prisma } = await import("@/lib/db/prisma");
  const { createNetworkScope } = await import("@/lib/db/network-scope");
  const { createPersonalWorkspace } = await import(
    "@/helpers/personal-workspace"
  );
  const { workspaceRepository } = await import(
    "@sokosumi/database/repositories"
  );
  const { CMO_SOKO_BOT_VERSION_IDS } = await import("@sokosumi/soko-bot");
  const { refundJob } = await import("@/services/job-refund");
  const { JOB_SYNC_TRANSACTION_OPTIONS } = await import(
    "@/services/job-sync-state.service"
  );
  const { refundFailedTaskPaymentClaim } = await import(
    "@/services/task-payment-claim.service"
  );
  const x402 = await import("@/services/task-x402-payment.refund");
  const { observing } = outside;
  if (!observing) throw new Error("No pool reports to a recorder");
  return {
    observing,
    fixture,
    prisma,
    createNetworkScope,
    createPersonalWorkspace,
    workspaceRepository,
    cusoVersionId: CMO_SOKO_BOT_VERSION_IDS[0],
    callers: {
      /** Job sync's refund phase: `syncRefundReconciliationJob`'s transaction. */
      job: (jobId: string) =>
        prisma.$transaction(
          (tx) => refundJob(jobId, tx),
          JOB_SYNC_TRANSACTION_OPTIONS,
        ),
      claim: (claimId: string) =>
        refundFailedTaskPaymentClaim(claimId, "fixture: permanently failed"),
      x402Refusal: (paymentId: string) =>
        x402.refundRefusedTaskX402Payment(
          paymentId,
          x402.TASK_X402_FAILURE_REASONS.NODE_REFUSED_OPERATIONAL,
        ),
      x402Refund: (paymentId: string, operatorId: string) =>
        x402.refundVerifiedTaskX402Payment({
          paymentId,
          operatorId,
          reason: "support_adjustment",
        }),
      x402Resolve: (paymentId: string, operatorId: string) =>
        x402.resolvePendingTaskX402Payment({
          paymentId,
          operatorId,
          reason: "node_unreachable",
        }),
    },
  };
}

type Loaded = Awaited<ReturnType<typeof load>>;

/** Whom a charge billed: a member, alone or of an Organization, with a Project. */
interface Payer {
  userId: string;
  organizationId: string | null;
  workspaceId: string;
  projectId: string;
}

/** A bucket's part of a charge. */
interface Part {
  bucket: string;
  cents: bigint;
}

type Kind = "job" | "claim" | "x402";

/**
 * People, Organizations, credits, charges and the records they paid for,
 * each row under a name, and every row they leave, removed by the ids it
 * made.
 */
function createWorld(loaded: Loaded) {
  const { prisma } = loaded;
  const mainnet = () => loaded.createNetworkScope("mainnet").networkDb;
  const labels = new Map<string, string>();
  const buckets = new Map<string, string>();
  const made = {
    userIds: [] as string[],
    organizationIds: [] as string[],
    workspaceIds: [] as string[],
    projectIds: [] as string[],
    sokoBotIds: [] as string[],
    taskIds: [] as string[],
    agentIds: [] as string[],
    pricingIds: [] as string[],
    jobIds: [] as string[],
    claimIds: [] as string[],
    paymentIds: [] as string[],
  };
  const name = (id: string, as: string) => {
    labels.set(id, as);
    return id;
  };
  const billedTo = () => ({
    OR: [
      { userId: { in: made.userIds } },
      { organizationId: { in: made.organizationIds } },
    ],
  });

  async function grant(
    as: string,
    owner: { userId: string } | { organizationId: string },
    cents: bigint,
    options: { expiresInDays?: number; projectId?: string } = {},
  ) {
    const created = await mainnet().transaction.create({
      data: {
        amount: cents,
        ...owner,
        sourceCreditBucket: {
          create: {
            amount: cents,
            ...owner,
            expiresAt: new Date(
              Date.now() + (options.expiresInDays ?? 30) * DAY,
            ),
            ...(options.projectId && { projectId: options.projectId }),
          },
        },
      },
      select: { id: true, sourceCreditBucket: { select: { id: true } } },
    });
    name(created.id, `<grant of ${as}>`);
    const bucketId = created.sourceCreditBucket?.id;
    if (!bucketId) throw new Error("No bucket created");
    buckets.set(as, name(bucketId, `<bucket ${as}>`));
  }

  async function project(workspaceId: string, as: string) {
    const { id } = await prisma.project.create({
      data: { workspaceId, name: `${as}'s Project` },
      select: { id: true },
    });
    made.projectIds.push(id);
    return name(id, `<${as}'s Project>`);
  }

  async function user(as: string) {
    const created = await loaded.fixture.createPasswordUser(as);
    made.userIds.push(created.id);
    name(created.id, `<${as}>`);
    name(created.email, `<${as}'s email>`);
    return created.id;
  }

  async function agent(as: string) {
    const ids = { agent: randomUUID(), pricing: randomUUID() };
    made.agentIds.push(ids.agent);
    made.pricingIds.push(ids.pricing);
    await mainnet().agent.create({
      data: {
        id: name(ids.agent, `<${as}>`),
        blockchainIdentifier: name(randomUUID(), `<${as}'s identifier>`),
        name: "Credit refund fixture",
        isShown: true,
        lastUptimeCheck: new Date(),
        uptimeCount: 1,
        uptimeCheckCount: 1,
        pricing: { create: { id: ids.pricing, pricingType: "UNKNOWN" } },
      },
    });
    return ids.agent;
  }

  return {
    labels,
    made,

    /** A person in their personal workspace, with a Project and two pool buckets. */
    async person(as: string): Promise<Payer> {
      const userId = await user(as);
      const workspace = await loaded.createPersonalWorkspace(userId);
      made.workspaceIds.push(workspace.id);
      name(workspace.id, `<${as}'s workspace>`);
      // The sign-up and free plan grants are other writers': the fixture's
      // own buckets replace them.
      await mainnet().creditBucket.deleteMany({ where: { userId } });
      await mainnet().transaction.deleteMany({ where: { userId } });
      await grant(`soon of ${as}`, { userId }, CREDIT, { expiresInDays: 2 });
      await grant(`later of ${as}`, { userId }, 3n * CREDIT);
      return {
        userId,
        organizationId: null,
        workspaceId: workspace.id,
        projectId: await project(workspace.id, as),
      };
    },

    /**
     * An Organization with one seated member and a Project with credits of
     * its own beside the pool. `cuso` gives the Project a Cuso: live, or
     * archived, which closes the Project's credits.
     */
    async organization(
      as: string,
      cuso: "live" | "archived" | "none",
    ): Promise<Payer> {
      const userId = await user(`${as}'s member`);
      const organizationId = name(`credit-refund-${randomUUID()}`, `<${as}>`);
      await prisma.organization.create({
        data: {
          id: organizationId,
          name: "Credit refund fixture",
          slug: organizationId,
          members: {
            create: { userId, role: "member", seatAssignedAt: new Date() },
          },
        },
      });
      made.organizationIds.push(organizationId);
      const workspace =
        await loaded.workspaceRepository.upsertOrganizationWorkspace({
          organizationId,
          tx: prisma,
        });
      made.workspaceIds.push(workspace.id);
      name(workspace.id, `<${as}'s workspace>`);
      const projectId = await project(workspace.id, as);
      if (cuso !== "none") {
        const bot = await prisma.sokoBot.create({
          data: {
            workspaceId: workspace.id,
            projectId,
            userId: null,
            createdByUserId: userId,
            versionId: loaded.cusoVersionId,
            name: "Cuso",
            ...(cuso === "archived" && { archivedAt: new Date() }),
          },
          select: { id: true },
        });
        made.sokoBotIds.push(name(bot.id, `<${as}'s Cuso>`));
      }
      const owner = { organizationId };
      await grant(`pool of ${as}`, owner, 3n * CREDIT);
      await grant(`Project of ${as}`, owner, CREDIT, { projectId });
      return { userId, organizationId, workspaceId: workspace.id, projectId };
    },

    /**
     * A charge as its payer's writer left it: a debit and one consumption
     * per part, in the order the buckets were chosen. `userId: null` is an
     * Organization pool charge with no member (ADR 0057).
     */
    async charge(
      as: string,
      payer: Payer,
      parts: readonly Part[],
      options: { userId?: null } = {},
    ) {
      const cents = parts.reduce((sum, part) => sum + part.cents, 0n);
      const { id } = await mainnet().transaction.create({
        data: {
          amount: -cents,
          userId: options.userId === null ? null : payer.userId,
          organizationId: payer.organizationId,
          creditConsumptions: {
            create: parts.map((part) => {
              const bucketId = buckets.get(part.bucket);
              if (!bucketId) throw new Error(`No bucket ${part.bucket}`);
              return { amount: part.cents, bucketId };
            }),
          },
        },
        select: { id: true },
      });
      return name(id, `<charge of ${as}>`);
    },

    /** Lets every bucket of the payer expire, as time passing would. */
    expire: (payer: Payer) =>
      mainnet().creditBucket.updateMany({
        where: payer.organizationId
          ? { organizationId: payer.organizationId }
          : { userId: payer.userId },
        data: { expiresAt: new Date(Date.now() - DAY) },
      }),

    /** The record a charge paid for, in the state its refund is due in. */
    async record(
      kind: Kind,
      as: string,
      payer: Payer,
      chargeId: string,
      x402Status: "PENDING" | "VERIFIED" = "PENDING",
    ): Promise<string> {
      const db = mainnet();
      if (kind === "claim") {
        const { id } = await db.taskPaymentClaim.create({
          data: {
            network: "Preprod",
            blockchainIdentifier: name(randomUUID(), `<${as}'s identifier>`),
            purchasePayload: { fixture: true },
            transactionId: chargeId,
            status: "PENDING",
            nextAttemptAt: new Date(0),
          },
          select: { id: true },
        });
        made.claimIds.push(id);
        return name(id, `<${as}>`);
      }
      const agentId = await agent(`${as}'s Agent`);
      if (kind === "job") {
        const { id } = await db.job.create({
          data: {
            agentId,
            agentJobId: name(randomUUID(), `<${as}'s agent job>`),
            jobType: "PAID",
            // A paid Job's purchase, which `paid_job_blockchain_required` asks for.
            blockchainIdentifier: name(randomUUID(), `<${as}'s purchase>`),
            identifierFromPurchaser: "aabbccddeeff00",
            sellerVkey: "cd".repeat(28),
            payByTime: new Date("2026-01-01T00:00:00.000Z"),
            submitResultTime: new Date("2026-01-01T01:00:00.000Z"),
            unlockTime: new Date("2026-01-01T02:00:00.000Z"),
            externalDisputeUnlockTime: new Date("2026-01-01T03:00:00.000Z"),
            workspaceId: payer.workspaceId,
            ownerId: payer.userId,
            organizationId: payer.organizationId,
            projectId: payer.projectId,
            transactionId: chargeId,
          },
          select: { id: true },
        });
        made.jobIds.push(id);
        return name(id, `<${as}>`);
      }
      const task = await prisma.task.create({
        data: {
          ownerId: payer.userId,
          creatorUserId: payer.userId,
          organizationId: payer.organizationId,
          workspaceId: payer.workspaceId,
          projectId: payer.projectId,
          name: "Credit refund fixture",
          status: "RUNNING",
        },
        select: { id: true },
      });
      made.taskIds.push(name(task.id, `<${as}'s Task>`));
      const { id } = await db.taskX402Payment.create({
        data: {
          idempotencyKey: name(randomUUID(), `<${as}'s key>`),
          caip2Network: "eip155:8453",
          asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          amount: "2000000",
          payTo: "0x1111111111111111111111111111111111111111",
          taskId: task.id,
          agentId,
          transactionId: chargeId,
          status: x402Status,
          signAttemptCount: 1,
          // Long past every sign lease and risk window: an operator may resolve it.
          processingAt: new Date(Date.now() - 7 * DAY),
        },
        select: { id: true },
      });
      made.paymentIds.push(id);
      return name(id, `<${as}>`);
    },

    /** Every row of the fixture: credits in history order, records, audit rows, Cusos. */
    async rows() {
      const db = mainnet();
      return {
        // The ledger's order, `(createdAt, id)`, as the history pages it.
        transactions: await db.transaction.findMany({
          where: billedTo(),
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
        buckets: await db.creditBucket.findMany({
          where: billedTo(),
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
        consumptions: await db.creditConsumption.findMany({
          where: { transaction: billedTo() },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
        jobs: await db.job.findMany({
          where: { id: { in: made.jobIds } },
          select: {
            id: true,
            transactionId: true,
            refundedTransactionId: true,
          },
        }),
        claims: await db.taskPaymentClaim.findMany({
          where: { id: { in: made.claimIds } },
        }),
        payments: await db.taskX402Payment.findMany({
          where: { id: { in: made.paymentIds } },
        }),
        paymentActions: await db.taskX402PaymentAction.findMany({
          where: { paymentId: { in: made.paymentIds } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
        cusos: await prisma.sokoBot.findMany({
          where: { id: { in: made.sokoBotIds } },
          select: { id: true, updatedAt: true, archivedAt: true },
        }),
      };
    },

    /** Every row the fixture caused. */
    async remove() {
      const db = mainnet();
      await db.taskX402PaymentAction.deleteMany({
        where: { paymentId: { in: made.paymentIds } },
      });
      await db.taskX402Payment.deleteMany({
        where: { id: { in: made.paymentIds } },
      });
      await prisma.task.deleteMany({ where: { id: { in: made.taskIds } } });
      await db.taskPaymentClaim.deleteMany({
        where: { id: { in: made.claimIds } },
      });
      await db.job.deleteMany({ where: { id: { in: made.jobIds } } });
      await db.agent.deleteMany({ where: { id: { in: made.agentIds } } });
      await db.agentPricing.deleteMany({
        where: { id: { in: made.pricingIds } },
      });
      await db.creditConsumption.deleteMany({
        where: { transaction: billedTo() },
      });
      await db.creditBucket.deleteMany({ where: billedTo() });
      await db.transaction.deleteMany({ where: billedTo() });
      await prisma.sokoBot.deleteMany({
        where: { id: { in: made.sokoBotIds } },
      });
      await prisma.project.deleteMany({
        where: { id: { in: made.projectIds } },
      });
      await prisma.workspace.deleteMany({
        where: { id: { in: made.workspaceIds } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: made.organizationIds } },
      });
      // The free plan `createPersonalWorkspace` grants is not tied to the user.
      await prisma.subscription.deleteMany({
        where: { referenceId: { in: made.userIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: made.userIds } } });
    },
  };
}

type World = ReturnType<typeof createWorld>;

/**
 * A Prisma error as a caller sees it, without the invocation's file and line,
 * which name this checkout: its class, code and message's last line.
 */
function failure(error: unknown) {
  const { code } = error as { code?: unknown };
  if (typeof code !== "string") return thrown(error);
  const { name, message } = error as Error;
  return { name, code, message: message.trim().split("\n").at(-1) };
}

/** Every credit row that is not the fixture's, by id: none may change. */
async function controlRows() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { DATABASE_SCHEMA_MAINNET: network } = testSchemaNames();
    const digest = async (table: string) =>
      (
        await client.query(
          `SELECT count(*)::text AS n, md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) AS digest FROM "${network}"."${table}" t`,
        )
      ).rows[0];
    return {
      transactions: await digest("Transaction"),
      buckets: await digest("credit_bucket"),
      consumptions: await digest("credit_consumption"),
    };
  } finally {
    await client.end();
  }
}

/**
 * Runs `act` and records what it answered and sent, and the rows after it.
 * Asserted on the raw rows first, before ids and times become names: a
 * refund's rows are UUID v7, written in the order the statements bound them,
 * and the ledger order of the new credit rows is their write order.
 */
async function observe(
  loaded: Loaded,
  world: World,
  act: () => Promise<unknown>,
) {
  const before = await world.rows();
  const { outcome, log } = await loaded.observing(async () => {
    try {
      return { answer: await act() };
    } catch (error) {
      return { threw: failure(error) };
    }
  });
  // Every refund reads its record first, its id bound: an observation
  // without that read recorded nothing, even while recording.
  const recordIds = [
    ...world.made.jobIds,
    ...world.made.claimIds,
    ...world.made.paymentIds,
  ];
  expect(
    log.filter(
      ({ text, values }) =>
        /^\s*(SELECT|UPDATE)/.test(text) &&
        values.some((value) => recordIds.includes(String(value))),
    ).length,
  ).toBeGreaterThan(0);
  const left = await world.rows();
  const sent = statements(log, { asSent: true });
  const known = new Set(before.transactions.map((row) => row.id));
  const written = left.transactions.filter((row) => !known.has(row.id));
  const insertOrder = sent.transactions
    .flat()
    .filter(({ sql }) => /^INSERT INTO "\w+"\."Transaction"/.test(sql))
    .map(({ values }) => values.find((value) => typeof value === "string"));
  // The rows written are the ones inserted, in the ledger in the order sent,
  // one creation time no earlier than the one before.
  expect(written.map((row) => row.id)).toEqual(
    insertOrder.filter((id) => written.some((row) => row.id === id)),
  );
  const times = written.map((row) => row.createdAt.getTime());
  expect(times).toEqual([...times].sort((a, b) => a - b));
  return plain(
    {
      outcome,
      statements: {
        transactions: sent.transactions,
        outsideTransactions: sent.outsideTransactions,
      },
      rows: left,
    },
    world.labels,
  );
}

/** Waits until another session waits for a lock this test's held refund holds. */
async function someoneWaitsForALock() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    for (let tries = 0; tries < 200; tries += 1) {
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
      );
      if ((rows[0] as { n: number }).n > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("The second refund never waited for the first");
  } finally {
    await client.end();
  }
}

afterAll(async () => {
  vi.unstubAllEnvs();
  await Promise.all(pools.map((pool) => pool.end()));
});

const CALLERS = [
  ["job", "a paid Job (Job sync)"],
  ["claim", "a Cardano Task payment claim"],
  ["x402", "a node-refused Task x402 payment"],
] as const;

describe.runIf(enabled).each(["Mainnet", "Preprod"] as const)(
  "the credit refunds on a deployment with NETWORK=%s, Preprod off, as on origin/main (PostgreSQL)",
  (deploymentNetwork) => {
    let loaded: Loaded;
    const key = (name: string) =>
      `${LAYOUT}, NETWORK=${deploymentNetwork}: ${name}`;

    let setup: Promise<void> | undefined;
    beforeAll(() => {
      setup = (async () => {
        loaded = await load({ NETWORK: deploymentNetwork });
      })();
      return setup;
    }, SETUP_TIMEOUT);
    afterAll(() => setup?.catch(() => undefined), SETUP_TIMEOUT);

    async function withWorld(run: (world: World) => Promise<void>) {
      const controls = await controlRows();
      const world = createWorld(loaded);
      try {
        await run(world);
      } finally {
        await world.remove();
      }
      // Removed by the ids it made: every other credit row is as it was.
      expect(await controlRows()).toEqual(controls);
    }

    function refundOf(kind: Kind, recordId: string) {
      const { callers } = loaded;
      if (kind === "job") return () => callers.job(recordId);
      if (kind === "claim") return () => callers.claim(recordId);
      return () => callers.x402Refusal(recordId);
    }

    describe.each(CALLERS)("%s: %s", (kind, caller) => {
      const name = (what: string) => key(`${caller}, ${what}`);

      it(
        "gives a personal charge back to the pool",
        () =>
          withWorld(async (world) => {
            const payer = await world.person("person");
            const chargeId = await world.charge("person", payer, [
              { bucket: "soon of person", cents: CREDIT },
              { bucket: "later of person", cents: CREDIT },
            ]);
            const id = await world.record(kind, "record", payer, chargeId);
            base.expectAsOnBase(
              name("a personal charge"),
              await observe(loaded, world, refundOf(kind, id)),
            );
          }),
        CASE_TIMEOUT,
      );

      it(
        "gives back a charge whose buckets have expired since, in a bucket that does not expire",
        () =>
          withWorld(async (world) => {
            const payer = await world.person("person");
            const chargeId = await world.charge("person", payer, [
              { bucket: "soon of person", cents: CREDIT },
              { bucket: "later of person", cents: CREDIT / 2n },
            ]);
            const id = await world.record(kind, "record", payer, chargeId);
            await world.expire(payer);
            base.expectAsOnBase(
              name("after the buckets expired"),
              await observe(loaded, world, refundOf(kind, id)),
            );
          }),
        CASE_TIMEOUT,
      );

      for (const cuso of ["live", "archived", "none"] as const) {
        it(
          `splits an Organization charge between its Project (${cuso} Cuso) and the pool`,
          () =>
            withWorld(async (world) => {
              const payer = await world.organization("Organization", cuso);
              // The Project's credits first, then the pool, as a spend chooses.
              const chargeId = await world.charge("Organization", payer, [
                { bucket: "Project of Organization", cents: CREDIT / 2n },
                { bucket: "pool of Organization", cents: CREDIT },
              ]);
              const id = await world.record(kind, "record", payer, chargeId);
              base.expectAsOnBase(
                name(`an Organization charge, Project and pool, ${cuso} Cuso`),
                await observe(loaded, world, refundOf(kind, id)),
              );
            }),
          CASE_TIMEOUT,
        );
      }

      it(
        "refunds once when asked twice",
        () =>
          withWorld(async (world) => {
            const payer = await world.organization("Organization", "live");
            const chargeId = await world.charge("Organization", payer, [
              { bucket: "Project of Organization", cents: CREDIT / 2n },
              { bucket: "pool of Organization", cents: CREDIT },
            ]);
            const id = await world.record(kind, "record", payer, chargeId);
            const first = await observe(loaded, world, refundOf(kind, id));
            const second = await observe(loaded, world, refundOf(kind, id));
            base.expectAsOnBase(name("asked twice, first"), first);
            base.expectAsOnBase(name("asked twice, second"), second);
          }),
        CASE_TIMEOUT,
      );

      it(
        "refunds once when asked twice at once",
        () =>
          withWorld(async (world) => {
            const payer = await world.organization("Organization", "live");
            const chargeId = await world.charge("Organization", payer, [
              { bucket: "Project of Organization", cents: CREDIT / 2n },
              { bucket: "pool of Organization", cents: CREDIT },
            ]);
            const id = await world.record(kind, "record", payer, chargeId);
            let reached = () => {};
            let release = () => {};
            const atHold = new Promise<void>((resolve) => {
              reached = resolve;
            });
            outside.hold = {
              reached,
              release: new Promise<void>((resolve) => {
                release = resolve;
              }),
            };
            const refund = refundOf(kind, id);
            const observed = await observe(loaded, world, async () => {
              // The first holds its rows, uncommitted; the second starts
              // and waits for them; then the first commits.
              const first = refund().then(
                (answer) => ({ answer }),
                (error: unknown) => ({ threw: failure(error) }),
              );
              const stopped = await Promise.race([
                atHold.then(() => false),
                first.then(() => true),
              ]);
              if (stopped) {
                // Stopped before its rows: nothing to wait for.
                outside.hold = undefined;
                const second = await refund().then(
                  (answer) => ({ answer }),
                  (error: unknown) => ({ threw: failure(error) }),
                );
                return { first: await first, second };
              }
              const second = refund().then(
                (answer) => ({ answer }),
                (error: unknown) => ({ threw: failure(error) }),
              );
              await someoneWaitsForALock();
              release();
              return { first: await first, second: await second };
            });
            base.expectAsOnBase(name("asked twice at once"), observed);
          }),
        CASE_TIMEOUT,
      );

      it(
        "refuses an Organization pool charge with no member",
        () =>
          withWorld(async (world) => {
            const payer = await world.organization("Organization", "none");
            const chargeId = await world.charge(
              "Organization",
              payer,
              [{ bucket: "pool of Organization", cents: CREDIT }],
              { userId: null },
            );
            const id = await world.record(kind, "record", payer, chargeId);
            base.expectAsOnBase(
              name("a pool charge with no member"),
              await observe(loaded, world, refundOf(kind, id)),
            );
          }),
        CASE_TIMEOUT,
      );

      it(
        "answers a charge of zero as it does",
        () =>
          withWorld(async (world) => {
            const payer = await world.person("person");
            const chargeId = await world.charge("person", payer, []);
            const id = await world.record(kind, "record", payer, chargeId);
            base.expectAsOnBase(
              name("a charge of zero"),
              await observe(loaded, world, refundOf(kind, id)),
            );
          }),
        CASE_TIMEOUT,
      );
    });

    describe.each([
      [
        "x402Refund",
        "VERIFIED",
        "an operator's goodwill refund of a Task x402 payment",
      ],
      [
        "x402Resolve",
        "PENDING",
        "an operator's resolve of a pending Task x402 payment",
      ],
    ] as const)("%s: %s", (lever, status, caller) => {
      it(
        "splits an Organization charge between its Project and the pool, and refunds once when asked twice",
        () =>
          withWorld(async (world) => {
            const payer = await world.organization("Organization", "archived");
            const chargeId = await world.charge("Organization", payer, [
              { bucket: "Project of Organization", cents: CREDIT / 2n },
              { bucket: "pool of Organization", cents: CREDIT },
            ]);
            const id = await world.record(
              "x402",
              "record",
              payer,
              chargeId,
              status,
            );
            const act = () => loaded.callers[lever](id, payer.userId);
            const first = await observe(loaded, world, act);
            const second = await observe(loaded, world, act);
            base.expectAsOnBase(key(`${caller}, first`), first);
            base.expectAsOnBase(key(`${caller}, asked again`), second);
          }),
        CASE_TIMEOUT,
      );
    });
  },
);
