/**
 * Slice 28-3 real-PostgreSQL proof suite:
 * - Signed Stripe (`/auth/stripe/webhook`) and Polar (`/v1/webhooks/polar`)
 *   deliveries using real HMAC signature verification on both today's layout
 *   and split layout (`shared`/`mainnet`/`preprod`), with header omitted and
 *   spoofed `X-Sokosumi-Network: preprod`.
 * - Replays, concurrent duplicate deliveries, multi-entry Stripe invoices,
 *   partial & out-of-order Polar refunds, plan changes, yearly installments,
 *   invalid signatures (0 DB writes / 0 provider calls), wake rollback, and
 *   dual-release (Prisma <-> raw SQL) compatibility on one DB.
 * - Equal-ID Mainnet vs Preprod collisions for CMO billing (`cmoPaidFor` in/out
 *   of tx, `isCmoProjectUnpaid`, `findUnpaidCusoHiredBy`, `grantCmoTesterCredits`
 *   races) and CMO chat work (`listCmoChatWork`, `readCmoChatWorkText`).
 * - Preprod refusal before any write for `grant`, `writeOff`,
 *   `findStripeInvoiceGrant`, and `cmoPaidFor`.
 * - Real PostgreSQL 6.25-second gated row-lock hold with `pg_blocking_pids`.
 * - 1,000-insert UUIDv7 monotonicity & cursor-paging tie check (real & fixed
 *   same-ms clocks), `@updatedAt` on `expireCreditBucketsNow`, and 1,000
 *   `createCompensatingRefund` + `writeOffUnlessLiveCuso` pairs proving strict
 *   `(createdAt ASC, id ASC)` refund-before-write-off ordering.
 */
import { createHmac, randomUUID } from "node:crypto";
import { CreditBucketReferenceType } from "@sokosumi/database";
import {
  expireCreditBucketsNow,
  insertCreditGrant,
} from "@sokosumi/database/helpers";
import { CMO_SOKO_BOT_VERSION_IDS } from "@sokosumi/soko-bot";
import { Hono } from "hono";
import { Client, type Pool, type PoolClient } from "pg";
import Stripe from "stripe";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { expectCoreLog } from "@/test/core-log";
import { copyPostgresTestDatabase } from "@/test/postgres-database-copy";
import { onSplitLayout } from "@/test/split-layout";

const STRIPE_WEBHOOK_SECRET = "whsec_test_28_3_stripe_secret";
const POLAR_WEBHOOK_SECRET = `polar_whs_${Buffer.from("28-3-polar-test-secret-bytes-32!").toString("base64")}`;
const CREDIT = 10_000_000_000n;
const DAY = 86_400_000;

const hoisted = vi.hoisted(() => ({
  pools: [] as Pool[],
  background: [] as Promise<unknown>[],
  statements: [] as { text: string; values: unknown[] }[],
  providerCalls: [] as string[],
  failAfterWake: false,
  holdCommitSql: null as null | {
    match: RegExp;
    reached: () => void;
    release: Promise<void>;
    pid: number | null;
  },
}));

vi.unmock("@/lib/db/prisma");
vi.mock("@vercel/functions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vercel/functions")>();
  return {
    ...actual,
    waitUntil: (work: Promise<unknown>) => {
      hoisted.background.push(work);
    },
    attachDatabasePool: (pool: Pool) => {
      hoisted.pools.push(pool);
      pool.on("connect", (client: PoolClient) => {
        const orig = client.query.bind(client) as (...a: unknown[]) => unknown;
        (client as { query: unknown }).query = (...args: unknown[]) => {
          const first = args[0];
          const text =
            typeof first === "string"
              ? first
              : first && typeof first === "object" && "text" in first
                ? String((first as { text: unknown }).text)
                : "";
          const values =
            typeof first === "string" && Array.isArray(args[1])
              ? args[1]
              : first &&
                  typeof first === "object" &&
                  "values" in first &&
                  Array.isArray((first as { values: unknown }).values)
                ? (first as { values: unknown[] }).values
                : [];
          hoisted.statements.push({ text, values });
          const gate = hoisted.holdCommitSql;
          if (gate && gate.match.test(text)) {
            hoisted.holdCommitSql = null;
            return (async () => {
              const pidRes = (await orig("SELECT pg_backend_pid() AS pid")) as {
                rows: Array<{ pid: number }>;
              };
              gate.pid = pidRes.rows[0]?.pid ?? null;
              gate.reached();
              await gate.release;
              return await orig(...args);
            })();
          }
          return orig(...args);
        };
      });
      actual.attachDatabasePool(pool);
    },
  };
});

vi.mock("@/services/ga4-measurement.service", () => ({
  reportPolarEventToGa4: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/helpers/background-email", () => ({
  sendEmailInBackground: vi.fn(),
}));
vi.mock("@/lib/ably/client", () => ({
  getRestClient: () => ({
    channels: {
      get: () => ({ publish: vi.fn().mockResolvedValue(undefined) }),
    },
  }),
}));
vi.mock("@/services/task-topup.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/task-topup.service")>();
  return {
    ...actual,
    markOutOfCreditsTasksAsToppedUp: async (
      params: Parameters<typeof actual.markOutOfCreditsTasksAsToppedUp>[0],
    ) => {
      await actual.markOutOfCreditsTasksAsToppedUp(params);
      if (hoisted.failAfterWake) {
        hoisted.failAfterWake = false;
        throw new Error("Simulated wake failure after top-up");
      }
    },
  };
});
vi.mock("@/services/subscription-catalog.service", () => ({
  getSubscriptionCatalog: async () => {
    hoisted.providerCalls.push("stripe.getSubscriptionCatalog");
    return {
      free: { productId: "prod_free_28_3", credits: 250, monthlyAmount: 0 },
      starter: {
        productId: "prod_starter_28_3",
        credits: 500,
        monthlyAmount: 2900,
      },
      standard: {
        productId: "prod_standard_28_3",
        credits: 1500,
        monthlyAmount: 7900,
      },
      pro: { productId: "prod_pro_28_3", credits: 4000, monthlyAmount: 19900 },
    };
  },
}));
vi.mock("@/clients/polar.client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/clients/polar.client")>();
  return {
    ...actual,
    // Keep REAL `verifyPolarWebhook` so standard-webhooks HMAC is verified end-to-end.
    listPolarProducts: async () => {
      hoisted.providerCalls.push("polar.listPolarProducts");
      return [
        {
          id: "prod_growth_month_28_3",
          name: "Growth",
          is_recurring: true,
          recurring_interval: "month",
          recurring_interval_count: 1,
          metadata: { kind: "plan", tier: "growth", credits: "25000" },
          prices: [
            {
              amount_type: "fixed",
              is_archived: false,
              price_amount: 10000,
              price_currency: "usd",
            },
          ],
        },
        {
          id: "prod_growth_year_28_3",
          name: "Growth yearly",
          is_recurring: true,
          recurring_interval: "year",
          recurring_interval_count: 1,
          metadata: { kind: "plan", tier: "growth", credits: "25000" },
          prices: [
            {
              amount_type: "fixed",
              is_archived: false,
              price_amount: 100000,
              price_currency: "usd",
            },
          ],
        },
      ];
    },
    revokePolarSubscription: async (id: string) => {
      hoisted.providerCalls.push(`polar.revoke:${id}`);
    },
  };
});
vi.mock("@/clients/stripe.client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/clients/stripe.client")>();
  const realStripe = actual.stripe;
  return {
    ...actual,
    stripe: {
      ...realStripe,
      webhooks: {
        constructEventAsync: async (
          payload: string,
          sig: string,
          secret: string,
        ) =>
          await realStripe.webhooks.constructEventAsync(payload, sig, secret),
        generateTestHeaderString:
          realStripe.webhooks.generateTestHeaderString.bind(
            realStripe.webhooks,
          ),
      },
    },
    stripeClient: {
      ...actual.stripeClient,
      retrieveCustomerBillingDetails: async () => {
        hoisted.providerCalls.push("stripe.retrieveCustomerBillingDetails");
        return { address: { country: "DE" } };
      },
      getAccountId: async () => {
        hoisted.providerCalls.push("stripe.getAccountId");
        return "acct_28_3";
      },
    },
  };
});

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

/** Extracts the 48-bit Unix ms timestamp from an RFC 9562 UUIDv7 string. */
function uuidV7Ms(id: string): number {
  const hex = id.replace(/-/g, "").slice(0, 12);
  return Number.parseInt(hex, 16);
}

/** Signs a Polar webhook payload using standard-webhooks HMAC-SHA256. */
function signPolarPayload(
  rawBody: string,
  secret: string,
  webhookId = `msg_${randomUUID()}`,
  timestampSec = Math.floor(Date.now() / 1000),
): Record<string, string> {
  // Polar's SDK passes the raw UTF-8 secret bytes into standard-webhooks Base64.
  const key = Buffer.from(secret, "utf8");
  const sig = createHmac("sha256", key)
    .update(`${webhookId}.${timestampSec}.${rawBody}`)
    .digest("base64");
  return {
    "webhook-id": webhookId,
    "webhook-timestamp": String(timestampSec),
    "webhook-signature": `v1,${sig}`,
    "content-type": "application/json",
  };
}

/** Signs a Stripe webhook payload using the real Stripe SDK HMAC generator. */
function signStripePayload(rawBody: string, secret: string): string {
  const s = new Stripe("sk_test_28_3_signing_only");
  return s.webhooks.generateTestHeaderString({
    payload: rawBody,
    secret,
  });
}

async function flushBackground(): Promise<void> {
  while (hoisted.background.length > 0) {
    await Promise.all(hoisted.background.splice(0));
  }
}

async function loadCore() {
  const [
    prismaMod,
    scopeMod,
    authMod,
    webhooksMod,
    errorHandlerMod,
    grantMod,
    writeOffMod,
    cmoBillingMod,
    cmoChatWorkMod,
    polarYearlyMod,
    compensatingRefundMod,
    cusoCreditsMod,
  ] = await Promise.all([
    import("@/lib/db/prisma"),
    import("@/lib/db/network-scope"),
    import("@/lib/auth"),
    import("@/routes/v1/webhooks/index"),
    import("@/helpers/error-handler"),
    import("@/lib/credits/grant"),
    import("@/lib/credits/write-off"),
    import("@/services/cmo-billing.service"),
    import("@/services/cmo-chat-work.service"),
    import("@/services/polar-yearly-grant-sync.service"),
    import("@/helpers/compensating-refund"),
    import("@/helpers/cuso-project-credits"),
  ]);

  const app = new Hono();
  app.onError(errorHandlerMod.errorHandler);
  app.on(["POST", "GET"], "/auth/*", (c) => authMod.auth.handler(c.req.raw));
  app.route("/v1/webhooks", webhooksMod.default);

  return {
    app,
    prisma: prismaMod.default,
    createNetworkScope: scopeMod.createNetworkScope,
    mainnet: () => scopeMod.createNetworkScope("mainnet").networkDb,
    preprod: () => scopeMod.createNetworkScope("preprod").networkDb,
    grant: grantMod.grant,
    findStripeInvoiceGrant: grantMod.findStripeInvoiceGrant,
    writeOff: writeOffMod.writeOff,
    cmoPaidFor: cmoBillingMod.cmoPaidFor,
    isCmoProjectUnpaid: cmoBillingMod.isCmoProjectUnpaid,
    findUnpaidCusoHiredBy: cmoBillingMod.findUnpaidCusoHiredBy,
    grantCmoTesterCredits: cmoBillingMod.grantCmoTesterCredits,
    listCmoChatWork: cmoChatWorkMod.listCmoChatWork,
    readCmoChatWorkText: cmoChatWorkMod.readCmoChatWorkText,
    syncPolarYearlyGrants: polarYearlyMod.syncPolarYearlyGrants,
    createCompensatingRefund: compensatingRefundMod.createCompensatingRefund,
    forfeitCusoProjectCredits: cusoCreditsMod.forfeitCusoProjectCredits,
  };
}

describe.runIf(enabled)(
  "Slice 28-3: CMO and paid-provider Mainnet storage (PostgreSQL)",
  () => {
    let copy: Awaited<ReturnType<typeof copyPostgresTestDatabase>>;
    let core: Awaited<ReturnType<typeof loadCore>>;

    beforeAll(async () => {
      const source =
        process.env.POSTGRES_TEST_TEMPLATE_URL ?? process.env.DATABASE_URL;
      if (!source) throw new Error("Missing DATABASE_URL");
      copy = await copyPostgresTestDatabase(source, "credit_grant_test");
      vi.stubEnv("TZ", "UTC");
      vi.stubEnv("DATABASE_URL", copy.url);
      vi.stubEnv("DATABASE_URL_UNPOOLED", copy.url);
      vi.stubEnv("STRIPE_WEBHOOK_SECRET", STRIPE_WEBHOOK_SECRET);
      vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_28_3_dummy");
      vi.stubEnv("STRIPE_CREDIT_PRODUCT_ID", "prod_credit_28_3");
      vi.stubEnv("STRIPE_FREE_SUBSCRIPTION_PRODUCT_ID", "prod_free_28_3");
      vi.stubEnv("STRIPE_STARTER_SUBSCRIPTION_PRODUCT_ID", "prod_starter_28_3");
      vi.stubEnv(
        "STRIPE_STANDARD_SUBSCRIPTION_PRODUCT_ID",
        "prod_standard_28_3",
      );
      vi.stubEnv("STRIPE_PRO_SUBSCRIPTION_PRODUCT_ID", "prod_pro_28_3");
      vi.stubEnv("POLAR_ACCESS_TOKEN", "polar_oat_28_3_dummy");
      vi.stubEnv("POLAR_WEBHOOK_SECRET", POLAR_WEBHOOK_SECRET);
      vi.stubEnv("POLAR_ENVIRONMENT", "sandbox");
      if (onSplitLayout) {
        vi.stubEnv("NETWORK_PREPROD_ENABLED", "true");
      }
      core = await loadCore();
    }, 120_000);

    afterAll(async () => {
      await Promise.all(hoisted.pools.map((pool) => pool.end()));
      vi.unstubAllEnvs();
      await copy?.drop();
    }, 120_000);

    async function makeOrgFixture(tag: string) {
      const uid = randomUUID();
      const orgId = `org-28-3-${tag}-${randomUUID().slice(0, 8)}`;
      const customerId = `cus_28_3_${tag}_${randomUUID().slice(0, 8)}`;
      await core.prisma.user.create({
        data: {
          id: uid,
          name: `User ${tag}`,
          email: `${uid}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await core.prisma.organization.create({
        data: {
          id: orgId,
          name: `Org ${tag}`,
          slug: orgId,
          stripeCustomerId: customerId,
          members: { create: { userId: uid, role: "owner" } },
        },
      });
      const workspace = await core.prisma.workspace.create({
        data: { organizationId: orgId },
        select: { id: true },
      });
      const project = await core.prisma.project.create({
        data: { workspaceId: workspace.id, name: `Project ${tag}` },
        select: { id: true },
      });
      const cuso = await core.prisma.sokoBot.create({
        data: {
          workspaceId: workspace.id,
          projectId: project.id,
          userId: null,
          createdByUserId: uid,
          versionId: CMO_SOKO_BOT_VERSION_IDS[0],
          name: "Cuso",
        },
        select: { id: true },
      });
      const task = await core.prisma.task.create({
        data: {
          name: `Task ${tag}`,
          status: "OUT_OF_CREDITS",
          ownerId: null,
          creatorUserId: uid,
          organizationId: orgId,
          projectId: project.id,
          workspaceId: workspace.id,
        },
        select: { id: true },
      });
      await core.prisma.notification.create({
        data: {
          userId: uid,
          kind: "TASK",
          referenceId: task.id,
          eventId: `ooc-${task.id}`,
          messageKey: "Notifications.Task.outOfCredits",
          messageParams: "{}",
        },
      });
      await core.prisma.notificationPreference.createMany({
        data: ["IN_APP", "OS_BANNER"].map((channel) => ({
          userId: uid,
          channel,
          category: "BILLING_UPDATE",
          enabled: false,
        })),
      });
      return {
        userId: uid,
        organizationId: orgId,
        customerId,
        workspaceId: workspace.id,
        projectId: project.id,
        cusoId: cuso.id,
        taskId: task.id,
      };
    }

    async function countLedgerRows(
      network: "mainnet" | "preprod",
      organizationId: string,
    ) {
      const db = core.createNetworkScope(network).networkDb;
      const [transactions, buckets, consumptions] = await Promise.all([
        db.transaction.findMany({ where: { organizationId } }),
        db.creditBucket.findMany({ where: { organizationId } }),
        db.creditConsumption.findMany({
          where: { transaction: { organizationId } },
        }),
      ]);
      return { transactions, buckets, consumptions };
    }

    describe("1. Signed Stripe invoice.paid deliveries", () => {
      function stripeInvoiceEvent(
        f: Awaited<ReturnType<typeof makeOrgFixture>>,
        invoiceId: string,
        opts: { multiEntry?: boolean } = {},
      ) {
        const lines = opts.multiEntry
          ? [
              {
                amount: 2900,
                quantity: 1,
                pricing: { price_details: { product: "prod_starter_28_3" } },
                period: { end: Math.floor((Date.now() + 30 * DAY) / 1000) },
              },
              {
                amount: 1000,
                quantity: 5,
                pricing: { price_details: { product: "prod_credit_28_3" } },
                period: { end: Math.floor((Date.now() + 30 * DAY) / 1000) },
              },
            ]
          : [
              {
                amount: 1000,
                quantity: 10,
                pricing: { price_details: { product: "prod_credit_28_3" } },
                period: { end: Math.floor((Date.now() + 30 * DAY) / 1000) },
              },
            ];
        return JSON.stringify({
          id: `evt_${invoiceId}`,
          object: "event",
          api_version: "2026-01-28.clover",
          created: Math.floor(Date.now() / 1000),
          type: "invoice.paid",
          data: {
            object: {
              id: invoiceId,
              object: "invoice",
              customer: f.customerId,
              created: Math.floor(Date.now() / 1000),
              amount_paid: 1000,
              amount_due: 1000,
              total: 1000,
              currency: "usd",
              status: "paid",
              livemode: false,
              billing_reason: opts.multiEntry ? "subscription_cycle" : "manual",
              metadata: {
                grant_source: "admin_one_time_credit",
                projectId: f.projectId,
              },
              lines: { data: lines },
            },
          },
        });
      }

      async function sendStripe(
        rawBody: string,
        opts: { header?: string; badSig?: boolean } = {},
      ) {
        const sig = opts.badSig
          ? "t=1700000000,v1=deadbeef"
          : signStripePayload(rawBody, STRIPE_WEBHOOK_SECRET);
        const headers: Record<string, string> = {
          "content-type": "application/json",
          "stripe-signature": sig,
        };
        if (opts.header) headers["x-sokosumi-network"] = opts.header;
        const res = await core.app.request("/auth/stripe/webhook", {
          method: "POST",
          headers,
          body: rawBody,
        });
        await flushBackground();
        return { status: res.status, body: await res.text() };
      }

      for (const header of [undefined, "preprod"] as const) {
        it(`delivers signed invoice.paid, wakes Task, leaves Preprod empty, and replays idempotently (header=${header ?? "omitted"})`, async () => {
          const f = await makeOrgFixture(`stripe-${header ?? "none"}`);
          const invoiceId = `in_28_3_${randomUUID().slice(0, 8)}`;
          const rawBody = stripeInvoiceEvent(f, invoiceId);

          const first = await sendStripe(rawBody, { header });
          expect(first.status).toBe(200);

          const mainRows = await countLedgerRows("mainnet", f.organizationId);
          expect(mainRows.transactions).toHaveLength(1);
          expect(mainRows.buckets).toHaveLength(1);
          expect(mainRows.buckets[0]?.amount).toBe(10n * CREDIT);
          expect(mainRows.buckets[0]?.referenceId).toBe(
            `org:${f.organizationId}:${invoiceId}:topup`,
          );
          expect(mainRows.buckets[0]?.referenceType).toBe("STRIPE_TOPUP");
          expect(mainRows.buckets[0]?.projectId).toBeNull();

          if (onSplitLayout) {
            const preRows = await countLedgerRows("preprod", f.organizationId);
            expect(preRows.transactions).toHaveLength(0);
            expect(preRows.buckets).toHaveLength(0);
          }

          const task = await core.prisma.task.findUniqueOrThrow({
            where: { id: f.taskId },
            select: { status: true },
          });
          expect(task.status).toBe("CREDITS_TOPPED_UP");

          const billingNotices = await core.prisma.notification.findMany({
            where: { userId: f.userId, kind: "BILLING" },
          });
          expect(billingNotices).toHaveLength(1);

          // Replay must keep exact original paid total and create zero rows
          const replay = await sendStripe(rawBody, { header });
          expect(replay.status).toBe(200);
          const afterReplay = await countLedgerRows(
            "mainnet",
            f.organizationId,
          );
          expect(afterReplay.transactions).toHaveLength(1);
          expect(afterReplay.buckets).toHaveLength(1);
        }, 30_000);
      }

      it("handles multi-entry invoice, concurrent duplicate deliveries, invalid signature, wake rollback, and dual-release replay", async () => {
        // 1. Invalid signature -> 400, 0 DB writes, 0 provider calls
        const fBad = await makeOrgFixture("stripe-badsig");
        hoisted.statements.splice(0);
        hoisted.providerCalls.splice(0);
        const badRes = await sendStripe(
          stripeInvoiceEvent(fBad, `in_bad_${randomUUID().slice(0, 8)}`),
          { badSig: true, header: "preprod" },
        );
        expect(badRes.status).toBe(400);
        expect(hoisted.providerCalls).toEqual([]);
        const badRows = await countLedgerRows("mainnet", fBad.organizationId);
        expect(badRows.buckets).toHaveLength(0);
        expectCoreLog(
          "error",
          "No signatures found matching the expected signature",
          1,
        );

        // 2. Multi-entry invoice + replay
        const fMulti = await makeOrgFixture("stripe-multi");
        const multiId = `in_multi_${randomUUID().slice(0, 8)}`;
        const multiBody = stripeInvoiceEvent(fMulti, multiId, {
          multiEntry: true,
        });
        expect((await sendStripe(multiBody)).status).toBe(200);
        const multiRows = await countLedgerRows(
          "mainnet",
          fMulti.organizationId,
        );
        expect(multiRows.buckets).toHaveLength(2);
        expect(multiRows.transactions).toHaveLength(2);
        expect(multiRows.buckets.reduce((acc, b) => acc + b.amount, 0n)).toBe(
          505n * CREDIT,
        );
        expect((await sendStripe(multiBody)).status).toBe(200);
        expect(
          (await countLedgerRows("mainnet", fMulti.organizationId)).buckets,
        ).toHaveLength(2);

        // 3. Concurrent duplicate signed deliveries -> exactly 1 grant survives
        const fRace = await makeOrgFixture("stripe-race");
        const raceId = `in_race_${randomUUID().slice(0, 8)}`;
        const raceBody = stripeInvoiceEvent(fRace, raceId);
        const [r1, r2] = await Promise.all([
          sendStripe(raceBody),
          sendStripe(raceBody),
        ]);
        expect([r1.status, r2.status]).toContain(200);
        const raceRows = await countLedgerRows("mainnet", fRace.organizationId);
        expect(raceRows.buckets).toHaveLength(1);
        expect(raceRows.transactions).toHaveLength(1);

        // 4. Wake rollback rolls back grant, bucket, and Task wake atomically
        const fRoll = await makeOrgFixture("stripe-rollback");
        hoisted.failAfterWake = true;
        const rollRes = await sendStripe(
          stripeInvoiceEvent(fRoll, `in_roll_${randomUUID().slice(0, 8)}`),
        );
        expect(rollRes.status).not.toBe(200);
        const rollRows = await countLedgerRows("mainnet", fRoll.organizationId);
        expect(rollRows.buckets).toHaveLength(0);
        expect(rollRows.transactions).toHaveLength(0);
        const rollTask = await core.prisma.task.findUniqueOrThrow({
          where: { id: fRoll.taskId },
          select: { status: true },
        });
        expect(rollTask.status).toBe("OUT_OF_CREDITS");

        // 5. Dual-release compatibility: Prisma-written bucket is recognized on replay,
        //    and raw-SQL-written bucket is found by Prisma `findStripeInvoiceGrant`.
        const fDual = await makeOrgFixture("stripe-dual");
        const oldInvoiceId = `in_old_${randomUUID().slice(0, 8)}`;
        await core.mainnet().transaction.create({
          data: {
            amount: 10n * CREDIT,
            organizationId: fDual.organizationId,
            userId: null,
            sourceCreditBucket: {
              create: {
                amount: 10n * CREDIT,
                organizationId: fDual.organizationId,
                userId: null,
                projectId: fDual.projectId,
                referenceId: `org:${fDual.organizationId}:${oldInvoiceId}:topup`,
                referenceType: CreditBucketReferenceType.STRIPE_TOPUP,
                expiresAt: null,
              },
            },
          },
        });
        expect(
          (await sendStripe(stripeInvoiceEvent(fDual, oldInvoiceId))).status,
        ).toBe(200);
        const dualRows = await countLedgerRows("mainnet", fDual.organizationId);
        expect(dualRows.buckets).toHaveLength(1);
        const found = await core.findStripeInvoiceGrant(
          core.createNetworkScope("mainnet"),
          {
            owner: { organizationId: fDual.organizationId },
            invoiceId: oldInvoiceId,
            entry: "topup",
          },
          CreditBucketReferenceType.STRIPE_TOPUP,
        );
        expect(found?.id).toBe(dualRows.buckets[0]?.id);
        expectCoreLog("error", "Stripe webhook failed.", 2);
      }, 60_000);
    });

    describe("2. Signed Polar webhook deliveries, refunds, yearly installments, and dual-release", () => {
      function polarOrderPaidBody(
        f: Awaited<ReturnType<typeof makeOrgFixture>>,
        orderId: string,
        subId: string,
        opts: {
          billingReason?:
            | "subscription_create"
            | "purchase"
            | "subscription_update";
          interval?: "month" | "year";
        } = {},
      ) {
        const now = Date.now();
        const start = new Date(now - 60_000);
        const end = new Date(now + (opts.interval === "year" ? 365 : 30) * DAY);
        const isTopUp = opts.billingReason === "purchase";
        return JSON.stringify({
          type: "order.paid",
          timestamp: new Date(now - 10_000).toISOString(),
          data: {
            id: orderId,
            created_at: new Date(now - 30_000).toISOString(),
            modified_at: null,
            status: "paid",
            paid: true,
            subtotal_amount: 10000,
            discount_amount: 0,
            net_amount: 10000,
            tax_amount: 0,
            total_amount: 10000,
            applied_balance_amount: 0,
            due_amount: 0,
            refunded_amount: 0,
            refunded_tax_amount: 0,
            currency: "usd",
            billing_reason: opts.billingReason ?? "subscription_create",
            billing_name: null,
            billing_address: null,
            invoice_number: `INV-${orderId}`,
            is_invoice_generated: true,
            customer_id: "cus_polar_28_3",
            product_id: isTopUp
              ? "prod_topup_28_3"
              : opts.interval === "year"
                ? "prod_growth_year_28_3"
                : "prod_growth_month_28_3",
            discount_id: null,
            subscription_id: isTopUp ? null : subId,
            checkout_id: null,
            metadata: {
              kind: isTopUp ? "top-up" : "plan",
              projectId: f.projectId,
              organizationId: f.organizationId,
              userId: f.userId,
            },
            custom_field_data: {},
            platform_fee_amount: 0,
            platform_fee_currency: null,
            customer: {
              id: "cus_polar_28_3",
              created_at: start.toISOString(),
              modified_at: null,
              metadata: {},
              external_id: f.organizationId,
              email: "owner@example.test",
              email_verified: true,
              name: "Owner",
              billing_address: null,
              tax_id: null,
              organization_id: "polar_org_1",
              deleted_at: null,
              avatar_url: "https://example.test/a.png",
            },
            user_id: "polar_u_1",
            product: isTopUp
              ? {
                  id: "prod_topup_28_3",
                  created_at: start.toISOString(),
                  modified_at: null,
                  name: "5,000 credits",
                  description: null,
                  recurring_interval: null,
                  is_recurring: false,
                  is_archived: false,
                  organization_id: "polar_org_1",
                  metadata: { kind: "top-up", credits: "5000" },
                }
              : {
                  id:
                    opts.interval === "year"
                      ? "prod_growth_year_28_3"
                      : "prod_growth_month_28_3",
                  created_at: start.toISOString(),
                  modified_at: null,
                  name: "Growth",
                  description: null,
                  recurring_interval: opts.interval ?? "month",
                  is_recurring: true,
                  is_archived: false,
                  organization_id: "polar_org_1",
                  metadata: { kind: "plan", tier: "growth", credits: "25000" },
                },
            discount: null,
            subscription: isTopUp
              ? null
              : {
                  id: subId,
                  created_at: start.toISOString(),
                  modified_at: null,
                  amount: 10000,
                  currency: "usd",
                  recurring_interval: opts.interval ?? "month",
                  status: "active",
                  current_period_start: start.toISOString(),
                  current_period_end: end.toISOString(),
                  cancel_at_period_end: false,
                  canceled_at: null,
                  started_at: start.toISOString(),
                  ends_at: null,
                  ended_at: null,
                  customer_id: "cus_polar_28_3",
                  product_id:
                    opts.interval === "year"
                      ? "prod_growth_year_28_3"
                      : "prod_growth_month_28_3",
                  discount_id: null,
                  checkout_id: null,
                  customer_cancellation_reason: null,
                  customer_cancellation_comment: null,
                  metadata:
                    opts.billingReason === "subscription_update"
                      ? { upgradeFromCredits: "10000" }
                      : {},
                },
            items: isTopUp
              ? []
              : [
                  {
                    id: `item_${orderId}`,
                    created_at: start.toISOString(),
                    modified_at: null,
                    label: "Growth",
                    amount: 10000,
                    tax_amount: 0,
                    proration: false,
                    product_price_id: "price_1",
                    start_timestamp: start.toISOString(),
                    end_timestamp: end.toISOString(),
                  },
                ],
            description: "Growth",
          },
        });
      }

      function polarOrderRefundedBody(orderId: string) {
        const now = new Date();
        return JSON.stringify({
          type: "order.refunded",
          timestamp: now.toISOString(),
          data: {
            id: orderId,
            created_at: now.toISOString(),
            modified_at: null,
            status: "refunded",
            paid: true,
            subtotal_amount: 10000,
            discount_amount: 0,
            net_amount: 10000,
            tax_amount: 0,
            total_amount: 10000,
            applied_balance_amount: 0,
            due_amount: 0,
            refunded_amount: 10000,
            refunded_tax_amount: 0,
            currency: "usd",
            billing_reason: "subscription_create",
            billing_name: null,
            billing_address: null,
            invoice_number: `INV-${orderId}`,
            is_invoice_generated: true,
            customer_id: "cus_polar_28_3",
            product_id: "prod_growth_month_28_3",
            discount_id: null,
            subscription_id: null,
            checkout_id: null,
            metadata: {},
            custom_field_data: {},
            platform_fee_amount: 0,
            platform_fee_currency: null,
            customer: {
              id: "cus_polar_28_3",
              created_at: now.toISOString(),
              modified_at: null,
              metadata: {},
              external_id: null,
              email: "owner@example.test",
              email_verified: true,
              name: "Owner",
              billing_address: null,
              tax_id: null,
              organization_id: "polar_org_1",
              deleted_at: null,
              avatar_url: "https://example.test/a.png",
            },
            user_id: "polar_u_1",
            product: null,
            discount: null,
            subscription: null,
            items: [],
            description: "Refund",
          },
        });
      }

      async function sendPolar(
        rawBody: string,
        opts: { header?: string; badSig?: boolean } = {},
      ) {
        const headers = signPolarPayload(
          rawBody,
          opts.badSig ? "wrong_secret" : POLAR_WEBHOOK_SECRET,
        );
        if (opts.header) headers["x-sokosumi-network"] = opts.header;
        const res = await core.app.request("/v1/webhooks/polar", {
          method: "POST",
          headers,
          body: rawBody,
        });
        await flushBackground();
        return { status: res.status, body: await res.text() };
      }

      for (const header of [undefined, "preprod"] as const) {
        it(`delivers signed Polar order.paid, wakes Task, leaves Preprod empty, and replays idempotently (header=${header ?? "omitted"})`, async () => {
          const f = await makeOrgFixture(`polar-${header ?? "none"}`);
          const orderId = `ord_28_3_${randomUUID().slice(0, 8)}`;
          const subId = `sub_28_3_${randomUUID().slice(0, 8)}`;
          const rawBody = polarOrderPaidBody(f, orderId, subId);

          const res = await sendPolar(rawBody, { header });
          expect(res.status).toBe(200);

          const mainRows = await countLedgerRows("mainnet", f.organizationId);
          expect(mainRows.transactions).toHaveLength(1);
          expect(mainRows.buckets).toHaveLength(1);
          expect(mainRows.buckets[0]?.amount).toBe(25_000n * CREDIT);
          expect(mainRows.buckets[0]?.referenceId).toBe(`${orderId}:0`);

          const orderRow = await core.prisma.polarOrder.findUnique({
            where: { polarOrderId: orderId },
          });
          expect(orderRow).not.toBeNull();
          const subRow = await core.prisma.polarSubscription.findUnique({
            where: { polarSubscriptionId: subId },
          });
          expect(subRow?.lastPaidOrderId).toBe(orderId);

          if (onSplitLayout) {
            const preRows = await countLedgerRows("preprod", f.organizationId);
            expect(preRows.transactions).toHaveLength(0);
            expect(preRows.buckets).toHaveLength(0);
          }

          const task = await core.prisma.task.findUniqueOrThrow({
            where: { id: f.taskId },
            select: { status: true },
          });
          expect(task.status).toBe("CREDITS_TOPPED_UP");

          // Replay adds 0 rows
          expect((await sendPolar(rawBody, { header })).status).toBe(200);
          expect(
            (await countLedgerRows("mainnet", f.organizationId)).buckets,
          ).toHaveLength(1);
        }, 30_000);
      }

      it("verifies invalid Polar signature (403, 0 DB/provider calls), partial refund write-off without touching equal-ID Preprod bucket, out-of-order refund, top-up, and yearly installments", async () => {
        // 1. Invalid signature -> 403, ZERO DB statements, ZERO provider calls
        hoisted.statements.splice(0);
        hoisted.providerCalls.splice(0);
        const badRes = await sendPolar(polarOrderRefundedBody("ord_bad"), {
          badSig: true,
          header: "preprod",
        });
        expect(badRes.status).toBe(403);
        expect(hoisted.statements).toEqual([]);
        expect(hoisted.providerCalls).toEqual([]);

        // 2. Paid plan + partial spend + refund writes off ONLY Mainnet unspent balance,
        //    leaving an equal-referenceId Preprod bucket completely untouched!
        const f = await makeOrgFixture("polar-refund-iso");
        const orderId = `ord_ref_${randomUUID().slice(0, 8)}`;
        const subId = `sub_ref_${randomUUID().slice(0, 8)}`;
        expect(
          (await sendPolar(polarOrderPaidBody(f, orderId, subId))).status,
        ).toBe(200);

        const mainBefore = await countLedgerRows("mainnet", f.organizationId);
        const mainBucket = mainBefore.buckets[0];
        expect(mainBucket).toBeDefined();

        // Spend 7,000 credits on Mainnet (leaving 18,000 remaining)
        await core.mainnet().transaction.create({
          data: {
            amount: -7_000n * CREDIT,
            organizationId: f.organizationId,
            userId: null,
            creditConsumptions: {
              create: { amount: 7_000n * CREDIT, bucketId: mainBucket!.id },
            },
          },
        });

        // On split layout, seed a colliding Preprod bucket with the EXACT same id & referenceId
        if (onSplitLayout) {
          await core.preprod().transaction.create({
            data: {
              id: mainBefore.transactions[0]!.id,
              amount: 99_000n * CREDIT,
              organizationId: f.organizationId,
              userId: null,
              sourceCreditBucket: {
                create: {
                  id: mainBucket!.id,
                  amount: 99_000n * CREDIT,
                  organizationId: f.organizationId,
                  userId: null,
                  projectId: f.projectId,
                  referenceId: `${orderId}:0`,
                  referenceType:
                    CreditBucketReferenceType.POLAR_SUBSCRIPTION_MONTH,
                  expiresAt: new Date(Date.now() + 30 * DAY),
                },
              },
            },
          });
        }

        // Send signed order.refunded with spoofed preprod header
        expect(
          (
            await sendPolar(polarOrderRefundedBody(orderId), {
              header: "preprod",
            })
          ).status,
        ).toBe(200);

        const mainAfter = await countLedgerRows("mainnet", f.organizationId);
        // Original grant (+25,000), spend (-7,000), write-off (-18,000)
        expect(mainAfter.transactions).toHaveLength(3);
        expect(
          mainAfter.transactions.reduce((acc, t) => acc + t.amount, 0n),
        ).toBe(0n);
        expect(mainAfter.consumptions).toHaveLength(2);

        if (onSplitLayout) {
          // Preprod colliding bucket MUST have 0 consumptions written off!
          const preAfter = await countLedgerRows("preprod", f.organizationId);
          expect(preAfter.transactions).toHaveLength(1);
          expect(preAfter.consumptions).toHaveLength(0);
        }

        // 3. Out-of-order refund arriving BEFORE order.paid prevents granting
        const fOoo = await makeOrgFixture("polar-ooo");
        const oooOrder = `ord_ooo_${randomUUID().slice(0, 8)}`;
        const oooSub = `sub_ooo_${randomUUID().slice(0, 8)}`;
        expect((await sendPolar(polarOrderRefundedBody(oooOrder))).status).toBe(
          200,
        );
        expect(
          (await sendPolar(polarOrderPaidBody(fOoo, oooOrder, oooSub))).status,
        ).toBe(200);
        expect(
          (await countLedgerRows("mainnet", fOoo.organizationId)).buckets,
        ).toHaveLength(0);

        // 4. Top-up purchase on active subscription
        const topUpOrder = `ord_topup_${randomUUID().slice(0, 8)}`;
        expect(
          (
            await sendPolar(
              polarOrderPaidBody(f, topUpOrder, subId, {
                billingReason: "purchase",
              }),
            )
          ).status,
        ).toBe(200);
        const afterTopUp = await countLedgerRows("mainnet", f.organizationId);
        expect(
          afterTopUp.buckets.some(
            (b) =>
              b.referenceId === `${topUpOrder}:0` &&
              b.referenceType === "PROJECT_TOP_UP" &&
              b.amount === 5_000n * CREDIT,
          ),
        ).toBe(true);

        // 5. Yearly installment sync finds Prisma-written month 0 and grants month 1 on Mainnet
        const fYear = await makeOrgFixture("polar-yearly");
        const yearOrder = `ord_yr_${randomUUID().slice(0, 8)}`;
        const yearSub = `sub_yr_${randomUUID().slice(0, 8)}`;
        const start = new Date(Date.now() - 40 * DAY);
        await core.prisma.polarSubscription.create({
          data: {
            kind: "CMO",
            projectId: fYear.projectId,
            organizationId: fYear.organizationId,
            polarSubscriptionId: yearSub,
            polarProductId: "prod_growth_year_28_3",
            tier: "growth",
            interval: "year",
            status: "active",
            currentPeriodStart: start,
            currentPeriodEnd: new Date(start.getTime() + 365 * DAY),
            lastPaidOrderId: yearOrder,
            lastPaidAt: start,
            polarEventAt: start,
          },
        });
        // Seed month 0 via legacy Prisma (dual-release check)
        await core.mainnet().transaction.create({
          data: {
            amount: 25_000n * CREDIT,
            organizationId: fYear.organizationId,
            userId: null,
            sourceCreditBucket: {
              create: {
                amount: 25_000n * CREDIT,
                organizationId: fYear.organizationId,
                userId: null,
                projectId: fYear.projectId,
                referenceId: `${yearOrder}:0`,
                referenceType:
                  CreditBucketReferenceType.POLAR_SUBSCRIPTION_MONTH,
                expiresAt: new Date(start.getTime() + 30 * DAY),
              },
            },
          },
        });
        await core.syncPolarYearlyGrants(() => true);
        const yearBuckets = (
          await countLedgerRows("mainnet", fYear.organizationId)
        ).buckets;
        expect(yearBuckets.map((b) => b.referenceId).sort()).toEqual([
          `${yearOrder}:0`,
          `${yearOrder}:1`,
        ]);
        // Replay sync grants nothing more
        await core.syncPolarYearlyGrants(() => true);
        expect(
          (await countLedgerRows("mainnet", fYear.organizationId)).buckets,
        ).toHaveLength(2);
      }, 60_000);
    });

    describe("3. Equal-ID Mainnet vs Preprod collisions, CMO billing, chat-work Job, and Preprod refusals", () => {
      it("isolates CMO paid/unpaid/tester checks and chat-work Job reads strictly to Mainnet even under equal-ID Preprod collisions", async () => {
        const fPreprodOnly = await makeOrgFixture("cmo-preprod-only");
        const fMainnetOnly = await makeOrgFixture("cmo-mainnet-only");
        const collidingBucketId = uuidv7();
        const collidingRef = `tester-collide-${randomUUID().slice(0, 8)}`;

        // Seed paid/tester bucket ONLY on Preprod for fPreprodOnly (on split layout)
        if (onSplitLayout) {
          await core.preprod().transaction.create({
            data: {
              amount: 1000n * CREDIT,
              organizationId: fPreprodOnly.organizationId,
              userId: null,
              sourceCreditBucket: {
                create: {
                  id: collidingBucketId,
                  amount: 1000n * CREDIT,
                  organizationId: fPreprodOnly.organizationId,
                  userId: null,
                  projectId: fPreprodOnly.projectId,
                  referenceId: collidingRef,
                  referenceType: CreditBucketReferenceType.CMO_TESTER_CREDITS,
                  expiresAt: new Date(Date.now() + 30 * DAY),
                },
              },
            },
          });
          // fPreprodOnly MUST still be unpaid on Mainnet (both in-tx and out-of-tx)!
          expect(await core.isCmoProjectUnpaid(fPreprodOnly.projectId)).toBe(
            true,
          );
          expect(await core.findUnpaidCusoHiredBy(fPreprodOnly.userId)).toEqual(
            {
              projectId: fPreprodOnly.projectId,
              businessName: "",
            },
          );
          expect(
            await core.cmoPaidFor(
              fPreprodOnly.projectId,
              new Date(),
              core.createNetworkScope("mainnet"),
            ),
          ).toEqual({
            subscribed: false,
            tier: null,
            testerCreditsLeft: false,
          });
          const inTxPre = await core.prisma.$transaction((tx) =>
            core.cmoPaidFor(
              fPreprodOnly.projectId,
              new Date(),
              core.createNetworkScope("mainnet"),
              tx,
            ),
          );
          expect(inTxPre).toEqual({
            subscribed: false,
            tier: null,
            testerCreditsLeft: false,
          });
        }

        // Seed colliding bucket on BOTH Networks for fMainnetOnly:
        // Mainnet has valid live bucket; Preprod has expired/empty bucket of same ID
        const sharedBucketId = uuidv7();
        await core.mainnet().transaction.create({
          data: {
            amount: 1000n * CREDIT,
            organizationId: fMainnetOnly.organizationId,
            userId: null,
            sourceCreditBucket: {
              create: {
                id: sharedBucketId,
                amount: 1000n * CREDIT,
                organizationId: fMainnetOnly.organizationId,
                userId: null,
                projectId: fMainnetOnly.projectId,
                referenceId: `main-${sharedBucketId}`,
                referenceType: CreditBucketReferenceType.CMO_TESTER_CREDITS,
                expiresAt: new Date(Date.now() + 30 * DAY),
              },
            },
          },
        });
        if (onSplitLayout) {
          await core.preprod().transaction.create({
            data: {
              amount: 1n * CREDIT,
              organizationId: fMainnetOnly.organizationId,
              userId: null,
              sourceCreditBucket: {
                create: {
                  id: sharedBucketId,
                  amount: 1n * CREDIT,
                  organizationId: fMainnetOnly.organizationId,
                  userId: null,
                  projectId: fMainnetOnly.projectId,
                  referenceId: `main-${sharedBucketId}`,
                  referenceType: CreditBucketReferenceType.CMO_TESTER_CREDITS,
                  expiresAt: new Date(Date.now() - DAY),
                },
              },
            },
          });
        }
        expect(await core.isCmoProjectUnpaid(fMainnetOnly.projectId)).toBe(
          false,
        );
        expect(
          await core.findUnpaidCusoHiredBy(fMainnetOnly.userId),
        ).toBeNull();
        expect(
          await core.cmoPaidFor(
            fMainnetOnly.projectId,
            new Date(),
            core.createNetworkScope("mainnet"),
          ),
        ).toEqual({
          subscribed: false,
          tier: null,
          testerCreditsLeft: true,
        });
        const inTxMain = await core.prisma.$transaction((tx) =>
          core.cmoPaidFor(
            fMainnetOnly.projectId,
            new Date(),
            core.createNetworkScope("mainnet"),
            tx,
          ),
        );
        expect(inTxMain).toEqual({
          subscribed: false,
          tier: null,
          testerCreditsLeft: true,
        });

        // CMO chat-work Job equal-ID collision: Mainnet vs Preprod Job with SAME Job ID!
        const jobId = randomUUID();
        const agentId = randomUUID();
        const pricingId = randomUUID();
        const turn = await core.prisma.sokoBotTurn.create({
          data: {
            sokoBotId: fMainnetOnly.cusoId,
            workspaceId: fMainnetOnly.workspaceId,
            requestedByUserId: fMainnetOnly.userId,
            clientTurnId: `turn-${randomUUID()}`,
            source: "CHAT",
            status: "COMPLETED",
            userMessage: "Research market",
            capabilityNames: ["hire_agent"],
            deadlineAt: new Date(Date.now() + 60_000),
          },
          select: { id: true },
        });
        const callId = randomUUID();
        await core.prisma.sokoBotToolCall.create({
          data: {
            id: callId,
            turnId: turn.id,
            toolCallId: `tc-${callId}`,
            capability: "hire_agent",
            status: "COMPLETED",
            input: { prompt: "Research market" },
            inputHash: "hash-28-3",
            result: { resultingEntityId: jobId },
          },
        });
        await core.mainnet().agent.create({
          data: {
            id: agentId,
            blockchainIdentifier: `main-bc-${agentId}`,
            name: "Mainnet Research Agent",
            isShown: true,
            lastUptimeCheck: new Date(),
            uptimeCount: 1,
            uptimeCheckCount: 1,
            pricing: { create: { id: pricingId, pricingType: "FREE" } },
          },
        });
        await core.mainnet().job.create({
          data: {
            id: jobId,
            agentId,
            agentJobId: `aj-main-${jobId}`,
            jobType: "FREE",
            name: "Mainnet Job Title",
            workspaceId: fMainnetOnly.workspaceId,
            ownerId: fMainnetOnly.userId,
            organizationId: fMainnetOnly.organizationId,
            projectId: fMainnetOnly.projectId,
            events: {
              create: {
                status: "COMPLETED",
                result: "MAINNET_SECRET_REPORT_42",
              },
            },
          },
        });
        if (onSplitLayout) {
          await core.preprod().agent.create({
            data: {
              id: agentId,
              blockchainIdentifier: `pre-bc-${agentId}`,
              name: "PREPROD FAKE AGENT",
              isShown: true,
              lastUptimeCheck: new Date(),
              uptimeCount: 1,
              uptimeCheckCount: 1,
              pricing: { create: { id: pricingId, pricingType: "FREE" } },
            },
          });
          await core.preprod().job.create({
            data: {
              id: jobId,
              agentId,
              agentJobId: `aj-pre-${jobId}`,
              jobType: "FREE",
              name: "PREPROD POISON TITLE",
              workspaceId: fMainnetOnly.workspaceId,
              ownerId: fMainnetOnly.userId,
              organizationId: fMainnetOnly.organizationId,
              projectId: fMainnetOnly.projectId,
              events: {
                create: {
                  status: "COMPLETED",
                  result: "PREPROD_POISON_OUTPUT",
                },
              },
            },
          });
        }

        const workItems = await core.listCmoChatWork({
          userId: fMainnetOnly.userId,
          projectId: fMainnetOnly.projectId,
        });
        const agentItem = workItems.find((item) => item.id === callId);
        expect(agentItem).toBeDefined();
        expect(agentItem?.by).toBe("Mainnet Research Agent");
        expect(agentItem?.title).toBe("Mainnet Job Title");
        expect(agentItem?.text).toContain("MAINNET_SECRET_REPORT_42");
        expect(agentItem?.text).not.toContain("PREPROD");

        const fullText = await core.readCmoChatWorkText({
          userId: fMainnetOnly.userId,
          projectId: fMainnetOnly.projectId,
          id: callId,
        });
        expect(fullText).toBe("MAINNET_SECRET_REPORT_42");

        // Race: grantCmoTesterCredits vs Serializable Cuso archive (with retry on 40001)
        const fArchiveRace = await makeOrgFixture("tester-archive-race");
        const archiveWithRetry = async () => {
          for (let attempt = 0; attempt < 5; attempt++) {
            try {
              await core.prisma.$transaction(
                async (tx) => {
                  await core.forfeitCusoProjectCredits(fArchiveRace.cusoId, tx);
                  await tx.sokoBot.update({
                    where: { id: fArchiveRace.cusoId },
                    data: { archivedAt: new Date() },
                  });
                },
                { isolationLevel: "Serializable" },
              );
              return;
            } catch (error) {
              const code =
                error && typeof error === "object" && "code" in error
                  ? String((error as { code: unknown }).code)
                  : "";
              if (code === "P2034" && attempt < 4) continue;
              throw error;
            }
          }
        };
        await Promise.allSettled([
          core.grantCmoTesterCredits({
            projectId: fArchiveRace.projectId,
            organizationId: fArchiveRace.organizationId,
          }),
          archiveWithRetry(),
        ]);
        // Regardless of winner order, net remaining credits on archived Cuso MUST be 0!
        const raceLedger = await countLedgerRows(
          "mainnet",
          fArchiveRace.organizationId,
        );
        expect(
          raceLedger.transactions.reduce((acc, t) => acc + t.amount, 0n),
        ).toBe(0n);

        // Preprod refusals before any write (0 DB statements after scope refusal)
        const preprodScope = onSplitLayout
          ? core.createNetworkScope("preprod")
          : ({
              network: "preprod",
              sharedDb: core.prisma,
              networkDb: core.mainnet(),
            } as unknown as ReturnType<typeof core.createNetworkScope>);
        hoisted.statements.splice(0);
        await expect(
          core.grant({
            scope: preprodScope as unknown as Parameters<
              typeof core.grant
            >[0]["scope"],
            tx: core.prisma,
            kind: "free",
            target: {
              targetType: "organization",
              organizationId: fMainnetOnly.organizationId,
            },
            credits: 100,
            expiresAt: null,
            grantId: "refused-grant",
            note: null,
            wakeTasks: false,
          }),
        ).rejects.toThrow();
        await expect(
          core.writeOff({
            scope: preprodScope as unknown as Parameters<
              typeof core.writeOff
            >[0]["scope"],
            tx: core.prisma,
            of: { projectId: fMainnetOnly.projectId },
          }),
        ).rejects.toThrow();
        expect(() =>
          core.findStripeInvoiceGrant(
            preprodScope,
            {
              owner: { organizationId: fMainnetOnly.organizationId },
              invoiceId: "in_refused",
              entry: "topup",
            },
            CreditBucketReferenceType.STRIPE_TOPUP,
          ),
        ).toThrow();
        await expect(
          core.cmoPaidFor(fMainnetOnly.projectId, new Date(), preprodScope),
        ).rejects.toThrow();
        expect(hoisted.statements).toEqual([]);
      }, 60_000);
    });

    describe("4. Real PostgreSQL 6.25-second gated row-lock hold", () => {
      it("proves real blocker and waiter via pg_blocking_pids across a 6.25s lock hold, then commits exactly one grant", async () => {
        const f = await makeOrgFixture("lock-hold-625");
        const refId = `lock-625-${randomUUID()}`;
        let releaseFirst = () => {};
        let firstHeld = () => {};
        const reached = new Promise<void>((resolve) => {
          firstHeld = resolve;
        });
        const release = new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        const gate = {
          match: /^\s*COMMIT\b/i,
          reached: () => firstHeld(),
          release,
          pid: null as number | null,
        };
        hoisted.holdCommitSql = gate;

        const runGrant = () =>
          core.prisma.$transaction((tx) =>
            insertCreditGrant(
              {
                amount: 100n * CREDIT,
                userId: null,
                organizationId: f.organizationId,
                projectId: f.projectId,
                expiresAt: null,
                referenceId: refId,
                referenceType: CreditBucketReferenceType.STRIPE_TOPUP,
                referenceNote: "lock hold proof",
                mintId: uuidv7,
                network: "mainnet",
              },
              tx,
            ),
          );

        const first = runGrant();
        await reached;
        expect(gate.pid).not.toBeNull();

        const second = runGrant().catch((e: unknown) => ({ error: e }));

        // Poll pg_stat_activity until PostgreSQL reports the second backend blocked by gate.pid
        const observer = new Client({ connectionString: copy.url });
        await observer.connect();
        let blockerWaiterSeen = false;
        const holdStart = Date.now();
        try {
          for (let i = 0; i < 100; i++) {
            const { rows } = await observer.query<{
              pid: number;
              wait_event_type: string | null;
              blockers: number[];
            }>(
              `SELECT pid, wait_event_type, pg_blocking_pids(pid) AS blockers
               FROM pg_stat_activity
               WHERE datname = current_database()
                 AND $1::int = ANY(pg_blocking_pids(pid))`,
              [gate.pid],
            );
            if (rows.length > 0 && rows[0]?.wait_event_type === "Lock") {
              blockerWaiterSeen = true;
              break;
            }
            await new Promise((r) => setTimeout(r, 25));
          }
          expect(blockerWaiterSeen).toBe(true);
          // Hold for the full 6.25 seconds with the blocker/waiter active
          const remaining = 6_250 - (Date.now() - holdStart);
          if (remaining > 0) {
            await new Promise((r) => setTimeout(r, remaining));
          }
          // Confirm waiter is STILL blocked after 6.25s
          const stillBlocked = await observer.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM pg_stat_activity
             WHERE datname = current_database()
               AND $1::int = ANY(pg_blocking_pids(pid))`,
            [gate.pid],
          );
          expect(stillBlocked.rows[0]?.n).toBeGreaterThan(0);
        } finally {
          releaseFirst();
          await observer.end();
        }

        const [res1, res2] = await Promise.all([first, second]);
        expect(Date.now() - holdStart).toBeGreaterThanOrEqual(6_250);
        expect("bucketId" in res1).toBe(true);
        expect("error" in res2).toBe(true);

        const rows = await countLedgerRows("mainnet", f.organizationId);
        expect(rows.buckets).toHaveLength(1);
        expect(rows.transactions).toHaveLength(1);
      }, 30_000);
    });

    describe("5. 1,000-insert UUIDv7 monotonicity, cursor pagination, @updatedAt, and 1,000 refund+write-off pairs", () => {
      it("proves 1,000 raw grants (real + fixed same-ms clock), cursor paging across a tie, and expireCreditBucketsNow @updatedAt", async () => {
        const f = await makeOrgFixture("uuid-1000");

        // A. 1,000 inserts under fixed same-millisecond clock
        const pinnedMs = Date.now();
        vi.useFakeTimers({ toFake: ["Date"], now: pinnedMs });
        const fixedIds: string[] = [];
        try {
          await core.prisma.$transaction(
            async (tx) => {
              for (let i = 0; i < 1000; i++) {
                const { transactionId } = await insertCreditGrant(
                  {
                    amount: CREDIT,
                    userId: null,
                    organizationId: f.organizationId,
                    projectId: null,
                    expiresAt: null,
                    referenceId: `fixed-1000-${i}`,
                    referenceType: CreditBucketReferenceType.STRIPE_TOPUP,
                    referenceNote: null,
                    mintId: uuidv7,
                    network: "mainnet",
                  },
                  tx,
                );
                fixedIds.push(transactionId);
              }
            },
            { timeout: 60_000 },
          );
        } finally {
          vi.useRealTimers();
        }

        // Strict monotonic order across all 1,000 same-ms IDs + cursor paging
        for (let i = 1; i < fixedIds.length; i++) {
          expect(fixedIds[i - 1]! < fixedIds[i]!).toBe(true);
        }
        const pagedIds: string[] = [];
        let cursor: { createdAt: Date; id: string } | null = null;
        while (true) {
          const page: Array<{
            id: string;
            createdAt: Date;
            updatedAt: Date;
          }> = await core.mainnet().transaction.findMany({
            where: {
              organizationId: f.organizationId,
              ...(cursor
                ? {
                    OR: [
                      { createdAt: { gt: cursor.createdAt } },
                      {
                        createdAt: cursor.createdAt,
                        id: { gt: cursor.id },
                      },
                    ],
                  }
                : {}),
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: 100,
          });
          if (page.length === 0) break;
          for (const row of page) {
            expect(row.id[14]).toBe("7");
            expect(uuidV7Ms(row.id)).toBeLessThanOrEqual(
              row.createdAt.getTime(),
            );
            expect(row.createdAt.getTime()).toBe(row.updatedAt.getTime());
            pagedIds.push(row.id);
          }
          const last = page.at(-1)!;
          cursor = { createdAt: last.createdAt, id: last.id };
        }
        expect(pagedIds).toEqual(fixedIds);

        // B. 1,000 inserts under real clock
        const fReal = await makeOrgFixture("uuid-1000-real");
        const realIds: string[] = [];
        await core.prisma.$transaction(
          async (tx) => {
            for (let i = 0; i < 1000; i++) {
              const { transactionId } = await insertCreditGrant(
                {
                  amount: CREDIT,
                  userId: null,
                  organizationId: fReal.organizationId,
                  projectId: null,
                  expiresAt: null,
                  referenceId: `real-1000-${i}`,
                  referenceType: CreditBucketReferenceType.STRIPE_TOPUP,
                  referenceNote: null,
                  mintId: uuidv7,
                  network: "mainnet",
                },
                tx,
              );
              realIds.push(transactionId);
            }
          },
          { timeout: 60_000 },
        );
        const realRows = await core.mainnet().transaction.findMany({
          where: { organizationId: fReal.organizationId },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
        expect(realRows.map((r) => r.id)).toEqual(realIds);
        for (const row of realRows) {
          expect(row.id[14]).toBe("7");
          expect(uuidV7Ms(row.id)).toBeLessThanOrEqual(row.createdAt.getTime());
          expect(row.createdAt.getTime()).toBe(row.updatedAt.getTime());
        }

        // C. expireCreditBucketsNow preserves @updatedAt
        const fExp = await makeOrgFixture("expire-updated-at");
        const expRef = `exp-${randomUUID()}`;
        const past = new Date(Date.now() - 10_000);
        await core.mainnet().transaction.create({
          data: {
            createdAt: past,
            updatedAt: past,
            amount: CREDIT,
            organizationId: fExp.organizationId,
            userId: null,
            sourceCreditBucket: {
              create: {
                createdAt: past,
                updatedAt: past,
                amount: CREDIT,
                organizationId: fExp.organizationId,
                userId: null,
                referenceId: expRef,
                referenceType: CreditBucketReferenceType.ENTERPRISE_PERIOD,
                expiresAt: new Date(Date.now() + 10 * DAY),
              },
            },
          },
        });
        const beforeExpire = Date.now();
        await expireCreditBucketsNow(
          {
            network: "mainnet",
            now: new Date(),
            referenceIds: [expRef],
            referenceTypes: [CreditBucketReferenceType.ENTERPRISE_PERIOD],
            splitSql: true,
          },
          core.prisma,
        );
        const afterExpire = Date.now();
        const expiredBucket = await core
          .mainnet()
          .creditBucket.findFirstOrThrow({
            where: { referenceId: expRef },
          });
        expect(expiredBucket.updatedAt.getTime()).toBeGreaterThanOrEqual(
          beforeExpire,
        );
        expect(expiredBucket.updatedAt.getTime()).toBeLessThanOrEqual(
          afterExpire,
        );
      }, 90_000);

      it.runIf(onSplitLayout)(
        "proves 1,000 split-layout raw grant + writeOff pairs under real and fixed same-ms clocks always order grant before write-off",
        async () => {
          for (const mode of ["real", "fixed"] as const) {
            const f = await makeOrgFixture(`split-grant-wo-1000-${mode}`);
            const fixedNow = Date.now();
            if (mode === "fixed") {
              vi.useFakeTimers({ toFake: ["Date"], now: fixedNow });
            }
            try {
              for (let i = 0; i < 1000; i++) {
                await core.prisma.$transaction(async (tx) => {
                  const { bucketId } = await insertCreditGrant(
                    {
                      amount: CREDIT,
                      userId: null,
                      organizationId: f.organizationId,
                      projectId: f.projectId,
                      expiresAt: null,
                      referenceId: `split-gwo-${mode}-${i}`,
                      referenceType: CreditBucketReferenceType.REFUND,
                      referenceNote: null,
                      mintId: uuidv7,
                      network: "mainnet",
                    },
                    tx,
                  );
                  await core.writeOff({
                    scope: core.createNetworkScope("mainnet"),
                    tx,
                    of: { bucketIds: [bucketId] },
                  });
                });
              }
            } finally {
              if (mode === "fixed") vi.useRealTimers();
            }

            const allTx = await core.mainnet().transaction.findMany({
              where: { organizationId: f.organizationId },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            });
            expect(allTx).toHaveLength(2000);
            for (let i = 0; i < 1000; i++) {
              const creditTx = allTx[i * 2]!;
              const writeOffTx = allTx[i * 2 + 1]!;
              expect(creditTx.amount).toBe(CREDIT);
              expect(writeOffTx.amount).toBe(-CREDIT);
              expect(creditTx.id < writeOffTx.id).toBe(true);
              expect(uuidV7Ms(creditTx.id)).toBeLessThanOrEqual(
                creditTx.createdAt.getTime(),
              );
              expect(uuidV7Ms(writeOffTx.id)).toBeLessThanOrEqual(
                writeOffTx.createdAt.getTime(),
              );
            }
          }
        },
        120_000,
      );

      it.skipIf(onSplitLayout)(
        "proves 1,000 createCompensatingRefund + writeOffUnlessLiveCuso pairs under real and fixed same-ms clocks always order refund before write-off",
        async () => {
          // NOTE: createCompensatingRefund still writes via Prisma on today's layout
          // (ticket 27/25-5 owns moving compensating-refund to split layout).
          for (const mode of ["real", "fixed"] as const) {
            const f = await makeOrgFixture(`refund-wo-1000-${mode}`);
            // Archive Cuso so every Project refund triggers writeOffUnlessLiveCuso
            await core.prisma.sokoBot.update({
              where: { id: f.cusoId },
              data: { archivedAt: new Date() },
            });
            const fixedNow = Date.now();
            if (mode === "fixed") {
              vi.useFakeTimers({ toFake: ["Date"], now: fixedNow });
            }
            try {
              for (let i = 0; i < 1000; i++) {
                const refundId = await core.prisma.$transaction((tx) =>
                  core.createCompensatingRefund(tx, {
                    amount: CREDIT,
                    actorUserId: f.userId,
                    organizationId: f.organizationId,
                    referenceId: `rw-${mode}-${i}`,
                    consumptions: [
                      { amount: CREDIT, bucket: { projectId: f.projectId } },
                    ],
                  }),
                );
                expect(refundId[14]).toBe("7");
              }
            } finally {
              if (mode === "fixed") vi.useRealTimers();
            }

            const allTx = await core.mainnet().transaction.findMany({
              where: { organizationId: f.organizationId },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            });
            expect(allTx).toHaveLength(2000);
            for (let i = 0; i < 1000; i++) {
              const refundTx = allTx[i * 2]!;
              const writeOffTx = allTx[i * 2 + 1]!;
              expect(refundTx.amount).toBe(CREDIT);
              expect(writeOffTx.amount).toBe(-CREDIT);
              expect(refundTx.id < writeOffTx.id).toBe(true);
              expect(uuidV7Ms(refundTx.id)).toBeLessThanOrEqual(
                refundTx.createdAt.getTime(),
              );
              expect(uuidV7Ms(writeOffTx.id)).toBeLessThanOrEqual(
                writeOffTx.createdAt.getTime(),
              );
            }
          }
        },
        120_000,
      );
    });
  },
);
