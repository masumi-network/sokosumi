import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { expect, it, vi } from "vitest";
import { createNetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import { cmoPaidFor, readCmoBilling } from "@/services/cmo-billing.service";
import { observing, statementDigest } from "@/test/spend-comparison";
import { cusoFunding } from "./balance";
import { refundParts, turnCharges } from "./commercial-funding";
import base from "./current-funding.base.json";
import { getCurrentSubscriptionCredits } from "./funding";
import { organizationSpendByUser } from "./history";

vi.mock("@vercel/functions", async (original) => {
  const { observePool } = await import("@/test/spend-comparison");
  return {
    ...(await original<typeof import("@vercel/functions")>()),
    attachDatabasePool: (pool: Pool) => observePool(pool),
  };
});

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
it.runIf(enabled)(
  "preserves current-period credits and Cuso funding",
  async () => {
    const scope = createNetworkScope("mainnet");
    const db = scope.networkDb;
    const userId = randomUUID(),
      workspaceId = randomUUID(),
      projectId = randomUUID();
    const grants = [randomUUID(), randomUUID()],
      buckets = grants.map(() => randomUUID());
    const txId = randomUUID(),
      consumption = randomUUID();
    const now = new Date("2026-10-10T12:00:00Z");
    const period = {
      periodStart: new Date("2026-10-01T00:00:00Z"),
      periodEnd: new Date("2026-11-01T00:00:00Z"),
    };
    const params = { subscription: period, userId, organizationId: null, now };
    const credit = 10n ** 10n;
    // Base split failures are recorded alongside the successful public query bytes and results.
    const captures: Record<string, unknown> = {};
    const keys = new Map([
      [userId, "$user"],
      [buckets[0], "$periodBucket"],
      [buckets[1], "$testerBucket"],
      [projectId, "$project"],
    ]);
    function values(value: unknown): unknown {
      return JSON.parse(
        JSON.stringify(value, (_key, v) => {
          if (typeof v === "bigint") return String(v);
          if (typeof v === "string")
            for (const [id, name] of keys) v = v.replaceAll(id, name);
          return v;
        }),
      );
    }
    async function capture(name: string, fn: () => Promise<unknown>) {
      const { outcome, log } = await observing(fn);
      expect(log.length).toBeGreaterThan(0);
      expect(outcome).not.toHaveProperty("threw");
      captures[name] = {
        outcome: values(outcome),
        statements: log
          .map(({ text, values: args }) => ({
            sql: statementDigest(text),
            bindings: values(args),
          }))
          .sort((a, b) => a.sql.localeCompare(b.sql)),
      };
    }
    expect(
      await db.creditBucket.count({ where: { id: { in: buckets } } }),
    ).toBe(0);
    try {
      await prisma.user.create({
        data: {
          id: userId,
          name: userId,
          email: userId + "@example.test",
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
      });
      await prisma.workspace.createMany({
        data: [{ id: workspaceId, userId }],
      });
      await prisma.project.create({
        data: { id: projectId, workspaceId, name: projectId },
      });
      await db.transaction.createMany({
        data: [
          { id: grants[0], amount: 12n * credit, userId },
          { id: grants[1], amount: 3n * credit, userId },
          { id: txId, amount: -2n * credit, userId },
        ],
      });
      await db.creditBucket.createMany({
        data: [
          {
            id: buckets[0],
            userId,
            sourceTransactionId: grants[0],
            amount: 12n * credit,
            referenceType: "STRIPE_SUBSCRIPTION_PERIOD",
            createdAt: period.periodStart,
            expiresAt: period.periodEnd,
          },
          {
            id: buckets[1],
            userId,
            projectId,
            sourceTransactionId: grants[1],
            amount: 3n * credit,
            referenceType: "CMO_TESTER_CREDITS",
            createdAt: period.periodStart,
          },
        ],
      });
      await db.creditConsumption.create({
        data: {
          id: consumption,
          bucketId: buckets[0],
          transactionId: txId,
          amount: 2n * credit,
          createdAt: period.periodStart,
        },
      });
      await capture("period", () =>
        getCurrentSubscriptionCredits({ ...params, scope }),
      );
      await capture("tester", () => cmoPaidFor(projectId, now, scope));
      await capture("billing", () => readCmoBilling(projectId));
      await capture("cusoFunding", () => cusoFunding(scope, projectId, now));
      await capture("spent", () =>
        organizationSpendByUser(scope, projectId, period.periodStart),
      );
      await capture("previousSpent", () =>
        organizationSpendByUser(
          scope,
          projectId,
          new Date("2026-09-01T00:00:00Z"),
          period.periodStart,
        ),
      );
      await capture("turnCharge", () => turnCharges(scope, projectId));
      await capture("refund", () => refundParts(scope, [projectId]));
      expect(captures).toEqual(base.public);
    } finally {
      await db.creditConsumption.deleteMany({ where: { id: consumption } });
      await db.creditBucket.deleteMany({ where: { id: { in: buckets } } });
      await db.transaction.deleteMany({
        where: { id: { in: [...grants, txId] } },
      });
      await prisma.project.deleteMany({ where: { id: projectId } });
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
  },
  120000,
);
