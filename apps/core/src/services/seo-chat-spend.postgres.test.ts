/**
 * The charge of an SEO chat reply, on a real PostgreSQL at the chat's own
 * entry point (`sendSeoChat`): what it answers, how often it asks the model,
 * every credit row and chat turn, and the statements PostgreSQL received,
 * with each transaction's boundaries and isolation level.
 *
 * All of it is compared with `seo-chat-spend.base.json`, which this file
 * wrote while it ran on `origin/main`'s code, before the charge moved into
 * the credits module:
 * RECORD_SEO_CHAT_SPEND_BASE=true RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter core test src/services/seo-chat-spend.postgres.test.ts
 * Without `RECORD_SEO_CHAT_SPEND_BASE` the same command compares.
 *
 * It needs the database to itself, as CI gives each worker its own
 * (`POSTGRES_TEST_DATABASE_PER_WORKER`): another file's Serializable
 * transaction on the same database can make a charge retry, and a retry is
 * a second transaction in the statements.
 *
 * On the split layout a reply stops in its reservation, before any charge:
 * `sendSeoChat` reads the turn's debit through the shared client.
 * `origin/main` stops at the same statement, with the same rows.
 */
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client, type Pool } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";

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

import { creditBucketRepository } from "@sokosumi/database/repositories";

import { createPersonalWorkspace } from "@/helpers/personal-workspace";
import { createNetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import type { SeoActor } from "@/schemas/project-seo.schema";
import { createSeoAudit } from "@/services/seo-audit.service";
import { sendSeoChat } from "@/services/seo-chat.service";
import { sokoBotUsageCents } from "@/services/soko-bot-billing.service";
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

const modelReply = {
  text: JSON.stringify({ reply: "Review this page.", actions: [] }),
  costUsd: 0.001234,
  usage: { inputTokens: 123, outputTokens: 45, costUsd: 0.001234 },
};
/** What one reply of `modelReply` costs, and a reply the model ran for free. */
const PRICE = sokoBotUsageCents(1_234n, true);
const MINIMUM = sokoBotUsageCents(0n, true);

const { expectAsOnBase } = baseFile(
  fileURLToPath(new URL("./seo-chat-spend.base.json", import.meta.url)),
  process.env.RECORD_SEO_CHAT_SPEND_BASE === "true",
);

const mainnet = () => createNetworkScope("mainnet").networkDb;

/** Random values in a statement or a row, each under a name. */
const labels = new Map<string, string>();
const userIds: string[] = [];
const organizationIds: string[] = [];
const workspaceIds: string[] = [];
const auditIds: string[] = [];
const projectIds: string[] = [];

interface Payer {
  actor: SeoActor;
  billedTo: { userId: string } | { organizationId: string };
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
  bucket: { cents: bigint; expiresInDays: number; projectId?: string },
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

async function audit(
  workspace: {
    userId: string;
    organizationId: string | null;
    workspaceId: string;
  },
  name: string,
): Promise<SeoActor> {
  const created = await createSeoAudit(workspace, {
    name,
    firstPage: {
      url: `https://example.test/${auditIds.length}`,
      relationship: "primary",
    },
  });
  if (!created.auditId) throw new Error("Missing fixture audit");
  auditIds.push(created.auditId);
  labels.set(created.auditId, `<${name}>`);
  return { ...workspace, owner: { kind: "audit", id: created.auditId } };
}

/**
 * A person in the personal workspace the product creates, with their own
 * buckets in place of the sign-up and free-plan grants, which other writers
 * make and which cannot write on the split layout yet.
 */
async function person(
  name: string,
  buckets: Array<{ name: string; cents: bigint; expiresInDays: number }>,
): Promise<Payer & { bucketIds: string[] }> {
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
    actor: await audit(
      { userId, organizationId: null, workspaceId: workspace.id },
      `${name}'s audit`,
    ),
    billedTo: { userId },
    bucketIds,
  };
}

/**
 * A seated member of an Organization whose audit belongs to a Project with
 * Project credits beside the pool: the Project's credits pay first, then the
 * pool, soonest expiry first.
 */
async function organizationMember(name: string): Promise<Payer> {
  const userId = await createUser(`${name}'s member`);
  const organizationId = randomUUID();
  const workspaceId = randomUUID();
  await prisma.organization.create({
    data: {
      id: organizationId,
      name: "SEO chat spend fixture",
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
  const actor = await audit(
    { userId, organizationId, workspaceId },
    `${name}'s audit`,
  );
  const project = await prisma.project.create({
    data: { workspaceId, name: "SEO chat spend Project" },
    select: { id: true },
  });
  projectIds.push(project.id);
  labels.set(project.id, `<${name}'s Project>`);
  await prisma.seoAudit.update({
    where: { id: actor.owner.id },
    data: { projectId: project.id },
  });
  const owner = { organizationId };
  // Granted latest-expiring first: the spend order is not the creation order.
  await grant(`pool later of ${name}`, owner, {
    cents: PRICE,
    expiresInDays: 20,
  });
  await grant(`pool soon of ${name}`, owner, {
    cents: PRICE / 2n,
    expiresInDays: 5,
  });
  await grant(`Project credits of ${name}`, owner, {
    cents: PRICE / 4n,
    expiresInDays: 40,
    projectId: project.id,
  });
  return { actor, billedTo: owner };
}

/** Every credit row of the payer and every chat turn of its audits. */
async function rows(payer: Payer, audits: string[]) {
  const db = mainnet();
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
    consumptions: await db.creditConsumption.findMany({
      where: { transaction: payer.billedTo },
      orderBy: [{ transactionId: "asc" }, { bucket: { expiresAt: "asc" } }],
    }),
    turns: await prisma.seoAuditChatTurn.findMany({
      where: { auditId: { in: audits } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  };
}

/**
 * One observed call: its answer, how often the model was asked, the
 * statements it sent, and the rows it left.
 */
async function observe(
  payer: Payer,
  audits: string[],
  generate: { mock: { calls: unknown[] } },
  call: () => Promise<unknown>,
) {
  const asked = generate.mock.calls.length;
  const started = await nextMillisecond();
  const { outcome, log } = await observing(call);
  const ended = Date.now();
  const left = await rows(payer, audits);
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
  return plain(
    {
      result: outcome,
      modelCalls: generate.mock.calls.length - asked,
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

/** A request whose hash is the same on every run. */
const request = (key: string) => ({
  question: "What should I check?",
  idempotencyKey: `seo-chat-spend-${key}`,
});

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

/**
 * True once a connection of this database waits for a row lock. Asked on a
 * connection of its own, outside Core's pool, so it adds no statement to
 * what is compared.
 */
async function untilALockIsAwaited(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const waiting = await client.query<{ count: string }>(
        `SELECT count(*) FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock'`,
      );
      if (waiting.rows[0]?.count !== "0") return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("No connection waited for a lock");
  } finally {
    await client.end();
  }
}

/**
 * Two replies of one person, in two audits of the same workspace, both
 * through inference, for credits that pay one. The `first` settlement to
 * start holds its transaction open after it has chosen its buckets, until
 * the other one waits inside its own transaction for the rows it holds.
 */
async function race(name: string, first: 0 | 1) {
  const payer = await person(name, [
    { name: "only bucket", cents: PRICE, expiresInDays: 20 },
  ]);
  const other = await audit(
    {
      userId: payer.actor.userId,
      organizationId: null,
      workspaceId: payer.actor.workspaceId,
    },
    `${name}'s second audit`,
  );
  const actors = [payer.actor, other];
  const entered = [gate(), gate()] as const;
  const answer = [gate(), gate()] as const;
  let asked = 0;
  const generate = vi.fn(async () => {
    const call = asked;
    asked += 1;
    entered[call]?.open();
    await answer[call]?.opened;
    return modelReply;
  });
  const chosen = gate();
  const holdOpen = gate();
  const prepare = creditBucketRepository.prepareConsumption;
  let prepared = 0;
  const spy = vi
    .spyOn(creditBucketRepository, "prepareConsumption")
    .mockImplementation(async (...args) => {
      const consumptions = await prepare(...args);
      prepared += 1;
      if (prepared === 1) {
        chosen.open();
        await holdOpen.opened;
      }
      return consumptions;
    });
  let outcomes: Promise<unknown> = Promise.resolve();
  try {
    const observed = (await observe(
      payer,
      auditIds.slice(-2),
      generate,
      async () => {
        const replies = actors.map(async (actor, index) => {
          // The second reservation starts after the first has its turn.
          if (index === 1) await entered[0]?.opened;
          return sendSeoChat(actor, request(`${name}-${index}`), { generate });
        });
        // Handled from the start: a reply that fails before it reaches the
        // model, as on the split layout, ends every wait below at once.
        outcomes = Promise.allSettled(replies);
        const failedEarly = new Promise<never>((_resolve, reject) => {
          for (const reply of replies) reply.catch(reject);
        });
        failedEarly.catch(() => undefined);
        const until = (step: Promise<unknown>) =>
          Promise.race([step, failedEarly]);
        await until(entered[1].opened);
        answer[first].open();
        await until(chosen.opened);
        answer[first === 0 ? 1 : 0].open();
        await until(untilALockIsAwaited());
        holdOpen.open();
        return (await Promise.allSettled(replies)).map(settled);
      },
    )) as { result: unknown };
    if (!Array.isArray(observed.result))
      throw new Error(
        `The race stopped before both replies settled: ${JSON.stringify(observed.result)}`,
      );
    return observed;
  } finally {
    for (const opened of [...entered, ...answer, chosen, holdOpen])
      opened.open();
    await outcomes;
    spy.mockRestore();
  }
}

const BUCKET_READ = /^WITH bucket_avail AS \(/;
const TURN_CLAIM =
  /^UPDATE "public"\."seo_audit_chat_turn" SET "status" = \$1, "response"/;

/**
 * Where PostgreSQL cancels the loser's first attempt is its own choice, the
 * same on `origin/main` and here: at its turn update ("identification as a
 * pivot, during write") or, one statement later, at its bucket read
 * ("conflict out to pivot, during read"). Measured on both codes with the
 * same statements: on a fresh database the read, on one that earlier runs
 * have filled the write; it follows the database's state, not the code. So this
 * attempt is compared up to its turn update and its ROLLBACK, on both sides,
 * and a bucket read it reached must equal its retry's; the base file keeps
 * the attempt as it ran. The retry, the answer and every row are compared
 * whole. The transactions
 * in order: two reservations, the winner's settlement, the loser's two
 * attempts.
 */
function withoutTheLosersCancelPoint(
  transactions: Statement[][],
): Statement[][] {
  const [first, second, winner, attempt, retry, ...more] = transactions;
  if (!first || !second || !winner || !attempt || !retry || more.length > 0)
    throw new Error("The race is not two reservations and three settlements");
  const read = attempt.at(-2);
  let cancelled = attempt;
  if (read && BUCKET_READ.test(read.sql)) {
    // The read it was cancelled at is the one its retry makes, whole.
    expect(read).toEqual(retry.find(({ sql }) => BUCKET_READ.test(sql)));
    cancelled = [...attempt.slice(0, -2), ...attempt.slice(-1)];
  }
  expect([
    TURN_CLAIM.test(cancelled.at(-2)?.sql ?? ""),
    cancelled.at(-1)?.sql,
  ]).toEqual([true, "ROLLBACK"]);
  return [first, second, winner, cancelled, retry];
}

describe.skipIf(!enabled)(
  "an SEO chat reply's charge, as on origin/main (PostgreSQL)",
  () => {
    afterAll(async () => {
      await prisma.seoAuditChatTurn.deleteMany({
        where: { auditId: { in: auditIds } },
      });
      await prisma.seoAudit.deleteMany({ where: { id: { in: auditIds } } });
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
    }, CASE_TIMEOUT);

    it(
      "charges a person's reply to their credits, soonest expiry first",
      async () => {
        const payer = await person("funded person", [
          { name: "expiring later", cents: PRICE, expiresInDays: 20 },
          { name: "expiring first", cents: PRICE / 2n, expiresInDays: 1 },
        ]);
        const generate = vi.fn(async () => modelReply);

        expectAsOnBase(
          "a person, funded",
          await observe(payer, [payer.actor.owner.id], generate, () =>
            sendSeoChat(payer.actor, request("funded"), { generate }),
          ),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "charges a member's reply to its Project's credits, then the pool",
      async () => {
        const payer = await organizationMember("funded Organization");
        const generate = vi.fn(async () => modelReply);

        expectAsOnBase(
          "an Organization member, funded",
          await observe(payer, [payer.actor.owner.id], generate, () =>
            sendSeoChat(payer.actor, request("organization"), { generate }),
          ),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "charges the minimum for a reply the model priced at zero",
      async () => {
        const payer = await person("free reply person", [
          { name: "expiring later", cents: MINIMUM * 2n, expiresInDays: 20 },
          { name: "expiring first", cents: MINIMUM / 2n, expiresInDays: 1 },
        ]);
        const generate = vi.fn(async () => ({ ...modelReply, costUsd: 0 }));

        expectAsOnBase(
          "a person, a reply priced at zero",
          await observe(payer, [payer.actor.owner.id], generate, () =>
            sendSeoChat(payer.actor, request("minimum"), { generate }),
          ),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "answers a repeated request with its reply, without asking or charging again",
      async () => {
        const payer = await person("replaying person", [
          { name: "only bucket", cents: PRICE * 3n, expiresInDays: 20 },
        ]);
        const generate = vi.fn(async () => modelReply);
        await sendSeoChat(payer.actor, request("replay"), { generate });

        expectAsOnBase(
          "a person, a repeated request",
          await observe(payer, [payer.actor.owner.id], generate, () =>
            sendSeoChat(payer.actor, request("replay"), { generate }),
          ),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "refuses the reply and keeps no debit when the credits go during inference",
      async () => {
        const payer = await person("drained person", [
          { name: "only bucket", cents: PRICE, expiresInDays: 20 },
        ]);
        const [bucketId] = payer.bucketIds;
        const generate = vi.fn(async () => {
          await mainnet().creditBucket.update({
            where: { id: bucketId },
            data: { amount: 0n },
          });
          return modelReply;
        });

        expectAsOnBase(
          "a person, credits gone during inference",
          await observe(payer, [payer.actor.owner.id], generate, () =>
            sendSeoChat(payer.actor, request("drained"), { generate }),
          ),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "charges one of two replies racing for the same credits, the first to settle",
      async () => {
        expectAsOnBase(
          "a person, two replies race, the first reserved settles first",
          await race("first wins", 0),
          withoutTheLosersCancelPoint,
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "charges one of two replies racing for the same credits, the second to reserve",
      async () => {
        expectAsOnBase(
          "a person, two replies race, the second reserved settles first",
          await race("second wins", 1),
          withoutTheLosersCancelPoint,
        );
      },
      CASE_TIMEOUT,
    );
  },
);
