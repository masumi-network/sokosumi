import { randomUUID } from "node:crypto";

import type { Prisma } from "@sokosumi/database";
import { netTable, sharedTable } from "@sokosumi/database/sql-tables";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Network } from "@/lib/network";
import { onSplitLayout } from "@/test/split-layout";

import {
  NETWORK_TO_SHARED_KEYS,
  SHARED_TO_NETWORK_KEYS,
} from "./crossing-keys";

const ON_POSTGRES =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL?.startsWith("postgres"));

async function plantNetworkOrphans(
  tx: Prisma.TransactionClient,
  network: Network,
  workspace: string,
  transaction: string,
  job: string,
): Promise<void> {
  const missing = randomUUID();
  await tx.$executeRaw`
    INSERT INTO ${netTable(network, "Transaction")} (id, "updatedAt", amount, "userId", "organizationId")
    VALUES (${transaction}, now(), 1, ${missing}, ${missing}),
           (gen_random_uuid(), now(), 1, NULL, NULL)`;
  await tx.$executeRaw`
    INSERT INTO ${netTable(network, "credit_bucket")}
      (id, "updatedAt", amount, "sourceTransactionId", "userId", "organizationId", "projectId")
    VALUES (gen_random_uuid(), now(), 1, gen_random_uuid(), ${missing}, NULL, ${missing}::uuid),
           (gen_random_uuid(), now(), 1, gen_random_uuid(), NULL, ${missing}, NULL)`;
  await tx.$executeRaw`
    INSERT INTO ${netTable(network, "UserAgentRating")}
      (id, "updatedAt", rating, "userId", "agentId")
    VALUES (gen_random_uuid(), now(), 4, ${missing}, gen_random_uuid())`;
  await tx.$executeRaw`
    INSERT INTO ${netTable(network, "Job")}
      (id, "updatedAt", "agentId", "agentJobId", "jobType", "workspaceId", "ownerId",
       "creatorUserId", "organizationId", "projectId", "taskId", "creatorCoworkerId", "creatorSokoBotId")
    VALUES
      (${job}, now(), ${missing}, gen_random_uuid(), 'FREE', ${missing}::uuid, ${missing},
       ${missing}, ${missing}, ${missing}::uuid, ${missing}, NULL, NULL),
      (gen_random_uuid(), now(), ${missing}, gen_random_uuid(), 'FREE', ${workspace}::uuid, NULL,
       NULL, NULL, NULL, NULL, ${missing}, NULL),
      (gen_random_uuid(), now(), ${missing}, gen_random_uuid(), 'FREE', ${workspace}::uuid, NULL,
       NULL, NULL, NULL, NULL, NULL, ${missing}::uuid)`;
  await tx.$executeRaw`
    INSERT INTO ${netTable(network, "coworker_usage")}
      (id, "updatedAt", "idempotencyKey", "coworkerId", "userId", "organizationId", cents, "transactionId")
    VALUES (gen_random_uuid(), now(), gen_random_uuid(), ${missing}, ${missing}, ${missing}, 1, ${transaction})`;
  await tx.$executeRaw`
    INSERT INTO ${netTable(network, "soko_bot_usage")}
      (id, "updatedAt", "idempotencyKey", "sokoBotId", "userId", "organizationId", cents, "transactionId")
    VALUES (gen_random_uuid(), now(), gen_random_uuid(), ${missing}::uuid, ${missing}, ${missing}, 1, ${transaction})`;
  await tx.$executeRaw`
    INSERT INTO ${netTable(network, "task_payment_claim")}
      (id, "updatedAt", network, "blockchainIdentifier", "purchasePayload", "transactionId", "taskEventId")
    VALUES (gen_random_uuid(), now(), 'preprod', gen_random_uuid(), '{}'::jsonb, ${transaction}, ${missing})`;
  await tx.$executeRaw`
    INSERT INTO ${netTable(network, "task_x402_payment")}
      (id, "updatedAt", "idempotencyKey", "caip2Network", asset, amount, "payTo", "taskId",
       "agentId", "transactionId", "taskEventId")
    VALUES (gen_random_uuid(), now(), gen_random_uuid(), 'test', 'test', '1', 'test', ${missing},
       ${missing}, ${transaction}, ${missing})`;
}

async function plantTaggedSharedOrphans(
  tx: Prisma.TransactionClient,
  tag: "preprod" | null,
  transaction: string,
  job: string,
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO ${sharedTable("taskEvent")} (id, "updatedAt", "taskId", "transactionId", network)
    VALUES (gen_random_uuid(), now(), gen_random_uuid(), ${transaction}, ${tag})`;
  await tx.$executeRaw`
    INSERT INTO ${sharedTable("soko_bot_delegation")}
      (id, "updatedAt", "turnId", "toolCallId", kind, action, "jobId", network)
    VALUES (gen_random_uuid(), now(), gen_random_uuid(), gen_random_uuid(), 'JOB', 'test', ${job}, ${tag})`;
  await tx.$executeRaw`
    INSERT INTO ${sharedTable("soko_bot_schedule")}
      (id, "updatedAt", "sokoBotId", "workspaceId", name, timezone, "cronExpression",
       prompt, "nextRunAt", "jobId", network)
    VALUES (gen_random_uuid(), now(), gen_random_uuid(), gen_random_uuid(), 'test', 'UTC', '* * * * *',
      'test', now(), ${job}, ${tag})`;
}

async function plantMainnetOnlySharedOrphans(
  tx: Prisma.TransactionClient,
  transaction: string,
  job: string,
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO ${sharedTable("competitor_check")} (id, "projectId", day, "transactionId")
    VALUES (gen_random_uuid(), gen_random_uuid(), '2026-11-27', ${transaction})`;
  await tx.$executeRaw`
    INSERT INTO ${sharedTable("project_image_job")}
      (id, "updatedAt", "projectId", "workspaceId", "requestedByUserId", kind, model,
       prompt, settings, "idempotencyKey", "transactionId", "refundTransactionId")
    VALUES (gen_random_uuid(), now(), gen_random_uuid(), gen_random_uuid(), 'test', 'GENERATE',
      'test', 'test', '{}'::jsonb, gen_random_uuid(), ${transaction}, ${transaction})`;
  await tx.$executeRaw`
    INSERT INTO ${sharedTable("seo_audit_chat_turn")}
      (id, "auditId", "userId", "idempotencyKey", "requestHash", question, "scopeSnapshot",
       model, "leaseExpiresAt", "transactionId")
    VALUES (gen_random_uuid(), gen_random_uuid(), 'test', gen_random_uuid(), 'test', 'test',
      '{}'::jsonb, 'test', now(), ${transaction})`;
  await tx.$executeRaw`
    INSERT INTO ${sharedTable("jobShare")} (id, "updatedAt", token, "jobId")
    VALUES (gen_random_uuid(), now(), gen_random_uuid(), ${job})`;
}

describe.runIf(ON_POSTGRES)("crossing key orphan check", () => {
  let prisma: typeof import("./prisma").default;
  let countOrphans: typeof import("./crossing-key-orphans").countCrossingKeyOrphans;

  beforeAll(async () => {
    vi.stubEnv("NETWORK_PREPROD_ENABLED", onSplitLayout ? "true" : "false");
    ({ default: prisma } = await import("./prisma"));
    ({ countCrossingKeyOrphans: countOrphans } = await import(
      "./crossing-key-orphans"
    ));
  });

  afterAll(() => vi.unstubAllEnvs());

  it("reports zero for every key on a consistent database in a read-only transaction", async () => {
    const counts = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return countOrphans(tx);
    });
    expect(counts).toHaveLength(onSplitLayout ? 62 : 31);
    for (const row of counts) {
      expect(row.count, `${row.network} ${row.key}`).toBe(0n);
    }
  });

  it("finds one orphan per applicable key in the correct Network", async () => {
    const rollback = new Error("Roll back orphan fixtures");
    const workspace = randomUUID();
    const mainnet = { transaction: randomUUID(), job: randomUUID() };
    const preprod = { transaction: randomUUID(), job: randomUUID() };
    await expect(
      prisma.$transaction(async (tx) => {
        // The migrated layout and the current CI split both retain the foreign
        // keys. Bypass them during seeding on this transaction alone.
        await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
        await tx.$executeRaw`
        INSERT INTO ${sharedTable("workspace")} (id, "updatedAt", "userId")
        VALUES (${workspace}::uuid, now(), gen_random_uuid())`;
        await plantNetworkOrphans(
          tx,
          "mainnet",
          workspace,
          mainnet.transaction,
          mainnet.job,
        );
        if (onSplitLayout) {
          await plantNetworkOrphans(
            tx,
            "preprod",
            workspace,
            preprod.transaction,
            preprod.job,
          );
          await plantTaggedSharedOrphans(
            tx,
            "preprod",
            mainnet.transaction,
            mainnet.job,
          );
        }
        // Each tagged orphan on the split layout has a parent on the other
        // Network. The preprod IDs are absent in public on today's layout.
        await plantTaggedSharedOrphans(
          tx,
          null,
          preprod.transaction,
          preprod.job,
        );
        await plantMainnetOnlySharedOrphans(tx, randomUUID(), randomUUID());
        await plantMainnetOnlySharedOrphans(
          tx,
          mainnet.transaction,
          mainnet.job,
        );
        await tx.$executeRaw`SET LOCAL session_replication_role = origin`;

        const counts = await countOrphans(tx);
        const networkKeys = NETWORK_TO_SHARED_KEYS.map(
          ([child, column]) => `${child}.${column}`,
        );
        const sharedKeys = SHARED_TO_NETWORK_KEYS.map(
          ([child, column]) => `${child}.${column}`,
        );
        const taggedKeys = SHARED_TO_NETWORK_KEYS.filter(
          (key) => key[7] === "tagged",
        ).map(([child, column]) => `${child}.${column}`);
        expect(
          Object.fromEntries(
            counts.map(({ network, key, count }) => [
              `${network}/${key}`,
              count,
            ]),
          ),
        ).toEqual({
          ...Object.fromEntries(
            [...networkKeys, ...sharedKeys].map((key) => [
              `mainnet/${key}`,
              1n,
            ]),
          ),
          ...(onSplitLayout
            ? Object.fromEntries([
                ...networkKeys.map((key) => [`preprod/${key}`, 1n]),
                ...sharedKeys.map((key) => [
                  `preprod/${key}`,
                  taggedKeys.includes(key) ? 1n : 0n,
                ]),
              ])
            : {}),
        });
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});
