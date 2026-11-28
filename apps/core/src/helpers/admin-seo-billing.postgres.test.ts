/**
 * Admin SEO billing evidence never matches a Task event tagged Preprod (slice
 * 29-2b): both debit-evidence lookups in `seoBillingCtes()` accept only events
 * that count on Mainnet (`network IS NULL OR network = 'mainnet'` via
 * `taskEventCountsOn`). Runs on real PostgreSQL on both layouts; equal-id
 * Preprod transactions run on the split layout only. Every row is this file's
 * own.
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *     pnpm --filter core test src/helpers/admin-seo-billing.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import { seoFullAuditPrice } from "@sokosumi/utils";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { onSplitLayout } from "@/test/split-layout";

// Before any import reads the environment: Preprod is on on the split layout.
await vi.hoisted(async () => {
  const { isSplitLayout } = await import("@/test/split-layout-pending");
  vi.stubEnv(
    "NETWORK_PREPROD_ENABLED",
    isSplitLayout(process.env) ? "true" : "false",
  );
});

const onPostgres =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL?.startsWith("postgres"));

const SETUP_TIMEOUT = 120_000;
const CASE_TIMEOUT = 60_000;
const CREDIT = 10n ** 10n;

// Total 6,000,000 microUSD * 150 / 1,000,000 = 900 credits.
const COST_900 = {
  version: 1,
  gatewayMicroUsd: 1_500_000,
  directModelMicroUsd: 2_200_000,
  dataForSeoMicroUsd: 2_299_986,
  otherApiMicroUsd: 14,
};

describe.runIf(onPostgres)(
  "admin SEO billing debit evidence (PostgreSQL)",
  () => {
    let network: typeof import("@/lib/db/network-scope");
    let prisma: typeof import("@/lib/db/prisma").default;
    let createPersonalWorkspace: typeof import("@/helpers/personal-workspace").createPersonalWorkspace;
    let listAdminSeoAlerts: typeof import("@/services/admin-seo-alerts").listAdminSeoAlerts;
    let seoBillingCtes: typeof import("@/helpers/admin-seo-billing").seoBillingCtes;
    let SEO_PRICE_PENDING_COMMENT: string;

    const tag = randomUUID().slice(0, 8);
    const userId = `seo-bill-user-${tag}`;
    const vendorId = randomUUID();
    const coworkerId = `seo-bill-worker-${tag}`;
    const otherCoworkerId = `seo-bill-other-${tag}`;
    const auditIds: string[] = [];
    const runIds: string[] = [];
    const taskIds: string[] = [];
    const txIds: string[] = [];
    const preprodOnlyTxId = `seo-bill-preprod-only-${tag}`;
    let workspaceId = "";

    const ids = {
      untagged: `seo-bill-untagged-${tag}`,
      mainnet: `seo-bill-mainnet-${tag}`,
      multi: `seo-bill-multi-${tag}`,
      noTx: `seo-bill-notx-${tag}`,
      debitNoEvent: `seo-bill-debitnoev-${tag}`,
      unmatched: `seo-bill-unmatched-${tag}`,
      codex: `seo-bill-codex-${tag}`,
    };
    const tx = {
      untagged900: `seo-bill-tx-untagged-${tag}`,
      mainnet900: `seo-bill-tx-mainnet-${tag}`,
      multi900: `seo-bill-tx-multi-${tag}`,
      orphan500: `seo-bill-tx-orphan-${tag}`,
      unmatched900: `seo-bill-tx-unmatched-${tag}`,
      codex8: `seo-bill-tx-codex8-${tag}`,
      codex4: `seo-bill-tx-codex4-${tag}`,
      codex16: `seo-bill-tx-codex16-${tag}`,
    };

    async function snapshot() {
      const ownTasks = new Set(Object.values(ids));
      const [billingRes, alertsRes, directRows] = await Promise.all([
        listAdminSeoAlerts({ period: "all", page: 1, view: "billing" }),
        listAdminSeoAlerts({ period: "all", page: 1 }),
        prisma.$queryRaw<
          Array<{
            run: string;
            charged_credits: string | null;
            attempted_credits: string | null;
            billing_status: string;
          }>
        >(PrismaRaw.sql`
        WITH progress AS (
          SELECT 'codex' AS run, 'RUNNING' AS task_status, false AS needs_credits, false AS retrying, false AS price_pending, '{}'::jsonb AS request, ${ids.codex}::text AS "taskId", ${coworkerId}::text AS approved_worker, true AS metered
          UNION ALL
          SELECT 'unmatched', 'COMPLETED', false, false, false, ${JSON.stringify({ fullAuditCost: COST_900 })}::jsonb, ${ids.unmatched}::text, ${coworkerId}::text, true
          UNION ALL
          SELECT 'untagged', 'COMPLETED', false, false, false, ${JSON.stringify({ fullAuditCost: COST_900 })}::jsonb, ${ids.untagged}::text, ${coworkerId}::text, true
          UNION ALL
          SELECT 'mainnet', 'COMPLETED', false, false, false, ${JSON.stringify({ fullAuditCost: COST_900 })}::jsonb, ${ids.mainnet}::text, ${coworkerId}::text, true
        ), ${seoBillingCtes()}
        SELECT run, charged_credits::text, attempted_credits::text, billing_status
        FROM billing_summary
        ORDER BY run ASC
      `),
      ]);

      const billing = Object.fromEntries(
        billingRes.billing
          .filter((row) => row.taskId !== null && ownTasks.has(row.taskId))
          .map((row) => [
            row.taskId,
            {
              status: row.status,
              chargedCredits: row.chargedCredits,
              attemptedCredits: row.attemptedCredits,
              cost: row.cost,
            },
          ]),
      );
      const alerts = Object.fromEntries(
        alertsRes.items
          .filter((row) => row.taskId !== null && ownTasks.has(row.taskId))
          .map((row) => [
            row.taskId,
            { severity: row.severity, reasons: row.reasons },
          ]),
      );
      return { billing, alerts, directRows };
    }

    beforeAll(async () => {
      network = await import("@/lib/db/network-scope");
      ({ default: prisma } = await import("@/lib/db/prisma"));
      ({ createPersonalWorkspace } = await import(
        "@/helpers/personal-workspace"
      ));
      ({ listAdminSeoAlerts } = await import("@/services/admin-seo-alerts"));
      ({ seoBillingCtes, SEO_PRICE_PENDING_COMMENT } = await import(
        "@/helpers/admin-seo-billing"
      ));

      const now = new Date();
      const at = (offsetSeconds: number) =>
        new Date(now.getTime() + offsetSeconds * 1000);
      await prisma.user.create({
        data: {
          id: userId,
          name: "SEO Billing Test",
          email: `seo-billing-${tag}@example.test`,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
      });
      const workspace = await createPersonalWorkspace(userId);
      workspaceId = workspace.id;
      await prisma.vendor.create({
        data: {
          id: vendorId,
          name: `SEO Vendor ${tag}`,
          slug: `seo-vendor-${tag}`,
        },
      });
      await prisma.coworker.createMany({
        data: [
          {
            id: coworkerId,
            name: "SEO Approved Worker",
            slug: `seo-worker-${tag}`,
            vendorId,
          },
          {
            id: otherCoworkerId,
            name: "SEO Other Worker",
            slug: `seo-other-${tag}`,
            vendorId,
          },
        ],
      });

      const price = seoFullAuditPrice();
      const billingCtx = {
        ownerId: userId,
        workspaceId,
        organizationId: null,
        projectId: null,
        coworkerId,
      };

      const runs: Array<{
        key: keyof typeof ids;
        status: "COMPLETED" | "RUNNING" | "OUT_OF_CREDITS";
        request: Prisma.InputJsonObject;
        minute: number;
      }> = [
        {
          key: "untagged",
          status: "COMPLETED",
          request: {
            price,
            fullAuditBillingContext: billingCtx,
            fullAuditCost: COST_900,
          },
          minute: 1,
        },
        {
          key: "mainnet",
          status: "COMPLETED",
          request: {
            price,
            fullAuditBillingContext: billingCtx,
            fullAuditCost: COST_900,
          },
          minute: 2,
        },
        {
          key: "multi",
          status: "COMPLETED",
          request: {
            price,
            fullAuditBillingContext: billingCtx,
            fullAuditCost: COST_900,
          },
          minute: 3,
        },
        {
          key: "noTx",
          status: "OUT_OF_CREDITS",
          request: {
            price,
            fullAuditBillingContext: billingCtx,
            pendingFullAuditCost: COST_900,
          },
          minute: 4,
        },
        {
          key: "debitNoEvent",
          status: "RUNNING",
          request: { price, fullAuditBillingContext: billingCtx },
          minute: 5,
        },
        {
          key: "unmatched",
          status: "COMPLETED",
          request: {
            price,
            fullAuditBillingContext: billingCtx,
            fullAuditCost: COST_900,
          },
          minute: 6,
        },
        {
          key: "codex",
          status: "RUNNING",
          request: { price, fullAuditBillingContext: billingCtx },
          minute: 7,
        },
      ];

      for (const run of runs) {
        const createdAt = at(-60 + run.minute);
        const auditId = randomUUID();
        const runId = randomUUID();
        const taskId = ids[run.key];
        auditIds.push(auditId);
        runIds.push(runId);
        taskIds.push(taskId);

        await prisma.seoAudit.create({
          data: {
            id: auditId,
            workspaceId,
            name: `Audit ${run.key} ${tag}`,
            createdById: userId,
            createdAt,
            updatedAt: createdAt,
          },
        });
        await prisma.task.create({
          data: {
            id: taskId,
            ownerId: userId,
            creatorUserId: userId,
            workspaceId,
            assigneeId: coworkerId,
            name: `Task ${run.key} ${tag}`,
            status: run.status,
            createdAt,
            updatedAt: createdAt,
          },
        });
        await prisma.projectSeoAnalysis.create({
          data: {
            id: runId,
            auditId,
            idempotencyKey: `idem-${run.key}-${tag}`,
            requestHash: `hash-${run.key}-${tag}`,
            requestedBy: userId,
            kind: "audit_full",
            status: run.status === "COMPLETED" ? "completed" : "requested",
            taskId,
            request: run.request,
            createdAt,
            updatedAt: createdAt,
          },
        });
      }

      const mainnetDb = network.createNetworkScope("mainnet").networkDb;
      const mainnetTxs: Array<[string, bigint]> = [
        [tx.untagged900, -900n * CREDIT],
        [tx.mainnet900, -900n * CREDIT],
        [tx.multi900, -900n * CREDIT],
        [tx.orphan500, -500n * CREDIT],
        [tx.unmatched900, -900n * CREDIT],
        [tx.codex8, -8n * CREDIT],
        [tx.codex4, -4n * CREDIT],
        [tx.codex16, -16n * CREDIT],
      ];
      for (const [id, amount] of mainnetTxs) {
        txIds.push(id);
        await mainnetDb.transaction.create({
          data: { id, amount, userId, createdAt: now, updatedAt: now },
        });
      }

      await prisma.taskEvent.createMany({
        data: [
          {
            id: `ev-untagged-${tag}`,
            taskId: ids.untagged,
            status: "COMPLETED",
            coworkerId,
            transactionId: tx.untagged900,
            cents: 900n * CREDIT,
            network: null,
            createdAt: at(-50),
          },
          {
            id: `ev-mainnet-${tag}`,
            taskId: ids.mainnet,
            status: "COMPLETED",
            coworkerId,
            transactionId: tx.mainnet900,
            cents: 900n * CREDIT,
            network: "mainnet",
            createdAt: at(-48),
          },
          {
            id: `ev-multi-1-${tag}`,
            taskId: ids.multi,
            status: "RUNNING",
            coworkerId,
            transactionId: tx.multi900,
            cents: null,
            network: null,
            createdAt: at(-46),
          },
          {
            id: `ev-multi-2-${tag}`,
            taskId: ids.multi,
            status: "COMPLETED",
            coworkerId: otherCoworkerId,
            transactionId: tx.multi900,
            cents: 900n * CREDIT,
            network: null,
            createdAt: at(-45),
          },
          {
            id: `ev-multi-3-${tag}`,
            taskId: ids.multi,
            status: "COMPLETED",
            coworkerId,
            transactionId: tx.multi900,
            cents: 900n * CREDIT,
            network: "mainnet",
            createdAt: at(-44),
          },
          {
            id: `ev-notx-1-${tag}`,
            taskId: ids.noTx,
            status: null,
            coworkerId,
            comment: SEO_PRICE_PENDING_COMMENT,
            transactionId: null,
            cents: null,
            network: null,
            createdAt: at(-42),
          },
          {
            id: `ev-notx-2-${tag}`,
            taskId: ids.noTx,
            status: "OUT_OF_CREDITS",
            coworkerId,
            transactionId: null,
            cents: 900n * CREDIT,
            network: "mainnet",
            createdAt: at(-40),
          },
          // Prior attempt and an eligible mainnet event that does not match `matched` criteria.
          {
            id: `ev-unmatched-attempt-${tag}`,
            taskId: ids.unmatched,
            status: "OUT_OF_CREDITS",
            coworkerId,
            transactionId: null,
            cents: 900n * CREDIT,
            network: "mainnet",
            createdAt: at(-38),
          },
          {
            id: `ev-unmatched-m-${tag}`,
            taskId: ids.unmatched,
            status: "RUNNING",
            coworkerId,
            transactionId: tx.unmatched900,
            cents: 100n * CREDIT,
            network: "mainnet",
            createdAt: at(-30),
          },
          // Codex collision fixture: 8 (mainnet) + 4 (untagged) = 12 credits.
          {
            id: `ev-codex-8-${tag}`,
            taskId: ids.codex,
            status: "RUNNING",
            coworkerId,
            transactionId: tx.codex8,
            cents: 8n * CREDIT,
            network: "mainnet",
            createdAt: at(-25),
          },
          {
            id: `ev-codex-4-${tag}`,
            taskId: ids.codex,
            status: "RUNNING",
            coworkerId,
            transactionId: tx.codex4,
            cents: 4n * CREDIT,
            network: null,
            createdAt: at(-20),
          },
        ],
      });
    }, SETUP_TIMEOUT);

    afterAll(async () => {
      await prisma.taskEvent.deleteMany({ where: { taskId: { in: taskIds } } });
      await prisma.projectSeoAnalysis.deleteMany({
        where: { id: { in: runIds } },
      });
      await prisma.seoAudit.deleteMany({ where: { id: { in: auditIds } } });
      await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
      await network
        .createNetworkScope("mainnet")
        .networkDb.transaction.deleteMany({ where: { id: { in: txIds } } });
      if (onSplitLayout) {
        await network
          .createNetworkScope("preprod")
          .networkDb.transaction.deleteMany({
            where: { id: { in: [...txIds, preprodOnlyTxId] } },
          });
      }
      await prisma.coworker.deleteMany({
        where: { id: { in: [coworkerId, otherCoworkerId] } },
      });
      await prisma.vendor.deleteMany({ where: { id: vendorId } });
      if (workspaceId) {
        await prisma.workspace.deleteMany({ where: { id: workspaceId } });
      }
      await prisma.user.deleteMany({ where: { id: userId } });
      vi.unstubAllEnvs();
    }, SETUP_TIMEOUT);

    it(
      "counts untagged and mainnet receipts and ignores Preprod collisions in both debit-evidence lookups and both orders",
      async () => {
        const clean = await snapshot();

        expect(clean.billing).toEqual({
          [ids.untagged]: {
            status: "settled",
            chargedCredits: 900,
            attemptedCredits: 900,
            cost: COST_900,
          },
          [ids.mainnet]: {
            status: "settled",
            chargedCredits: 900,
            attemptedCredits: 900,
            cost: COST_900,
          },
          [ids.multi]: {
            status: "settled",
            chargedCredits: 900,
            attemptedCredits: 900,
            cost: COST_900,
          },
          [ids.noTx]: {
            status: "needsCredits",
            chargedCredits: null,
            attemptedCredits: 900,
            cost: COST_900,
          },
          [ids.debitNoEvent]: {
            status: "inProgress",
            chargedCredits: null,
            attemptedCredits: null,
            cost: null,
          },
          [ids.unmatched]: {
            status: "unverified",
            chargedCredits: 900,
            attemptedCredits: 900,
            cost: null,
          },
          [ids.codex]: {
            status: "unverified",
            chargedCredits: 12,
            attemptedCredits: null,
            cost: null,
          },
        });
        expect(clean.alerts[ids.unmatched]).toEqual({
          severity: "critical",
          reasons: ["priceUnverified"],
        });
        expect(clean.directRows).toEqual([
          {
            run: "codex",
            charged_credits: "12.0000000000000000",
            attempted_credits: null,
            billing_status: "unverified",
          },
          {
            run: "mainnet",
            charged_credits: "900.0000000000000000",
            attempted_credits: "900.0000000000000000",
            billing_status: "settled",
          },
          {
            run: "unmatched",
            charged_credits: "900.0000000000000000",
            attempted_credits: "900.0000000000000000",
            billing_status: "unverified",
          },
          {
            run: "untagged",
            charged_credits: "900.0000000000000000",
            attempted_credits: "900.0000000000000000",
            billing_status: "settled",
          },
        ]);

        // Add Preprod collisions (Preprod events older than Mainnet/untagged events):
        // 1) Outer lookup: Preprod receipt on unattached 16-credit Mainnet debit (would raise 12 -> 28).
        // 2) Outer lookup: Preprod receipt on 4-credit Mainnet debit alongside untagged receipt.
        // 3) Inner `matched` lookup: Preprod COMPLETED receipt matching exact cents and approved worker
        //    on `unmatched` (would flip `unverified` -> `settled` if inner lookup omitted the predicate).
        const preprodEventIds = [
          `ev-preprod-codex16-${tag}`,
          `ev-preprod-codex4-${tag}`,
          `ev-preprod-unmatched-${tag}`,
        ];
        const preprodBase = Date.now();
        await prisma.taskEvent.createMany({
          data: [
            {
              id: preprodEventIds[0],
              taskId: ids.codex,
              status: "RUNNING",
              coworkerId,
              transactionId: tx.codex16,
              cents: 16n * CREDIT,
              network: "preprod",
              createdAt: new Date(preprodBase - 26_000),
            },
            {
              id: preprodEventIds[1],
              taskId: ids.codex,
              status: "RUNNING",
              coworkerId,
              transactionId: tx.codex4,
              cents: 4n * CREDIT,
              network: "preprod",
              createdAt: new Date(preprodBase - 22_000),
            },
            {
              id: preprodEventIds[2],
              taskId: ids.unmatched,
              status: "COMPLETED",
              coworkerId,
              transactionId: tx.unmatched900,
              cents: 900n * CREDIT,
              network: "preprod",
              createdAt: new Date(preprodBase - 35_000),
            },
          ],
        });

        try {
          const preprodOlder = await snapshot();
          expect(preprodOlder).toEqual(clean);

          // Reverse order: Preprod events newer than Mainnet/untagged events.
          await prisma.taskEvent.update({
            where: { id: preprodEventIds[1] },
            data: { createdAt: new Date(preprodBase - 15_000) },
          });
          await prisma.taskEvent.update({
            where: { id: preprodEventIds[2] },
            data: { createdAt: new Date(preprodBase - 25_000) },
          });

          const preprodNewer = await snapshot();
          expect(preprodNewer).toEqual(clean);

          if (onSplitLayout) {
            // Equal-id Preprod transactions with different amounts and a Preprod-only debit.
            const preprodDb = network.createNetworkScope("preprod").networkDb;
            await preprodDb.transaction.createMany({
              data: [
                { id: tx.codex16, amount: -48n * CREDIT, userId },
                { id: tx.codex4, amount: -24n * CREDIT, userId },
                { id: tx.mainnet900, amount: -1200n * CREDIT, userId },
                { id: preprodOnlyTxId, amount: -33n * CREDIT, userId },
              ],
            });

            const withSplitPreprodTxs = await snapshot();
            expect(withSplitPreprodTxs).toEqual(clean);
          }
        } finally {
          await prisma.taskEvent.deleteMany({
            where: { id: { in: preprodEventIds } },
          });
        }
      },
      CASE_TIMEOUT,
    );
  },
);
