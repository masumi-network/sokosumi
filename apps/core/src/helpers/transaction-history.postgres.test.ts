/**
 * Real-Postgres proof for the Transactions ledger query.
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *     pnpm --filter core test src/helpers/transaction-history.postgres.test.ts
 *
 * Runs against the migrated schema rather than a stand-in, so a column rename
 * under the query fails here instead of in production. Every fixture is written
 * inside a transaction that always rolls back.
 */
import { createPrismaClient } from "@sokosumi/database/client";
import { afterAll, describe, expect, it } from "vitest";

import {
  type BuildTransactionHistoryParams,
  countTransactionHistory,
  findTransactionHistoryPage,
  mapTransactionHistoryRow,
} from "./transaction-history";

const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");
const db = enabled && url ? createPrismaClient(url) : null;

afterAll(async () => {
  await db?.$disconnect();
});

const USER_ID = "txhist-user";
const OTHER_USER_ID = "txhist-other-user";
const ORGANIZATION_ID = "txhist-org";
const WORKSPACE_ID = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const ORGANIZATION_WORKSPACE_ID = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
const PROJECT_ID = "dddddddd-dddd-4ddd-8ddd-ddddddddddd3";
const IMAGE_JOB_ID = "dddddddd-dddd-4ddd-8ddd-ddddddddddd4";
const SOKO_BOT_ID = "dddddddd-dddd-4ddd-8ddd-ddddddddddd5";
const VENDOR_ID = "dddddddd-dddd-4ddd-8ddd-ddddddddddd6";

/** 10^10 ledger units are one credit. */
const CREDIT = 10_000_000_000n;

const personalScope = {
  scope: "owned",
  userContext: { source: "context", userId: USER_ID, organizationId: null },
  workspaceContext: {
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    organizationId: null,
  },
} satisfies BuildTransactionHistoryParams;

type Tx = Parameters<Parameters<NonNullable<typeof db>["$transaction"]>[0]>[0];

async function seed(tx: Tx): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
    VALUES
      (${USER_ID}, 'Ledger User', 'ledger@example.test', true, NOW(), NOW()),
      (${OTHER_USER_ID}, 'Other User', 'ledger-other@example.test', true, NOW(), NOW())
  `;
  await tx.$executeRaw`
    INSERT INTO "organization" ("id", "name", "slug", "createdAt")
    VALUES (${ORGANIZATION_ID}, 'Ledger Org', 'ledger-org', NOW())
  `;
  await tx.$executeRaw`
    INSERT INTO "workspace" ("id", "createdAt", "updatedAt", "userId", "organizationId")
    VALUES
      (${WORKSPACE_ID}::uuid, NOW(), NOW(), ${USER_ID}, NULL),
      (${ORGANIZATION_WORKSPACE_ID}::uuid, NOW(), NOW(), NULL, ${ORGANIZATION_ID})
  `;
  await tx.$executeRaw`
    INSERT INTO "project" ("id", "createdAt", "updatedAt", "workspaceId", "name")
    VALUES (${PROJECT_ID}::uuid, NOW(), NOW(), ${WORKSPACE_ID}::uuid, 'Ledger project')
  `;
  await tx.$executeRaw`
    INSERT INTO "AgentPricing" ("id", "createdAt", "updatedAt", "pricingType")
    VALUES ('txhist-pricing', NOW(), NOW(), 'FREE'::"PricingType")
  `;
  await tx.$executeRaw`
    INSERT INTO "Agent" (
      "id", "createdAt", "updatedAt", "blockchainIdentifier", "name", "apiBaseUrl",
      "lastUptimeCheck", "uptimeCount", "uptimeCheckCount", "pricingId", "isShown"
    )
    VALUES (
      'txhist-agent', NOW(), NOW(), 'txhist-agent-chain', 'Research Agent',
      'https://example.test/agent', NOW(), 1, 1, 'txhist-pricing', true
    )
  `;
  await tx.$executeRaw`
    INSERT INTO "vendor" ("id", "createdAt", "updatedAt", "name", "slug")
    VALUES (${VENDOR_ID}::uuid, NOW(), NOW(), 'Ledger Vendor', 'ledger-vendor')
  `;
  await tx.$executeRaw`
    INSERT INTO "coworker" ("id", "createdAt", "updatedAt", "slug", "name", "vendorId")
    VALUES ('txhist-coworker', NOW(), NOW(), 'ledger-coworker', 'Ledger Coworker', ${VENDOR_ID}::uuid)
  `;
  await tx.$executeRaw`
    INSERT INTO "soko_bot" ("id", "createdAt", "updatedAt", "userId", "workspaceId")
    VALUES (${SOKO_BOT_ID}::uuid, NOW(), NOW(), ${USER_ID}, ${WORKSPACE_ID}::uuid)
  `;

  // One ledger row per consumption, plus a topup and an organization spend
  // that must not reach this workspace's list.
  await tx.$executeRaw`
    INSERT INTO "Transaction" ("id", "createdAt", "updatedAt", "amount", "userId", "organizationId")
    VALUES
      ('tx-sokobot', TIMESTAMP '2026-01-15 10:00:00', NOW(), ${-1n * CREDIT}, ${USER_ID}, NULL),
      ('tx-image',   TIMESTAMP '2026-02-01 10:00:00', NOW(), ${-8n * CREDIT}, ${USER_ID}, NULL),
      ('tx-job',     TIMESTAMP '2026-03-01 10:00:00', NOW(), ${-3n * CREDIT}, ${USER_ID}, NULL),
      ('tx-task',    TIMESTAMP '2026-04-01 10:00:00', NOW(), ${-2n * CREDIT}, ${USER_ID}, NULL),
      ('tx-coworker',TIMESTAMP '2026-05-01 10:00:00', NOW(), ${-5n * CREDIT}, ${USER_ID}, NULL),
      ('tx-unattr',  TIMESTAMP '2026-06-01 10:00:00', NOW(), ${-7n * CREDIT}, ${USER_ID}, NULL),
      ('tx-topup',   TIMESTAMP '2026-07-01 10:00:00', NOW(), ${100n * CREDIT}, ${USER_ID}, NULL),
      ('tx-org',     TIMESTAMP '2026-07-15 10:00:00', NOW(), ${-9n * CREDIT}, ${OTHER_USER_ID}, ${ORGANIZATION_ID})
  `;

  // A charged job is PAID by construction: `free_job_no_blockchain` forbids a
  // FREE job from carrying a transaction at all.
  await tx.$executeRaw`
    INSERT INTO "Job" (
      "id", "createdAt", "updatedAt", "ownerId", "agentId", "agentJobId",
      "jobType", "workspaceId", "projectId", "name", "transactionId",
      "blockchainIdentifier", "payByTime", "submitResultTime", "unlockTime",
      "externalDisputeUnlockTime", "sellerVkey", "identifierFromPurchaser"
    )
    VALUES (
      'txhist-job', TIMESTAMP '2026-03-01 09:00:00', NOW(), ${USER_ID}, 'txhist-agent',
      'txhist-remote', 'PAID'::"JobType", ${WORKSPACE_ID}::uuid, ${PROJECT_ID}::uuid,
      'Research competitors', 'tx-job',
      'txhist-chain', NOW(), NOW(), NOW(), NOW(), 'txhist-vkey', 'txhist-purchaser'
    )
  `;
  await tx.$executeRaw`
    INSERT INTO "project_image_job" (
      "id", "createdAt", "updatedAt", "projectId", "workspaceId", "requestedByUserId",
      "kind", "model", "prompt", "settings", "idempotencyKey", "transactionId"
    )
    VALUES (
      ${IMAGE_JOB_ID}::uuid, TIMESTAMP '2026-02-01 09:00:00', NOW(), ${PROJECT_ID}::uuid,
      ${WORKSPACE_ID}::uuid, ${USER_ID}, 'GENERATE'::"ProjectImageJobKind",
      'fal-ai/some-model', 'A bold event poster', '{}'::jsonb, 'txhist-image-key', 'tx-image'
    )
  `;
  await tx.$executeRaw`
    INSERT INTO "task" (
      "id", "createdAt", "updatedAt", "ownerId", "creatorUserId", "name",
      "description", "status", "workspaceId", "projectId"
    )
    VALUES (
      'txhist-task', TIMESTAMP '2026-04-01 09:00:00', NOW(), ${USER_ID}, ${USER_ID},
      'Summarise the report', 'x', 'COMPLETED', ${WORKSPACE_ID}::uuid, ${PROJECT_ID}::uuid
    )
  `;
  // The charging event pays for the task; the second one is ordinary activity
  // and must never reach a credit ledger.
  await tx.$executeRaw`
    INSERT INTO "taskEvent" ("id", "createdAt", "updatedAt", "taskId", "comment", "transactionId")
    VALUES
      ('txhist-event-paid', TIMESTAMP '2026-04-01 10:00:00', NOW(), 'txhist-task', 'Agent run', 'tx-task'),
      ('txhist-event-free', TIMESTAMP '2026-04-02 10:00:00', NOW(), 'txhist-task', 'Just a comment', NULL)
  `;
  await tx.$executeRaw`
    INSERT INTO "coworker_usage" (
      "id", "createdAt", "updatedAt", "idempotencyKey", "coworkerId", "userId", "cents", "transactionId"
    )
    VALUES (
      'txhist-cw-usage', TIMESTAMP '2026-05-01 10:00:00', NOW(), 'txhist-cw-key',
      'txhist-coworker', ${USER_ID}, ${5n * CREDIT}, 'tx-coworker'
    )
  `;
  await tx.$executeRaw`
    INSERT INTO "soko_bot_usage" (
      "id", "createdAt", "updatedAt", "idempotencyKey", "sokoBotId", "userId", "cents", "transactionId"
    )
    VALUES (
      gen_random_uuid(), TIMESTAMP '2026-01-15 10:00:00', NOW(), 'txhist-sb-key',
      ${SOKO_BOT_ID}::uuid, ${USER_ID}, ${1n * CREDIT}, 'tx-sokobot'
    )
  `;
  // The unattributed spend has no entity relation at all. The bucket it drew
  // from is the only source signal that survives.
  await tx.$executeRaw`
    INSERT INTO "credit_bucket" (
      "id", "createdAt", "updatedAt", "amount", "sourceTransactionId", "userId", "referenceType"
    )
    VALUES (
      'txhist-bucket', NOW(), NOW(), ${100n * CREDIT}, 'tx-topup', ${USER_ID},
      'STRIPE_SUBSCRIPTION_PERIOD'::"CreditBucketReferenceType"
    )
  `;
  await tx.$executeRaw`
    INSERT INTO "credit_consumption" ("id", "createdAt", "amount", "bucketId", "transactionId")
    VALUES ('txhist-consumption', NOW(), ${7n * CREDIT}, 'txhist-bucket', 'tx-unattr')
  `;
}

/** Runs `body` against a seeded database and always rolls the fixtures back. */
async function withSeededLedger(
  body: (tx: Tx) => Promise<void>,
): Promise<void> {
  if (!db) throw new Error("Missing integration database");

  const rollback = new Error("Rollback ledger fixtures");
  try {
    await db.$transaction(
      async (tx) => {
        await seed(tx);
        await body(tx);
        throw rollback;
      },
      { timeout: 30_000 },
    );
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

/** A refund top up: its transaction plus the `REFUND` bucket it created. */
async function seedRefundTransaction(tx: Tx, id: string): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "Transaction" ("id", "createdAt", "updatedAt", "amount", "userId", "organizationId")
    VALUES (${id}, TIMESTAMP '2026-08-01 10:00:00', NOW(), ${4n * CREDIT}, ${USER_ID}, NULL)
  `;
  await tx.$executeRaw`
    INSERT INTO "credit_bucket" (
      "id", "createdAt", "updatedAt", "amount", "sourceTransactionId", "userId", "referenceType"
    )
    VALUES (
      ${`${id}-bucket`}, NOW(), NOW(), ${4n * CREDIT}, ${id}, ${USER_ID},
      'REFUND'::"CreditBucketReferenceType"
    )
  `;
}

/** The debit a task payment charged before it was refunded. */
async function seedChargeTransaction(tx: Tx, id: string): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "Transaction" ("id", "createdAt", "updatedAt", "amount", "userId", "organizationId")
    VALUES (${id}, TIMESTAMP '2026-07-31 10:00:00', NOW(), ${-4n * CREDIT}, ${USER_ID}, NULL)
  `;
}

/** A job that points back to the refund it received, with or without a purchase. */
async function seedRefundedJob(
  tx: Tx,
  refundId: string,
  onChainStatus: "REFUND_WITHDRAWN" | "FUNDS_OR_DATUM_INVALID" | null,
): Promise<void> {
  // A paid job always carries the debit it was refunded for.
  await seedChargeTransaction(tx, `${refundId}-charge`);
  await tx.$executeRaw`
    INSERT INTO "Job" (
      "id", "createdAt", "updatedAt", "ownerId", "agentId", "agentJobId",
      "jobType", "workspaceId", "name", "transactionId", "refundedTransactionId",
      "blockchainIdentifier", "payByTime", "submitResultTime", "unlockTime",
      "externalDisputeUnlockTime", "sellerVkey", "identifierFromPurchaser"
    )
    VALUES (
      ${`${refundId}-job`}, TIMESTAMP '2026-07-31 09:00:00', NOW(), ${USER_ID}, 'txhist-agent',
      'txhist-refund-remote', 'PAID'::"JobType", ${WORKSPACE_ID}::uuid, 'Audit the contract',
      ${`${refundId}-charge`}, ${refundId}, ${`${refundId}-chain`}, NOW(), NOW(), NOW(), NOW(), 'txhist-vkey', 'txhist-purchaser'
    )
  `;

  if (onChainStatus) {
    await tx.$executeRaw`
      INSERT INTO "jobPurchase" ("id", "createdAt", "updatedAt", "externalId", "jobId", "onChainStatus")
      VALUES (
        ${`${refundId}-purchase`}, NOW(), NOW(), ${`${refundId}-external`},
        ${`${refundId}-job`}, ${onChainStatus}::"OnChainJobStatus"
      )
    `;
  }
}

async function seedRefundedTask(tx: Tx, refundId: string): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "task" (
      "id", "createdAt", "updatedAt", "ownerId", "creatorUserId", "name",
      "description", "status", "workspaceId"
    )
    VALUES (
      ${`${refundId}-task`}, TIMESTAMP '2026-07-31 09:00:00', NOW(), ${USER_ID}, ${USER_ID},
      'Draft the launch email', 'x', 'COMPLETED', ${WORKSPACE_ID}::uuid
    )
  `;
}

/** A task payment claim whose refund is `refundId`, reached through its task event. */
async function seedRefundedClaim(tx: Tx, refundId: string): Promise<void> {
  await seedRefundedTask(tx, refundId);
  await seedChargeTransaction(tx, `${refundId}-charge`);
  await tx.$executeRaw`
    INSERT INTO "taskEvent" ("id", "createdAt", "updatedAt", "taskId", "comment")
    VALUES (${`${refundId}-event`}, NOW(), NOW(), ${`${refundId}-task`}, 'Agent run')
  `;
  await tx.$executeRaw`
    INSERT INTO "task_payment_claim" (
      "id", "createdAt", "updatedAt", "network", "blockchainIdentifier", "purchasePayload",
      "status", "failureReason", "taskEventId", "transactionId", "refundTransactionId"
    )
    VALUES (
      ${`${refundId}-claim`}, NOW(), NOW(), 'Preprod', ${`${refundId}-claim-chain`}, '{}'::jsonb,
      'REFUNDED'::"TaskPaymentClaimStatus", 'raw node error: do not show',
      ${`${refundId}-event`}, ${`${refundId}-charge`}, ${refundId}
    )
  `;
}

async function seedRefundedX402Payment(
  tx: Tx,
  refundId: string,
  refundKind: "NODE_REFUSAL" | "OPERATOR_GOODWILL" | "OPERATOR_RESOLVE" | null,
): Promise<void> {
  await seedRefundedTask(tx, refundId);
  await seedChargeTransaction(tx, `${refundId}-charge`);
  await tx.$executeRaw`
    INSERT INTO "task_x402_payment" (
      "id", "createdAt", "updatedAt", "idempotencyKey", "status", "caip2Network", "asset",
      "amount", "payTo", "taskId", "agentId", "transactionId", "refundTransactionId", "refundKind"
    )
    VALUES (
      ${`${refundId}-x402`}, NOW(), NOW(), ${`${refundId}-key`}, 'REFUNDED'::"TaskX402PaymentStatus",
      'eip155:8453', '0xasset', '1', '0xpayto', ${`${refundId}-task`}, 'txhist-agent',
      ${`${refundId}-charge`}, ${refundId}, ${refundKind}::"TaskX402PaymentRefundKind"
    )
  `;
}

async function findRefundRow(tx: Tx, refundId: string, q?: string) {
  const { rows } = await findTransactionHistoryPage(
    { ...personalScope, kinds: ["topUp"], q },
    { take: 20 },
    tx,
  );
  return rows.find((row) => row.id === refundId);
}

/** The item a client would see for a refund row. */
async function findRefundItem(tx: Tx, refundId: string) {
  const row = await findRefundRow(tx, refundId);
  if (!row) throw new Error(`Missing refund ${refundId}`);
  return mapTransactionHistoryRow(row);
}

describe.skipIf(!enabled)("Transactions ledger against PostgreSQL", () => {
  it("names the job behind a refund and keeps its on-chain status", async () => {
    await withSeededLedger(async (tx) => {
      await seedRefundTransaction(tx, "tx-refund-job");
      await seedRefundedJob(tx, "tx-refund-job", "REFUND_WITHDRAWN");

      expect(await findRefundRow(tx, "tx-refund-job")).toMatchObject({
        refundSource: "job",
        refundedJobId: "tx-refund-job-job",
        refundedJobName: "Audit the contract",
        refundedAgentId: "txhist-agent",
        refundedJobOnChainStatus: "REFUND_WITHDRAWN",
        refundedTaskId: null,
      });
      expect(await findRefundItem(tx, "tx-refund-job")).toMatchObject({
        description: "Refund approved · Audit the contract",
        refundedJobId: "tx-refund-job-job",
        refundedAgentId: "txhist-agent",
      });
    });
  });

  it("names a refunded job that never got a purchase", async () => {
    await withSeededLedger(async (tx) => {
      await seedRefundTransaction(tx, "tx-refund-job");
      await seedRefundedJob(tx, "tx-refund-job", null);

      expect(await findRefundRow(tx, "tx-refund-job")).toMatchObject({
        refundSource: "job",
        refundedJobName: "Audit the contract",
        refundedJobOnChainStatus: null,
      });
      expect(await findRefundItem(tx, "tx-refund-job")).toMatchObject({
        description: "Payment could not be completed · Audit the contract",
      });
    });
  });

  it("names the task behind a refunded payment claim", async () => {
    await withSeededLedger(async (tx) => {
      await seedRefundTransaction(tx, "tx-refund-claim");
      await seedRefundedClaim(tx, "tx-refund-claim");

      expect(await findRefundRow(tx, "tx-refund-claim")).toMatchObject({
        refundSource: "taskPaymentClaim",
        refundedTaskId: "tx-refund-claim-task",
        refundedTaskName: "Draft the launch email",
        refundedJobId: null,
        refundX402Kind: null,
      });
      expect(await findRefundItem(tx, "tx-refund-claim")).toMatchObject({
        description: "Payment could not be completed · Draft the launch email",
        refundedTaskId: "tx-refund-claim-task",
      });
    });
  });

  it("names the task behind a refunded x402 payment and its refund kind", async () => {
    await withSeededLedger(async (tx) => {
      await seedRefundTransaction(tx, "tx-refund-refusal");
      await seedRefundedX402Payment(tx, "tx-refund-refusal", "NODE_REFUSAL");
      await seedRefundTransaction(tx, "tx-refund-goodwill");
      await seedRefundedX402Payment(
        tx,
        "tx-refund-goodwill",
        "OPERATOR_GOODWILL",
      );

      expect(await findRefundRow(tx, "tx-refund-refusal")).toMatchObject({
        refundSource: "taskX402",
        refundedTaskId: "tx-refund-refusal-task",
        refundedTaskName: "Draft the launch email",
        refundX402Kind: "NODE_REFUSAL",
      });
      expect(await findRefundItem(tx, "tx-refund-refusal")).toMatchObject({
        description: "Payment was refused · Draft the launch email",
        refundedTaskId: "tx-refund-refusal-task",
      });
      expect(await findRefundItem(tx, "tx-refund-goodwill")).toMatchObject({
        description: "Refunded by support · Draft the launch email",
      });
    });
  });

  it("leaves a refund with no job or task unexplained", async () => {
    await withSeededLedger(async (tx) => {
      await seedRefundTransaction(tx, "tx-refund-orphan");

      expect(await findRefundRow(tx, "tx-refund-orphan")).toMatchObject({
        kind: "topUp",
        topUpSource: "REFUND",
        refundSource: null,
        refundedJobId: null,
        refundedJobName: null,
        refundedAgentId: null,
        refundedJobOnChainStatus: null,
        refundedTaskId: null,
        refundedTaskName: null,
        refundX402Kind: null,
      });
      expect(await findRefundItem(tx, "tx-refund-orphan")).toMatchObject({
        title: "Refund",
        description: null,
        refundedJobId: null,
        refundedAgentId: null,
        refundedTaskId: null,
      });
    });
  });

  it("names an archived task's refund without linking to it", async () => {
    await withSeededLedger(async (tx) => {
      await seedRefundTransaction(tx, "tx-refund-archived");
      await seedRefundedClaim(tx, "tx-refund-archived");
      await tx.$executeRaw`
        UPDATE "task" SET "archivedAt" = NOW() WHERE "id" = 'tx-refund-archived-task'
      `;

      // An archived task is a 404 everywhere, so the row says what it was
      // but opens nothing.
      expect(await findRefundItem(tx, "tx-refund-archived")).toMatchObject({
        description: "Payment could not be completed · Draft the launch email",
        refundedTaskId: null,
      });
    });
  });

  it("flags a task charge whose task is archived", async () => {
    await withSeededLedger(async (tx) => {
      const findTaskItem = async () => {
        const { rows } = await findTransactionHistoryPage(
          { ...personalScope, kinds: ["task"] },
          { take: 20 },
          tx,
        );
        const row = rows.find((candidate) => candidate.id === "tx-task");
        if (!row) throw new Error("Missing tx-task");
        return mapTransactionHistoryRow(row);
      };

      expect(await findTaskItem()).toMatchObject({ taskArchived: false });

      await tx.$executeRaw`
        UPDATE "task" SET "archivedAt" = NOW() WHERE "id" = 'txhist-task'
      `;

      expect(await findTaskItem()).toMatchObject({
        title: "Summarise the report",
        taskArchived: true,
      });
    });
  });

  it("finds a refund by the name of the task it refunded", async () => {
    await withSeededLedger(async (tx) => {
      await seedRefundTransaction(tx, "tx-refund-claim");
      await seedRefundedClaim(tx, "tx-refund-claim");

      expect(
        await findRefundRow(tx, "tx-refund-claim", "launch email"),
      ).toBeDefined();
      expect(
        await findRefundRow(tx, "tx-refund-claim", "no such task"),
      ).toBeUndefined();
    });
  });

  it("finds a refund by the name of the job it refunded", async () => {
    await withSeededLedger(async (tx) => {
      await seedRefundTransaction(tx, "tx-refund-job");
      await seedRefundedJob(tx, "tx-refund-job", "REFUND_WITHDRAWN");

      expect(
        await findRefundRow(tx, "tx-refund-job", "contract"),
      ).toBeDefined();
    });
  });

  it("lists every ledger row in the workspace, newest first", async () => {
    await withSeededLedger(async (tx) => {
      const { rows, hasMore } = await findTransactionHistoryPage(
        personalScope,
        { take: 20 },
        tx,
      );

      expect(hasMore).toBe(false);
      expect(rows.map((row) => [row.id, row.kind])).toEqual([
        ["tx-topup", "topUp"],
        ["tx-unattr", "unattributed"],
        ["tx-coworker", "coworker"],
        ["tx-task", "task"],
        ["tx-job", "job"],
        ["tx-image", "image"],
        ["tx-sokobot", "sokoBot"],
      ]);
      expect(await countTransactionHistory(personalScope, tx)).toBe(7);
    });
  });

  it("lists a top up with the bucket it created and its positive amount", async () => {
    await withSeededLedger(async (tx) => {
      const { rows } = await findTransactionHistoryPage(
        { ...personalScope, kinds: ["topUp"] },
        { take: 20 },
        tx,
      );

      expect(rows.map((row) => row.id)).toEqual(["tx-topup"]);
      expect(rows[0]?.kind).toBe("topUp");
      expect(rows[0]?.amount).toBe(100n * CREDIT);
      expect(rows[0]?.topUpSource).toBe("STRIPE_SUBSCRIPTION_PERIOD");
      // Not a refund: nothing to describe or link.
      expect(rows[0]?.refundSource).toBeNull();
      expect(rows[0]?.refundedJobId).toBeNull();
      expect(rows[0]?.refundedTaskId).toBeNull();
    });
  });

  it("excludes non-charging activity and other workspaces", async () => {
    await withSeededLedger(async (tx) => {
      const { rows } = await findTransactionHistoryPage(
        personalScope,
        { take: 20 },
        tx,
      );
      const ids = rows.map((row) => row.id);

      // Another workspace's spend.
      expect(ids).not.toContain("tx-org");
      // The free taskEvent charged nothing, so it produced no ledger row at
      // all: the paid event is the only task row, and it appears once.
      expect(ids.filter((id) => id === "tx-task")).toHaveLength(1);
      expect(rows.find((row) => row.id === "tx-task")?.taskEventId).toBe(
        "txhist-event-paid",
      );
    });
  });

  it("does not move a row when only a source entity's updatedAt is touched", async () => {
    await withSeededLedger(async (tx) => {
      const before = await findTransactionHistoryPage(
        personalScope,
        { take: 20 },
        tx,
      );

      // Exactly what the task tag classification backfill did to every
      // historical task, plus a bare row touch on the job.
      await tx.$executeRaw`
        UPDATE "task"
        SET "automaticTags" = ARRAY['research']::TEXT[],
            "tagClassificationState" = 'complete',
            "updatedAt" = NOW()
        WHERE "id" = 'txhist-task'
      `;
      await tx.$executeRaw`UPDATE "Job" SET "updatedAt" = NOW() WHERE "id" = 'txhist-job'`;
      await tx.$executeRaw`UPDATE "project_image_job" SET "updatedAt" = NOW() WHERE "id" = ${IMAGE_JOB_ID}::uuid`;

      const after = await findTransactionHistoryPage(
        personalScope,
        { take: 20 },
        tx,
      );

      expect(after.rows.map((row) => row.id)).toEqual(
        before.rows.map((row) => row.id),
      );
      expect(after.rows.map((row) => row.consumedAt.toISOString())).toEqual([
        "2026-07-01T10:00:00.000Z",
        "2026-06-01T10:00:00.000Z",
        "2026-05-01T10:00:00.000Z",
        "2026-04-01T10:00:00.000Z",
        "2026-03-01T10:00:00.000Z",
        "2026-02-01T10:00:00.000Z",
        "2026-01-15T10:00:00.000Z",
      ]);
    });
  });

  it("pages without duplicating or skipping a row", async () => {
    await withSeededLedger(async (tx) => {
      const seen: string[] = [];
      let cursor: string | undefined;

      for (let page = 0; page < 6; page += 1) {
        const { rows, hasMore } = await findTransactionHistoryPage(
          personalScope,
          { cursor, take: 2 },
          tx,
        );
        seen.push(...rows.map((row) => row.id));
        if (!hasMore) break;
        cursor = rows.at(-1)?.id;
      }

      expect(seen).toEqual([
        "tx-topup",
        "tx-unattr",
        "tx-coworker",
        "tx-task",
        "tx-job",
        "tx-image",
        "tx-sokobot",
      ]);
      expect(new Set(seen).size).toBe(seen.length);
    });
  });

  it("filters by source kind, project and search text", async () => {
    await withSeededLedger(async (tx) => {
      const unattributed = await findTransactionHistoryPage(
        { ...personalScope, kinds: ["unattributed"] },
        { take: 20 },
        tx,
      );
      expect(unattributed.rows.map((row) => row.id)).toEqual(["tx-unattr"]);
      expect(unattributed.rows[0]?.bucketSource).toBe(
        "STRIPE_SUBSCRIPTION_PERIOD",
      );

      const projectRows = await findTransactionHistoryPage(
        { ...personalScope, projectId: PROJECT_ID },
        { take: 20 },
        tx,
      );
      expect(projectRows.rows.map((row) => row.id)).toEqual([
        "tx-task",
        "tx-job",
        "tx-image",
      ]);

      const searched = await findTransactionHistoryPage(
        { ...personalScope, q: "competitors" },
        { take: 20 },
        tx,
      );
      expect(searched.rows.map((row) => row.id)).toEqual(["tx-job"]);
    });
  });

  it("scopes an organization workspace to the organization", async () => {
    await withSeededLedger(async (tx) => {
      const organizationParams = {
        scope: "workspace",
        userContext: {
          source: "context",
          userId: USER_ID,
          organizationId: ORGANIZATION_ID,
        },
        workspaceContext: {
          workspaceId: ORGANIZATION_WORKSPACE_ID,
          userId: null,
          organizationId: ORGANIZATION_ID,
        },
      } satisfies BuildTransactionHistoryParams;

      const workspaceRows = await findTransactionHistoryPage(
        organizationParams,
        { take: 20 },
        tx,
      );
      expect(workspaceRows.rows.map((row) => row.id)).toEqual(["tx-org"]);

      // `owned` narrows the same workspace to this user, who did not spend it.
      const ownedRows = await findTransactionHistoryPage(
        { ...organizationParams, scope: "owned" },
        { take: 20 },
        tx,
      );
      expect(ownedRows.rows).toHaveLength(0);
    });
  });
});
