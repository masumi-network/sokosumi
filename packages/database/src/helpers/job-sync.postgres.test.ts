import { afterAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "../client.js";
import {
  AgentJobStatus,
  AgentStatus,
  JobType,
  OnChainJobStatus,
} from "../generated/prisma/client.js";
import {
  buildJobsNeedingAgentStatusSyncWhere,
  buildJobsNeedingPurchaseTransactionSyncWhere,
} from "./job-sync.js";

const databaseUrl = process.env.JOB_SYNC_TEST_DATABASE_URL;
const now = new Date("2026-09-15T21:45:00Z");

// Fixtures are created inside a transaction that always rolls back.
// Run with JOB_SYNC_TEST_DATABASE_URL pointing at an empty, disposable PostgreSQL database.
describe.skipIf(!databaseUrl)("job sync PostgreSQL null semantics", () => {
  const db = createPrismaClient(databaseUrl ?? "");
  afterAll(() => db.$disconnect());

  interface Scenario {
    rail: string;
    status: string | null;
    transaction: string | null;
    expired: boolean;
    agent: number;
    purchase: number;
    missingPurchase?: boolean;
    refunded?: boolean;
    noDeadline?: boolean;
    old?: boolean;
  }

  it.each<Scenario>([
    {
      rail: "Web3CardanoV2",
      status: null,
      transaction: null,
      expired: false,
      agent: 1,
      purchase: 1,
    },
    {
      rail: "Web3CardanoV2",
      status: "FUNDS_LOCKED",
      transaction: null,
      expired: false,
      agent: 1,
      purchase: 1,
    },
    {
      rail: "Web3CardanoV2",
      status: "RESULT_SUBMITTED",
      transaction: null,
      expired: false,
      agent: 1,
      purchase: 1,
    },
    {
      rail: "Web3CardanoV2",
      status: null,
      transaction: null,
      expired: true,
      agent: 1,
      purchase: 0,
    },
    {
      rail: "Web3CardanoV1",
      status: null,
      transaction: null,
      expired: false,
      agent: 1,
      purchase: 0,
    },
    {
      rail: "Web3CardanoV1",
      status: "FUNDS_LOCKED",
      transaction: "PENDING",
      expired: false,
      agent: 1,
      purchase: 1,
    },
    {
      rail: "Web3CardanoV2",
      status: null,
      transaction: null,
      expired: false,
      agent: 1,
      purchase: 0,
      missingPurchase: true,
    },
    {
      rail: "Web3CardanoV2",
      status: null,
      transaction: null,
      expired: false,
      agent: 0,
      purchase: 1,
      refunded: true,
    },
    {
      rail: "Web3CardanoV2",
      status: "DISPUTED",
      transaction: null,
      expired: true,
      agent: 0,
      purchase: 1,
    },
    {
      rail: "Web3CardanoV2",
      status: null,
      transaction: null,
      expired: false,
      agent: 1,
      purchase: 1,
      noDeadline: true,
    },
    {
      rail: "Web3CardanoV2",
      status: null,
      transaction: null,
      expired: false,
      agent: 1,
      purchase: 0,
      noDeadline: true,
      old: true,
    },
    ...[
      "DISPUTED",
      "REFUND_REQUESTED",
      "REFUND_AUTHORIZED",
      "REFUND_WITHDRAWN",
      "DISPUTED_WITHDRAWN",
      "FUNDS_OR_DATUM_INVALID",
    ].map((status) => ({
      rail: "Web3CardanoV2",
      status,
      transaction: null,
      expired: false,
      agent: 0,
      purchase: 1,
    })),
  ])(
    "selects $rail/$status with transaction=$transaction expired=$expired",
    async (row) => {
      const rollback = new Error("Rollback test fixtures");
      await db
        .$transaction(async (tx) => {
          for (const [name, values] of Object.entries({
            AgentStatus,
            JobType,
            AgentJobStatus,
            OnChainJobStatus,
          })) {
            await tx.$executeRawUnsafe(
              `CREATE TYPE "${name}" AS ENUM (${Object.values(values)
                .map((value) => `'${value}'`)
                .join(",")})`,
            );
          }
          await tx.$executeRawUnsafe(
            `CREATE TABLE "Agent" (id text, status "AgentStatus")`,
          );
          await tx.$executeRawUnsafe(
            `CREATE TABLE "Job" (id text, "agentId" text, "jobType" "JobType", "paymentSourceType" text, "createdAt" timestamp, "externalDisputeUnlockTime" timestamp, "agentApiBaseUrl" text, "refundedTransactionId" text)`,
          );
          await tx.$executeRawUnsafe(
            `CREATE TABLE "jobPurchase" (id text, "jobId" text, "onChainStatus" "OnChainJobStatus", "onChainTransactionStatus" text)`,
          );
          await tx.$executeRawUnsafe(
            `CREATE TABLE "jobEvent" (id text, "jobId" text, status "AgentJobStatus")`,
          );
          await tx.$executeRaw`INSERT INTO "Agent" VALUES ('agent', 'ONLINE')`;
          await tx.$executeRaw`INSERT INTO "Job" VALUES ('job', 'agent', 'PAID', ${row.rail}, ${new Date(now.getTime() + (row.old ? -1 : 1) * 60_000)}, ${row.noDeadline ? null : new Date(now.getTime() + (row.expired ? -1 : 1) * 60_000)}, 'https://agent.example', ${row.refunded ? "refund" : null})`;
          if (!row.missingPurchase) {
            await tx.$executeRaw`INSERT INTO "jobPurchase" VALUES ('purchase', 'job', ${row.status}, ${row.transaction})`;
          }
          expect(
            await tx.job.count({
              where: buildJobsNeedingAgentStatusSyncWhere(now),
            }),
          ).toBe(row.agent);
          expect(
            await tx.job.count({
              where: buildJobsNeedingPurchaseTransactionSyncWhere(now, now),
            }),
          ).toBe(row.purchase);
          throw rollback;
        })
        .catch((error) => {
          if (error !== rollback) throw error;
        });
    },
  );
});
