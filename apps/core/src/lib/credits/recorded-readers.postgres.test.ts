/**
 * Captured on 549ff8a56 from the public ledger, including the PostgreSQL
 * driver’s statements and bindings. Replay its 30 mixed debits at their
 * recorded instants, giving this run its own wallet, Project and row IDs.
 */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { notifyLowBalanceAfterCharge } from "@/helpers/billing-notifications";
import { loadAgentPreviewsByIds } from "@/helpers/history";
import { mapTransactionHistoryRow } from "@/helpers/transaction-history";
import { streamTransactionCsv } from "@/helpers/transaction-history-csv";
import { createNetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import { requireSeoChatBalance } from "@/lib/seo/chat-billing";
import { observing, statementDigest } from "@/test/spend-comparison";
import { getBalance, getOrganizationPoolBalance } from "./balance";
import {
  countTransactionHistory,
  findTransactionHistoryPage,
  sumTransactionHistory,
} from "./history";
import base from "./readers.base.json";

vi.mock("@vercel/functions", async (original) => {
  const { observePool } = await import("@/test/spend-comparison");
  return {
    ...(await original<typeof import("@vercel/functions")>()),
    attachDatabasePool: (pool: Pool) => observePool(pool),
  };
});
const wire = vi.hoisted(() => ({ email: vi.fn(), publish: vi.fn() }));
vi.mock("@/helpers/billing-notification-email", () => ({
  sendBillingNotificationEmail: wire.email,
}));
vi.mock("@/helpers/notification-publish-queue", async (original) => ({
  ...(await original<typeof import("@/helpers/notification-publish-queue")>()),
  scheduleNotificationPublish: wire.publish,
}));

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const credit = 10n ** 10n;
const scope = createNetworkScope("mainnet");
const readAt = new Date("2026-11-28T12:13:14.567Z");
const timeout = 120_000;

async function queries<T>(
  run: () => Promise<T>,
  expected: { sha256: string; bindings: unknown[] }[],
  bindings: Map<string, string>,
) {
  const { outcome, log } = await observing(run);
  expect(outcome).not.toHaveProperty("threw");
  expect(log.length).toBeGreaterThan(0);
  expect(
    log.map(({ text, values }) => ({
      sha256: statementDigest(text),
      bindings: values,
    })),
  ).toEqual(
    expected.map(({ sha256, bindings: args }) => ({
      sha256,
      bindings: args.map((arg) =>
        typeof arg === "string" ? (bindings.get(arg) ?? arg) : arg,
      ),
    })),
  );
  return outcome;
}

describe.runIf(enabled)(
  "Mainnet credit readers as recorded on the public layout",
  () => {
    it(
      "enriches ledger Agent previews on both layouts; the base split read at history.ts:521 returned an empty map",
      async () => {
        const db = createNetworkScope("mainnet").networkDb;
        const id = randomUUID(),
          pricingId = randomUUID();
        expect(await db.agent.count({ where: { id } })).toBe(0);
        try {
          await db.agent.create({
            data: {
              id,
              name: "Ledger preview",
              blockchainIdentifier: id,
              isShown: true,
              lastUptimeCheck: new Date("2026-10-10T00:00:00Z"),
              uptimeCount: 0,
              uptimeCheckCount: 0,
              pricing: { create: { id: pricingId, pricingType: "FREE" } },
            },
          });
          const rows = await queries(
            async () => [...(await loadAgentPreviewsByIds([id], db)).values()],
            base.agentPreview.queries,
            new Map([["$agentId", id]]),
          );
          expect(rows).toEqual(base.agentPreview.rows);
        } finally {
          await db.agent.deleteMany({ where: { id } });
          await db.agentPricing.deleteMany({ where: { id: pricingId } });
        }
      },
      timeout,
    );

    it(
      "returns the raw ordered pages, cursor boundaries, item JSON, CSV bytes and balances",
      async () => {
        const organizationId = randomUUID(),
          userId = randomUUID(),
          workspaceId = randomUUID(),
          projectId = randomUUID();
        const params = {
          billingScope: scope,
          scope: "workspace" as const,
          userContext: { source: "context" as const, userId, organizationId },
          workspaceContext: { workspaceId, userId: null, organizationId },
        };
        const ids = base.debits.map(({ id }) => id + "-" + organizationId);
        const grantIds = [randomUUID(), randomUUID(), randomUUID()];
        const buckets = grantIds.map(() => randomUUID());
        const db = scope.networkDb;
        const bindings = new Map([
          ["$organizationId", organizationId],
          ["$userId", userId],
          ["$projectId", projectId],
          ["$readTime", "2026-11-28 12:13:14.567"],
        ]);
        ids.forEach((id, index) => bindings.set("$debit" + index, id));
        expect(await countTransactionHistory(params)).toBe(0);
        try {
          await prisma.user.create({
            data: {
              id: userId,
              name: userId,
              email: userId + "@example.test",
              emailVerified: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });
          await prisma.organization.create({
            data: {
              id: organizationId,
              name: organizationId,
              slug: organizationId,
              workspace: { create: { id: workspaceId } },
            },
          });
          await prisma.project.create({
            data: { id: projectId, name: projectId, workspaceId },
          });
          const grants = [
            { userId, amount: 7n * credit },
            { organizationId, amount: credit },
            { organizationId, amount: 2n * credit },
          ];
          await db.transaction.createMany({
            data: grants.map((grant, i) => ({ ...grant, id: grantIds[i] })),
          });
          await db.creditBucket.createMany({
            data: grants.map((grant, i) => ({
              ...grant,
              id: buckets[i],
              sourceTransactionId: grantIds[i],
              ...(i === 1 && { projectId }),
            })),
          });
          vi.useFakeTimers({ toFake: ["Date"] });
          vi.setSystemTime(readAt);
          const balances = await queries(
            async () => [
              await getBalance(scope, userId, null, prisma),
              await getBalance(scope, null, organizationId, prisma, {
                projectId,
              }),
              await getOrganizationPoolBalance(scope, organizationId, prisma),
              await getBalance(scope, null, organizationId, prisma),
            ],
            base.balanceQueries,
            bindings,
          );
          expect(balances).toEqual(
            [base.personal, ...base.balances].map(BigInt),
          );
          vi.useRealTimers();
          // Each charge takes one credit from the Project before two from the pool.
          // Fund the other 29 after recording the balance at the first charge.
          await db.creditBucket.update({
            where: { id: buckets[1] },
            data: { amount: 30n * credit },
          });
          await db.creditBucket.update({
            where: { id: buckets[2] },
            data: { amount: 60n * credit },
          });
          await db.transaction.createMany({
            data: base.debits.map(({ time }, i) => ({
              id: ids[i],
              organizationId,
              amount: -3n * credit,
              createdAt: new Date(time),
              updatedAt: new Date(time),
            })),
          });
          await db.creditConsumption.createMany({
            data: base.debits.flatMap(({ time }, i) =>
              [1, 2].map((part) => ({
                id: ids[i] + "-" + part,
                transactionId: ids[i],
                bucketId: buckets[part],
                createdAt: new Date(time),
                amount: BigInt(part) * credit,
              })),
            ),
          });
          const filter = {
            ...params,
            projectId,
            kinds: ["unattributed" as const],
          };
          await queries(
            async () => {
              let cursor: string | undefined;
              const rows = [],
                cursors = [];
              do {
                const page = await findTransactionHistoryPage(filter, {
                  cursor,
                  take: 7,
                });
                rows.push(...page.rows);
                cursor = page.hasMore ? page.rows.at(-1)?.id : undefined;
                if (cursor) {
                  expect(cursors).not.toContain(cursor);
                  cursors.push(cursor);
                }
              } while (cursor);
              expect(cursors).toEqual(base.cursorIndices.map((i) => ids[i]));
              const expected = base.debits
                .map(({ time }, i) => ({
                  id: ids[i],
                  consumedAt: new Date(time),
                  projectId,
                }))
                .reverse();
              expect(rows).toEqual(
                expected.map((row) => ({
                  ...base.row,
                  ...row,
                  amount: BigInt(base.row.amount),
                })),
              );
              expect(rows.map((row) => mapTransactionHistoryRow(row))).toEqual(
                expected.map((row) => ({
                  ...base.item,
                  ...row,
                  consumedAt: row.consumedAt.toISOString(),
                })),
              );
              expect(await sumTransactionHistory(filter)).toEqual(base.total);
              expect(await countTransactionHistory(filter)).toBe(base.count);
              const csv = Buffer.from(
                await new Response(streamTransactionCsv(filter)).arrayBuffer(),
              );
              expect(csv.equals(Buffer.from(base.csv))).toBe(true);
              return true;
            },
            base.historyQueries,
            bindings,
          );
        } finally {
          vi.useRealTimers();
          await db.creditConsumption.deleteMany({
            where: { id: { in: ids.flatMap((id) => [id + "-1", id + "-2"]) } },
          });
          await db.creditBucket.deleteMany({ where: { id: { in: buckets } } });
          await db.transaction.deleteMany({
            where: { id: { in: [...ids, ...grantIds] } },
          });
          await prisma.project.deleteMany({ where: { id: projectId } });
          await prisma.workspace.deleteMany({ where: { id: workspaceId } });
          await prisma.organization.deleteMany({
            where: { id: organizationId },
          });
          await prisma.user.deleteMany({ where: { id: userId } });
        }
      },
      timeout,
    );

    it(
      "sends one notice for two checks; base's split lookup at billing-notifications.ts:203 failed on shared.credit_bucket",
      async () => {
        const userId = randomUUID(),
          grant = randomUUID(),
          bucket = randomUUID();
        const wallet = { userId, organizationId: null };
        const db = scope.networkDb;
        const existing = await prisma.notification.findMany({
          where: { userId },
          select: { id: true },
        });
        expect(existing).toHaveLength(0);
        try {
          await prisma.user.create({
            data: {
              id: userId,
              name: userId,
              email: userId + "@example.test",
              emailVerified: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });
          await db.transaction.create({
            data: { id: grant, userId, amount: credit },
          });
          await db.creditBucket.create({
            data: {
              id: bucket,
              userId,
              amount: credit,
              sourceTransactionId: grant,
            },
          });
          wire.email.mockClear();
          const { log } = await observing(async () => {
            await notifyLowBalanceAfterCharge(wallet, scope);
            await notifyLowBalanceAfterCharge(wallet, scope);
          });
          expect(log.length).toBeGreaterThan(0);
          expect(log.map((s) => statementDigest(s.text))).toEqual(
            base.publicAlert.statements,
          );
          const notices = await prisma.notification.findMany({
            where: { userId },
            select: { eventId: true },
          });
          expect(notices).toHaveLength(base.publicAlert.notices);
          expect(notices[0]?.eventId).toBe("low-balance:" + bucket);
          expect(wire.email).toHaveBeenCalledTimes(base.publicAlert.emails);
        } finally {
          await prisma.notification.deleteMany({
            where: { userId, eventId: "low-balance:" + bucket },
          });
          await db.creditBucket.deleteMany({ where: { id: bucket } });
          await db.transaction.deleteMany({ where: { id: grant } });
          await prisma.user.deleteMany({ where: { id: userId } });
        }
      },
      timeout,
    );

    it(
      "admits SEO chat using funding visible only to the caller's Serializable transaction",
      async () => {
        const userId = randomUUID(),
          grant = randomUUID(),
          bucket = randomUUID();
        const rolledBack = new Error("rollback fixture");
        expect(
          await scope.networkDb.transaction.count({ where: { id: grant } }),
        ).toBe(0);
        try {
          await prisma.user.create({
            data: {
              id: userId,
              name: userId,
              email: userId + "@example.test",
              emailVerified: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });
          const observed = await observing(() =>
            prisma.$transaction(
              async (tx) => {
                await tx.$executeRaw`INSERT INTO ${scope.networkTable("Transaction")} (id,"createdAt","updatedAt","userId",amount) VALUES (${grant},NOW(),NOW(),${userId},${credit})`;
                await tx.$executeRaw`INSERT INTO ${scope.networkTable("credit_bucket")} (id,"createdAt","updatedAt","userId",amount,"sourceTransactionId") VALUES (${bucket},NOW(),NOW(),${userId},${credit},${grant})`;
                await requireSeoChatBalance(tx, {
                  userId,
                  organizationId: null,
                  projectId: null,
                });
                throw rolledBack;
              },
              { isolationLevel: "Serializable" },
            ),
          );
          expect(observed.outcome).toMatchObject({
            threw: { message: rolledBack.message },
          });
          expect(observed.log.length).toBeGreaterThan(0);
          expect(new Set(observed.log.map((s) => s.connection)).size).toBe(1);
          expect(observed.log.slice(0, 2).map(({ text }) => text)).toEqual([
            "BEGIN",
            "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE",
          ]);
          expect(observed.log.at(-1)?.text).toBe("ROLLBACK");
        } finally {
          await prisma.user.deleteMany({ where: { id: userId } });
        }
      },
      timeout,
    );
  },
);
