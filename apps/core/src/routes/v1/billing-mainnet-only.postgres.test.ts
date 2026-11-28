/**
 * Ticket 28 slice 2: billing refuses Preprod (422 `mainnet_only_feature`) and
 * always acts on Mainnet, while Mainnet requests remain unchanged statement
 * for statement on both today's layout and the split layout.
 *
 * Covers:
 * - Mainnet unchanged across all 8 touched routers with pinned `origin/main`
 *   SQL statements on BOTH today's layout (`public`) and split layout
 *   (`shared`/`mainnet`/`preprod`), comparing no header vs `mainnet` raw
 * - Every gated billing route driven dynamically from `apiV1.routes` with
 *   per-mount floors + Better Auth `/auth/subscription/*` (listed explicitly
 *   because Better Auth sits behind Hono's `app.on(["POST", "GET"], "*", ...)`
 *   catch-all): 422 `mainnet_only_feature`, 0 statements after auth on `/v1`,
 *   0 statements total on `/auth/subscription/*`, 0 Stripe/Polar calls, and
 *   unchanged billing table digests before/after for callers with and without
 *   Preprod access
 * - Dynamic probe routes mounted on every gated billing router
 * - Edge parity: `OPTIONS` preflight, unserved paths, wrong methods,
 *   unauthenticated requests (401 on `/v1`, 422 on `/auth/subscription/*`),
 *   invalid header values (`testnet`, `Mainnet`, `PREPROD` -> 400), and
 *   Better Auth bad/missing session and Stripe webhook secret unset
 * - Not gated under `preprod`: signed Stripe webhook, signed Polar webhook,
 *   renewal crons, `GET /v1/organizations/:id/members/me/seat`, all four Seat
 *   assignment routes, generic org/user routes, and non-subscription `/auth/*`
 * - Split-layout key and order: Preprod API key without header (422), Mainnet
 *   API key (normal), contradicted keys (403 `api_key_network_mismatch`)
 */
import "@hono/zod-openapi";

import { CORE_API_ERROR_KINDS, convertCreditsToCents } from "@sokosumi/utils";
import { Hono } from "hono";
import { err, ok as okResult } from "neverthrow";
import type { Pool, PoolClient } from "pg";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { expectCoreLog } from "@/test/core-log";
import { copyPostgresTestDatabase } from "@/test/postgres-database-copy";
import { onSplitLayout, testSchemaNames } from "@/test/split-layout";

interface RecordedStatement {
  text: string;
  values: unknown[];
}

interface RecordedProviderCall {
  provider: string;
  args: unknown[];
}

const pools = vi.hoisted(() => [] as Pool[]);
const recorded = vi.hoisted(() => ({
  statements: [] as RecordedStatement[],
  providers: [] as RecordedProviderCall[],
}));
const background = vi.hoisted(() => [] as Promise<unknown>[]);
const polarVerify = vi.hoisted(() => vi.fn());

function serializeVal(v: unknown): unknown {
  if (typeof v === "bigint") return `${v.toString()}n`;
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return `<Buffer:${v.length}>`;
  if (Array.isArray(v)) return v.map(serializeVal);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = serializeVal(val);
    }
    return out;
  }
  return v;
}

function serializeValues(values: unknown): unknown[] {
  if (!Array.isArray(values)) return [];
  return values.map(serializeVal);
}

vi.mock("@vercel/functions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vercel/functions")>();
  return {
    ...actual,
    waitUntil: vi.fn((work: Promise<unknown>) => {
      background.push(work);
    }),
    attachDatabasePool: (pool: Pool) => {
      pools.push(pool);
      pool.on("connect", (client: PoolClient) => {
        const orig = client.query.bind(client) as (...a: unknown[]) => unknown;
        (client as { query: unknown }).query = (...args: unknown[]) => {
          const first = args[0];
          if (typeof first === "string") {
            recorded.statements.push({
              text: first,
              values: serializeValues(args[1]),
            });
          } else if (first && typeof first === "object" && "text" in first) {
            const cfg = first as { text: string; values?: unknown[] };
            recorded.statements.push({
              text: cfg.text,
              values: serializeValues(cfg.values),
            });
          }
          return orig(...args);
        };
      });
      actual.attachDatabasePool(pool);
    },
  };
});

vi.unmock("@/lib/db/prisma");
vi.mock("@/helpers/background-email", () => ({
  sendEmailInBackground: vi.fn(),
}));
vi.mock("@/services/webhook.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/webhook.service")>();
  return {
    ...actual,
    webhookService: {
      ...actual.webhookService,
      callAccountCreated: vi.fn().mockResolvedValue(undefined),
      callUserWebhook: vi.fn().mockResolvedValue(undefined),
    },
  };
});
vi.mock("@/services/ga4-measurement.service", () => ({
  reportPolarEventToGa4: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/ably/client", () => ({
  getRestClient: () => ({
    channels: {
      get: () => ({ publish: vi.fn().mockResolvedValue(undefined) }),
    },
  }),
}));
vi.mock("@/clients/polar.client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/clients/polar.client")>();
  return {
    ...actual,
    verifyPolarWebhook: vi.fn(async (...args: unknown[]) => {
      recorded.providers.push({
        provider: "polar.verifyPolarWebhook",
        args: [],
      });
      return await polarVerify(...args);
    }),
  };
});
vi.mock("@/clients/stripe.client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/clients/stripe.client")>();
  const realStripe = actual.stripe;

  const wrap = <Args extends unknown[], R>(
    name: string,
    impl: (...args: Args) => R,
  ) =>
    vi.fn(async (...args: Args) => {
      recorded.providers.push({ provider: name, args: serializeValues(args) });
      return await impl(...args);
    });

  const fakeProduct = (
    id: string,
    slug: string,
    credits: string,
    amt: number,
  ) => ({
    id,
    object: "product",
    name: slug,
    metadata: { slug, credits },
    default_price: {
      id: `price_${slug}`,
      object: "price",
      currency: "eur",
      type: "recurring",
      recurring: { interval: "month", interval_count: 1 },
      unit_amount: amt,
    },
  });

  const fakeSubscription = {
    id: "sub_stripe_28_2",
    object: "subscription",
    status: "active",
    customer: "cus_org_28_2",
    cancel_at_period_end: false,
    cancel_at: null,
    schedule: null,
    items: {
      object: "list",
      data: [
        {
          id: "si_seat_28_2",
          quantity: 3,
          current_period_start: 1795824000,
          current_period_end: 1798416000,
          price: {
            id: "price_starter",
            currency: "eur",
            unit_amount: 2900,
            recurring: { interval: "month", interval_count: 1 },
          },
        },
      ],
    },
  };

  const fakeStripe = {
    ...realStripe,
    webhooks: {
      constructEventAsync: vi.fn(
        async (payload: string, sig: string, secret: string) => {
          recorded.providers.push({
            provider: "stripe.webhooks.constructEventAsync",
            args: [Boolean(sig), Boolean(secret)],
          });
          return await realStripe.webhooks.constructEventAsync(
            payload,
            sig,
            secret,
          );
        },
      ),
      generateTestHeaderString:
        realStripe.webhooks.generateTestHeaderString.bind(realStripe.webhooks),
    },
    customers: {
      create: wrap("stripe.customers.create", () => ({
        id: "cus_created_28_2",
      })),
      retrieve: wrap("stripe.customers.retrieve", (id: string) => ({
        id,
        deleted: false,
        email: "billing@example.test",
        address: null,
        tax_ids: { object: "list", data: [] },
      })),
    },
    products: {
      retrieve: wrap("stripe.products.retrieve", (id: string) => {
        if (id.includes("starter"))
          return fakeProduct(id, "starter", "100", 2900);
        if (id.includes("standard"))
          return fakeProduct(id, "standard", "500", 9900);
        return fakeProduct(id, "pro", "2000", 29900);
      }),
    },
    billingPortal: {
      sessions: {
        create: wrap("stripe.billingPortal.sessions.create", () => ({
          id: "bps_28_2",
          url: "https://billing.stripe.com/p/session/bps_28_2",
        })),
      },
    },
  };

  const fakeStripeClient = {
    ...actual.stripeClient,
    createUserCustomer: wrap("stripeClient.createUserCustomer", () => ({
      id: "cus_user_created_28_2",
    })),
    createOrganizationCustomer: wrap(
      "stripeClient.createOrganizationCustomer",
      () => ({ id: "cus_org_created_28_2" }),
    ),
    retrieveCustomerBillingDetails: wrap(
      "stripeClient.retrieveCustomerBillingDetails",
      (customerId: string) => ({
        stripeCustomerId: customerId,
        email: "billing@example.test",
        address: {
          line1: "123 Main St",
          line2: null,
          city: "Berlin",
          state: null,
          postalCode: "10115",
          country: "DE",
        },
        taxIds: [],
      }),
    ),
    retrieveProductWithDefaultPrice: wrap(
      "stripeClient.retrieveProductWithDefaultPrice",
      (productId: string) => {
        if (productId.includes("starter"))
          return fakeProduct(productId, "starter", "100", 2900);
        if (productId.includes("standard"))
          return fakeProduct(productId, "standard", "500", 9900);
        return fakeProduct(productId, "pro", "2000", 29900);
      },
    ),
    listCreditTopUpPrices: wrap("stripeClient.listCreditTopUpPrices", () => [
      {
        id: "price_tier_1",
        amountPerCredit: 120,
        currency: "eur",
        nickname: "Standard",
      },
    ]),
    getPricesByLookupKeys: wrap(
      "stripeClient.getPricesByLookupKeys",
      (keys: string[]) =>
        new Map(
          keys.map((k, idx) => [
            k,
            {
              id: `price_k_${idx}`,
              amountPerCredit: 120 - idx * 5,
              currency: "eur",
            },
          ]),
        ),
    ),
    getCreditTopUpPriceByCredits: wrap(
      "stripeClient.getCreditTopUpPriceByCredits",
      () => ({ id: "price_tier_1", amountPerCredit: 120, currency: "eur" }),
    ),
    getCreditTopUpPriceById: wrap(
      "stripeClient.getCreditTopUpPriceById",
      () => ({ id: "price_tier_1", amountPerCredit: 120, currency: "eur" }),
    ),
    createCreditCheckoutSession: wrap(
      "stripeClient.createCreditCheckoutSession",
      () => ({
        id: "cs_28_2",
        url: "https://checkout.stripe.com/c/pay/cs_28_2",
      }),
    ),
    getCheckoutSession: wrap(
      "stripeClient.getCheckoutSession",
      (id: string) => ({
        id,
        status: "complete",
        payment_status: "paid",
        currency: "eur",
        amount_total: 12000,
        metadata: { userId: "11111111-1111-4111-8111-111111111102" },
        line_items: {
          data: [
            {
              quantity: 1,
              price: { product: { id: "prod_credit_fixed", name: "Credits" } },
            },
          ],
        },
      }),
    ),
    getCouponById: wrap("stripeClient.getCouponById", (id: string) => ({
      id,
      percent_off: 100,
      valid: true,
      metadata: { credits: "100", ttl_days: "30" },
    })),
    getPromotionCode: wrap("stripeClient.getPromotionCode", () => null),
    createPromotionCode: wrap("stripeClient.createPromotionCode", () => ({
      id: "promo_28_2",
      active: true,
    })),
    getAccountId: wrap("stripeClient.getAccountId", () => "acct_28_2"),
    searchInvoices: wrap("stripeClient.searchInvoices", () => []),
    getInvoice: wrap("stripeClient.getInvoice", (id: string) => ({
      id,
      status: "open",
      customer: "cus_org_28_2",
      currency: "eur",
      amount_due: 12000,
      created: 1795824000,
      metadata: { credits: "100", grant_source: "admin_one_time_credit" },
      lines: { data: [] },
    })),
    createAdminInvoice: wrap("stripeClient.createAdminInvoice", () => ({
      id: "in_created_28_2",
      status: "open",
      customer: "cus_org_28_2",
      currency: "eur",
      amount_due: 12000,
      created: 1795824000,
      metadata: { credits: "100", grant_source: "admin_one_time_credit" },
      lines: { data: [] },
    })),
    voidInvoice: wrap("stripeClient.voidInvoice", (id: string) => ({
      id,
      status: "void",
      customer: "cus_org_28_2",
      currency: "eur",
      amount_due: 12000,
      created: 1795824000,
      metadata: { credits: "100", grant_source: "admin_one_time_credit" },
      lines: { data: [] },
    })),
    retrieveSubscriptionWithItems: wrap(
      "stripeClient.retrieveSubscriptionWithItems",
      () => fakeSubscription,
    ),
    previewSubscriptionItemQuantity: wrap(
      "stripeClient.previewSubscriptionItemQuantity",
      () => ({ amount_due: 1234, currency: "eur", total: 11600 }),
    ),
    previewSubscriptionRenewalAtQuantity: wrap(
      "stripeClient.previewSubscriptionRenewalAtQuantity",
      () => ({ amount_due: 11600, currency: "eur", total: 11600 }),
    ),
    updateSubscriptionItemQuantity: wrap(
      "stripeClient.updateSubscriptionItemQuantity",
      () => fakeSubscription,
    ),
  };

  return {
    ...actual,
    stripe: fakeStripe,
    stripeClient: fakeStripeClient,
  };
});

const BASE_DATABASE_URL = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  BASE_DATABASE_URL?.startsWith("postgres");

const ORIGIN = "https://app.sokosumi.com";
const HEADER = "X-Sokosumi-Network";
const EXPECTED_MESSAGE = "This feature is available on Mainnet only.";
const CRON_SECRET = "test-cron-secret-28-2";
const STRIPE_WEBHOOK_SECRET = "whsec_test_28_2_fixed_secret_0123456789";
const CMO_CLIENT_ID = "11111111-1111-4111-8111-111111111101";
const ADMIN_USER_ID = "11111111-1111-4111-8111-111111111102";
const PLAIN_USER_ID = "11111111-1111-4111-8111-111111111120";
const ORG_ID = "11111111-1111-4111-8111-111111111105";
const ORG_SLUG = "fixture-billing-org-28-2";
const ADMIN_MEMBER_ID = "11111111-1111-4111-8111-111111111110";
const PLAIN_MEMBER_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "11111111-1111-4111-8111-111111111107";
const CMO_BOT_ID = "11111111-1111-4111-8111-111111111108";
const CONTRACT_ID = "11111111-1111-4111-8111-111111111115";
const SUBSCRIPTION_ROW_ID = "11111111-1111-4111-8111-111111111116";
const ADMIN_OAUTH_TOKEN = "soko_access_token_admin_28_2_000001";
const PLAIN_OAUTH_TOKEN = "soko_access_token_plain_28_2_000002";
const FIXED_DATE = new Date("2026-11-28T09:00:00.000Z");
const SETUP_TIMEOUT = 60_000;
const SWEEP_TIMEOUT = 60_000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TS_RE =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)?$/;

function normalizeValue(v: unknown, sessionToken?: string): unknown {
  if (typeof v === "string") {
    const cleaned = sessionToken
      ? v.replaceAll(sessionToken, "<SESSION_TOKEN>")
      : v;
    if (TS_RE.test(cleaned)) return "<TS>";
    if (UUID_RE.test(cleaned)) {
      return cleaned.startsWith("11111111-") ? cleaned : "<UUID>";
    }
    return cleaned.replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      (m) => (m.startsWith("11111111-") ? m : "<UUID>"),
    );
  }
  if (Array.isArray(v)) {
    return v.map((item) => normalizeValue(item, sessionToken));
  }
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v).map(([k, val]) => [
        k,
        normalizeValue(val, sessionToken),
      ]),
    );
  }
  return v;
}

function normalizeStatement(
  s: RecordedStatement,
  sessionToken?: string,
): string {
  return JSON.stringify({
    text: s.text,
    values: normalizeValue(s.values, sessionToken),
  });
}

function describeSqlStatement(sql: string): string {
  const s = sql.trim().replace(/\s+/g, " ");
  let match = s.match(/^SELECT\b.*?\bFROM\s+("[^"]+"\."[^"]+")/i);
  if (match && !/^WITH\b/i.test(s)) return `SELECT ${match[1]}`;
  match = s.match(/^INSERT\s+INTO\s+("[^"]+"\."[^"]+")/i);
  if (match) return `INSERT ${match[1]}`;
  match = s.match(/^UPDATE\s+("[^"]+"\."[^"]+")/i);
  if (match) return `UPDATE ${match[1]}`;
  match = s.match(/^DELETE\s+FROM\s+("[^"]+"\."[^"]+")/i);
  if (match) return `DELETE ${match[1]}`;
  return s.slice(0, 60);
}

async function drainBackground(): Promise<void> {
  while (background.length > 0) {
    await Promise.allSettled(background.splice(0));
  }
}

async function closePools(): Promise<void> {
  for (const pool of pools.splice(0)) {
    await pool.end().catch(() => undefined);
  }
  delete (globalThis as { coreDatabase?: unknown }).coreDatabase;
}

/** Classifies every billing route in Core's live `/v1` route table (slice 28-2). */
function classifyGatedBillingV1Route(
  method: string,
  path: string,
): { mount: string } | null {
  if (path === "/checkout" || path.startsWith("/checkout/")) {
    return { mount: "/v1/checkout" };
  }
  if (path === "/products" || path.startsWith("/products/")) {
    return { mount: "/v1/products" };
  }
  if (path === "/coupons" || path.startsWith("/coupons/")) {
    return { mount: "/v1/coupons" };
  }
  if (path === "/enterprise" || path.startsWith("/enterprise/")) {
    return { mount: "/v1/enterprise" };
  }
  if (path === "/admin/invoices" || path.startsWith("/admin/invoices/")) {
    return { mount: "/v1/admin/invoices" };
  }
  if (
    (method === "GET" &&
      (path === "/organizations/:id/billing-details" ||
        path === "/organizations/:id/billing-plan" ||
        path === "/organizations/:id/enterprise-contract-summary" ||
        path === "/organizations/:id/stripe-customer" ||
        path === "/organizations/:id/seat-summary" ||
        path === "/organizations/:id/credit-spend")) ||
    (method === "POST" && path === "/organizations/:id/stripe-customer") ||
    path === "/organizations/:id/subscription" ||
    path.startsWith("/organizations/:id/subscription/")
  ) {
    return { mount: "/v1/organizations/:id/<billing>" };
  }
  if (
    (method === "GET" &&
      (path === "/users/:id/billing-details" ||
        path === "/users/:id/stripe-customer" ||
        path === "/users/:id/subscription")) ||
    (method === "POST" && path === "/users/:id/stripe-customer")
  ) {
    return { mount: "/v1/users/:id/<billing>" };
  }
  return null;
}

/**
 * Better Auth mounts all plugin routes behind Hono's `app.on(["POST", "GET"], "*", ...)`,
 * so Hono's route table cannot enumerate individual `/auth/subscription/*` or
 * ungated `/auth/*` paths; we list every `@better-auth/stripe` subscription
 * endpoint and representative ungated `/auth` endpoints explicitly.
 */
const BETTER_AUTH_GATED_SUBSCRIPTION_ROUTES: ReadonlyArray<
  readonly [string, string]
> = [
  ["GET", "/auth/subscription/list"],
  ["POST", "/auth/subscription/upgrade"],
  ["POST", "/auth/subscription/cancel"],
  ["POST", "/auth/subscription/restore"],
  ["GET", "/auth/subscription/success"],
  ["POST", "/auth/subscription/billing-portal"],
];

function fillBillingParams(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
    if (name === "id") {
      if (path.startsWith("/organizations/")) return ORG_ID;
      if (path.startsWith("/users/")) return "me";
      if (path.startsWith("/enterprise/contracts/")) return CONTRACT_ID;
      if (path.startsWith("/admin/invoices/")) return "in_fixed_28_2";
      return CONTRACT_ID;
    }
    if (name === "couponId") return "coupon_fixed_28_2";
    if (name === "sessionId") return "cs_28_2";
    return "22222222-2222-4222-8222-222222222222";
  });
}

async function loadEnvironment(
  databaseUrl: string,
  extraEnv: Record<string, string>,
) {
  await closePools();
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("DATABASE_URL", databaseUrl);
  vi.stubEnv("CMO_OAUTH_CLIENT_ID", CMO_CLIENT_ID);
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", STRIPE_WEBHOOK_SECRET);
  vi.stubEnv("STRIPE_CREDIT_PRODUCT_ID", "prod_credit_fixed");
  vi.stubEnv("STRIPE_STARTER_SUBSCRIPTION_PRODUCT_ID", "prod_starter_fixed");
  vi.stubEnv("STRIPE_STANDARD_SUBSCRIPTION_PRODUCT_ID", "prod_standard_fixed");
  vi.stubEnv("STRIPE_PRO_SUBSCRIPTION_PRODUCT_ID", "prod_pro_fixed");
  for (const [k, v] of Object.entries(extraEnv)) {
    vi.stubEnv(k, v);
  }

  const { default: prisma } = await import("@/lib/db/prisma");
  const { createNetworkScope } = await import("@/lib/db/network-scope");
  const { createPersonalWorkspace } = await import(
    "@/helpers/personal-workspace"
  );
  const { workspaceRepository } = await import(
    "@sokosumi/database/repositories"
  );
  const { hashStoredOAuthToken, OAUTH_ACCESS_TOKEN_PREFIX } = await import(
    "@/lib/auth-oauth-token-prefixes"
  );
  const { errorHandler } = await import("@/helpers/error-handler");
  const { default: apiV1 } = await import("@/routes/v1/index");
  const { default: authRouter } = await import("@/routes/auth/index");
  const { default: syncRouter } = await import("@/routes/sync/index");
  const { OpenAPIHonoWithAuth } = await import("@/lib/hono");
  const { CMO_SOKO_BOT_VERSION_ID } = await import("@sokosumi/soko-bot");
  const { hashPassword } = await import("better-auth/crypto");
  const { AUTH_CAPTCHA_ACTION, AUTH_CAPTCHA_HEADER } = await import(
    "@sokosumi/utils"
  );
  const fixture = await import("@/test-fixtures/core-session");

  const app = new Hono();
  app.onError(errorHandler);
  app.route("/v1", apiV1);
  app.route("/auth", authRouter);
  app.route("/sync", syncRouter);

  const authOnlyRouter = new OpenAPIHonoWithAuth();
  authOnlyRouter.get("/ping", (c) => c.json({ ok: true }));
  app.route("/__auth-only", authOnlyRouter);

  return {
    prisma,
    createNetworkScope,
    createPersonalWorkspace,
    workspaceRepository,
    hashStoredOAuthToken,
    OAUTH_ACCESS_TOKEN_PREFIX,
    apiV1,
    authRouter,
    CMO_SOKO_BOT_VERSION_ID,
    hashPassword,
    AUTH_CAPTCHA_ACTION,
    AUTH_CAPTCHA_HEADER,
    fixture,
    app,
  };
}

type Loaded = Awaited<ReturnType<typeof loadEnvironment>>;

async function seedBillingFixtures(loaded: Loaded) {
  const { prisma, workspaceRepository } = loaded;

  await prisma.user.create({
    data: {
      id: ADMIN_USER_ID,
      name: "Admin Billing",
      email: "admin-28-2@example.test",
      role: "admin",
      emailVerified: true,
      termsAccepted: true,
      preprodEnabled: true,
      stripeCustomerId: "cus_user_28_2",
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
      accounts: {
        create: {
          accountId: ADMIN_USER_ID,
          providerId: "credential",
          password: await loaded.hashPassword("fixture-password-long"),
        },
      },
    },
  });
  await loaded.createPersonalWorkspace(ADMIN_USER_ID);

  await prisma.user.create({
    data: {
      id: PLAIN_USER_ID,
      name: "Plain Billing",
      email: "plain-28-2@example.test",
      role: "user",
      emailVerified: true,
      termsAccepted: true,
      preprodEnabled: false,
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
    },
  });
  await loaded.createPersonalWorkspace(PLAIN_USER_ID);

  await prisma.organization.create({
    data: {
      id: ORG_ID,
      name: "Fixture Billing Org",
      slug: ORG_SLUG,
      stripeCustomerId: "cus_org_28_2",
      preprodEnabled: true,
      createdAt: FIXED_DATE,
      members: {
        create: [
          {
            id: ADMIN_MEMBER_ID,
            userId: ADMIN_USER_ID,
            role: "owner",
            seatAssignedAt: FIXED_DATE,
            createdAt: FIXED_DATE,
          },
          {
            id: PLAIN_MEMBER_ID,
            userId: PLAIN_USER_ID,
            role: "member",
            seatAssignedAt: null,
            createdAt: FIXED_DATE,
          },
        ],
      },
    },
  });
  const orgWorkspace = await workspaceRepository.upsertOrganizationWorkspace({
    organizationId: ORG_ID,
    tx: prisma,
  });

  await prisma.project.create({
    data: {
      id: PROJECT_ID,
      workspaceId: orgWorkspace.id,
      name: "CMO Billing Fixture",
      websiteUrl: "https://cmo.example.test",
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
    },
  });
  await prisma.sokoBot.create({
    data: {
      id: CMO_BOT_ID,
      workspaceId: orgWorkspace.id,
      projectId: PROJECT_ID,
      userId: null,
      versionId: loaded.CMO_SOKO_BOT_VERSION_ID,
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
    },
  });

  await prisma.subscription.create({
    data: {
      id: SUBSCRIPTION_ROW_ID,
      plan: "starter",
      referenceId: ORG_ID,
      stripeCustomerId: "cus_org_28_2",
      stripeSubscriptionId: "sub_stripe_28_2",
      status: "active",
      periodStart: new Date("2026-11-01T00:00:00.000Z"),
      periodEnd: new Date("2026-12-31T00:00:00.000Z"),
      seats: 3,
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
    },
  });

  await prisma.enterpriseContract.create({
    data: {
      id: CONTRACT_ID,
      organizationId: ORG_ID,
      status: "draft",
      periodCount: 12,
      seats: 5,
      centsPerMonth: convertCreditsToCents(60_000),
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
    },
  });

  const scopes = ["sokosumi:api"];
  await prisma.oauthClient.create({
    data: {
      id: "11111111-1111-4111-8111-111111111112",
      clientId: CMO_CLIENT_ID,
      scopes,
      skipConsent: true,
    },
  });
  for (const [uid, token, cid, tid] of [
    [
      ADMIN_USER_ID,
      ADMIN_OAUTH_TOKEN,
      "11111111-1111-4111-8111-111111111113",
      "11111111-1111-4111-8111-111111111114",
    ],
    [
      PLAIN_USER_ID,
      PLAIN_OAUTH_TOKEN,
      "11111111-1111-4111-8111-111111111123",
      "11111111-1111-4111-8111-111111111124",
    ],
  ] as const) {
    await prisma.oauthConsent.create({
      data: { id: cid, clientId: CMO_CLIENT_ID, userId: uid, scopes },
    });
    await prisma.oauthAccessToken.create({
      data: {
        id: tid,
        clientId: CMO_CLIENT_ID,
        userId: uid,
        scopes,
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
        token: loaded.hashStoredOAuthToken(
          token,
          loaded.OAUTH_ACCESS_TOKEN_PREFIX,
        ),
      },
    });
  }

  let sessionCookie = "";
  const captchaSpy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () =>
      Response.json({ success: true, action: loaded.AUTH_CAPTCHA_ACTION }),
    );
  try {
    const signInRes = await loaded.app.request(`${ORIGIN}/auth/sign-in/email`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "content-type": "application/json",
        [loaded.AUTH_CAPTCHA_HEADER]: "fixture-turnstile-token",
      },
      body: JSON.stringify({
        email: "admin-28-2@example.test",
        password: "fixture-password-long",
      }),
    });
    expect(signInRes.status).toBe(200);
    sessionCookie = loaded.fixture.sessionTokenCookie(signInRes);
  } finally {
    captchaSpy.mockRestore();
  }

  // Extract raw token value for normalizing SQL bound parameters in Suite A.
  const sessionInfo = await loaded.app.request(`${ORIGIN}/auth/get-session`, {
    headers: { origin: ORIGIN, cookie: sessionCookie },
  });
  const sessionToken = (
    (await sessionInfo.json()) as { session: { token: string } }
  ).session.token;

  return { sessionCookie, sessionToken };
}

async function billingTablesDigest(
  loaded: Loaded,
): Promise<Record<string, string>> {
  const names = testSchemaNames();
  const shared = names.DATABASE_SCHEMA_SHARED;
  const mainnet = names.DATABASE_SCHEMA_MAINNET;
  const preprod = names.DATABASE_SCHEMA_PREPROD;

  const targets: { key: string; schema: string; table: string }[] = [
    { key: "shared.subscription", schema: shared, table: "subscription" },
    {
      key: "shared.enterprise_contract",
      schema: shared,
      table: "enterprise_contract",
    },
    {
      key: "shared.enterprise_contract_period",
      schema: shared,
      table: "enterprise_contract_period",
    },
    {
      key: "shared.polar_subscription",
      schema: shared,
      table: "polar_subscription",
    },
    { key: "shared.polar_order", schema: shared, table: "polar_order" },
    { key: "shared.user", schema: shared, table: "user" },
    { key: "shared.organization", schema: shared, table: "organization" },
    { key: "shared.member", schema: shared, table: "member" },
    { key: "mainnet.Transaction", schema: mainnet, table: "Transaction" },
    { key: "mainnet.credit_bucket", schema: mainnet, table: "credit_bucket" },
    {
      key: "mainnet.credit_consumption",
      schema: mainnet,
      table: "credit_consumption",
    },
  ];
  if (onSplitLayout) {
    targets.push(
      { key: "preprod.Transaction", schema: preprod, table: "Transaction" },
      { key: "preprod.credit_bucket", schema: preprod, table: "credit_bucket" },
      {
        key: "preprod.credit_consumption",
        schema: preprod,
        table: "credit_consumption",
      },
    );
  }

  const digests: Record<string, string> = {};
  for (const target of targets) {
    const rows = await loaded.prisma.$queryRawUnsafe<{ digest: string }[]>(
      `SELECT COALESCE(md5(string_agg(row_to_json(t)::text, ',' ORDER BY row_to_json(t)::text)), 'empty') AS digest FROM "${target.schema}"."${target.table}" t`,
    );
    digests[target.key] = rows[0]?.digest ?? "empty";
  }
  return digests;
}

function signedStripeEvent(event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  const helper = new Stripe("sk_test_dummy", { maxNetworkRetries: 0 });
  const signature = helper.webhooks.generateTestHeaderString({
    payload,
    secret: STRIPE_WEBHOOK_SECRET,
  });
  return { payload, signature };
}

// ============================================================================
// Suite A: Mainnet unchanged on BOTH today's layout AND split layout (note d3)
// ============================================================================
describe.skipIf(!enabled)(
  `Billing Mainnet unchanged on ${onSplitLayout ? "split layout (Preprod on)" : "today's layout (Preprod off)"}`,
  () => {
    async function runMainnetBillingOperations(networkHeader?: string) {
      const copy = await copyPostgresTestDatabase(
        BASE_DATABASE_URL!,
        "mainnet_only_test",
      );
      try {
        const loaded = await loadEnvironment(copy.url, {
          NETWORK_PREPROD_ENABLED: onSplitLayout ? "true" : "false",
        });
        const seeded = await seedBillingFixtures(loaded);

        const oauthHeaders = {
          authorization: `Bearer ${ADMIN_OAUTH_TOKEN}`,
          ...(networkHeader ? { [HEADER]: networkHeader } : {}),
        };
        const sessionHeaders = {
          cookie: seeded.sessionCookie,
          ...(networkHeader ? { [HEADER]: networkHeader } : {}),
        };

        const out: Record<
          string,
          {
            status: number;
            body: unknown;
            statements: RecordedStatement[];
            providers: RecordedProviderCall[];
          }
        > = {};

        async function run(
          name: string,
          method: string,
          path: string,
          headers: Record<string, string>,
          body?: unknown,
          rawBody?: string,
        ) {
          recorded.statements.length = 0;
          recorded.providers.length = 0;
          const res = await loaded.app.request(`${ORIGIN}${path}`, {
            method,
            headers: {
              origin: ORIGIN,
              ...(body !== undefined || rawBody !== undefined
                ? { "content-type": "application/json" }
                : {}),
              ...headers,
            },
            ...(rawBody !== undefined
              ? { body: rawBody }
              : body !== undefined
                ? { body: JSON.stringify(body) }
                : {}),
          });
          const text = await res.text();
          await drainBackground();
          out[name] = {
            status: res.status,
            body: text ? JSON.parse(text) : null,
            statements: [...recorded.statements],
            providers: [...recorded.providers],
          };
        }

        // 1. /v1/checkout (read + write)
        await run(
          "checkout_session_get",
          "GET",
          "/v1/checkout/sessions/cs_28_2",
          oauthHeaders,
        );
        await run(
          "checkout_credits_post",
          "POST",
          "/v1/checkout/credits",
          oauthHeaders,
          { organizationId: ORG_ID, credits: 100 },
        );
        // 2. /v1/products (reads)
        await run(
          "products_credits_get",
          "GET",
          "/v1/products/credits",
          oauthHeaders,
        );
        await run(
          "products_catalog_get",
          "GET",
          "/v1/products/credits/catalog",
          oauthHeaders,
        );
        await run(
          "products_subscription_get",
          "GET",
          "/v1/products/subscription",
          oauthHeaders,
        );
        // 3. /v1/coupons (read + write)
        await run(
          "coupons_get",
          "GET",
          "/v1/coupons/coupon_fixed_28_2",
          oauthHeaders,
        );
        await run(
          "coupons_claim_post",
          "POST",
          "/v1/coupons/coupon_fixed_28_2/claim",
          oauthHeaders,
          {},
        );
        // 4. /v1/enterprise (read + write)
        await run(
          "enterprise_list_get",
          "GET",
          "/v1/enterprise/contracts",
          oauthHeaders,
        );
        await run(
          "enterprise_patch",
          "PATCH",
          `/v1/enterprise/contracts/${CONTRACT_ID}`,
          oauthHeaders,
          { notes: "rec" },
        );
        // 5. /v1/admin/invoices (read + write)
        await run(
          "admin_invoices_list_get",
          "GET",
          "/v1/admin/invoices",
          oauthHeaders,
        );
        await run(
          "admin_invoices_post",
          "POST",
          "/v1/admin/invoices",
          oauthHeaders,
          {
            targetType: "organization",
            targetId: ORG_ID,
            credits: 100,
            ttlDays: 30,
            priceId: "price_tier_1",
          },
        );
        // 6. /v1/organizations/:id/<billing> (read + write + credit-spend)
        await run(
          "org_billing_details_get",
          "GET",
          `/v1/organizations/${ORG_ID}/billing-details`,
          oauthHeaders,
        );
        await run(
          "org_subscription_seats_put",
          "PUT",
          `/v1/organizations/${ORG_ID}/subscription/seats`,
          oauthHeaders,
          { seats: 3 },
        );
        await run(
          "org_credit_spend_get",
          "GET",
          `/v1/organizations/${ORG_ID}/credit-spend`,
          oauthHeaders,
        );
        // 7. /v1/users/:id/<billing> (read + write)
        await run(
          "user_billing_details_get",
          "GET",
          "/v1/users/me/billing-details",
          oauthHeaders,
        );
        await run(
          "user_stripe_customer_post",
          "POST",
          "/v1/users/me/stripe-customer",
          oauthHeaders,
        );
        // 8. /auth (Better Auth subscription read + Stripe webhook)
        await run(
          "auth_sub_list_session",
          "GET",
          "/auth/subscription/list",
          sessionHeaders,
        );
        const signed = signedStripeEvent({
          id: "evt_rec_28_2",
          object: "event",
          api_version: "2026-02-25.clover",
          created: 1795824000,
          livemode: false,
          type: "customer.created",
          data: {
            object: {
              id: "cus_user_28_2",
              object: "customer",
              email: "admin-28-2@example.test",
              metadata: { userId: ADMIN_USER_ID, customerType: "user" },
            },
          },
        });
        await run(
          "auth_stripe_webhook_good",
          "POST",
          "/auth/stripe/webhook",
          {
            "stripe-signature": signed.signature,
            ...(networkHeader ? { [HEADER]: networkHeader } : {}),
          },
          undefined,
          signed.payload,
        );

        return { out, sessionToken: seeded.sessionToken };
      } finally {
        await closePools();
        await copy.drop();
      }
    }

    it("matches origin/main SQL statements, bodies, and Stripe calls with no header and mainnet header on both layouts", {
      timeout: 120_000,
    }, async () => {
      const noHeader = await runMainnetBillingOperations();
      const mainnetHeader = await runMainnetBillingOperations("mainnet");

      const S = testSchemaNames().DATABASE_SCHEMA_SHARED;
      const M = testSchemaNames().DATABASE_SCHEMA_MAINNET;
      const auth4 = [
        `SELECT "${S}"."oauthAccessToken"`,
        `SELECT "${S}"."oauthRefreshToken"`,
        `SELECT "${S}"."user"`,
        `SELECT "${S}"."oauthClient"`,
      ];

      // Exact SQL statement lists recorded on origin/main (ccaec3bc6) across all
      // 8 touched routers on BOTH today's layout (`public`) and split layout
      // (`shared`/`mainnet`), ensuring the guard sends 0 statements on Mainnet.
      const pinned: Record<
        string,
        {
          status: number;
          statements: string[];
          providers: string[];
          concurrentReads?: boolean;
        }
      > = {
        checkout_session_get: {
          status: 200,
          statements: auth4,
          providers: ["stripeClient.getCheckoutSession"],
        },
        checkout_credits_post: {
          status: 201,
          statements: [
            ...auth4,
            `SELECT "${S}"."organization"`,
            `SELECT "${S}"."member"`,
            `SELECT "${S}"."organization"`,
            `SELECT "${S}"."user"`,
            `SELECT "${S}"."enterprise_contract"`,
            `SELECT "${S}"."subscription"`,
          ],
          providers: [
            "stripeClient.getCreditTopUpPriceByCredits",
            "stripeClient.createCreditCheckoutSession",
          ],
        },
        products_credits_get: {
          status: 200,
          statements: auth4,
          providers: ["stripeClient.listCreditTopUpPrices"],
        },
        products_catalog_get: {
          status: 200,
          statements: [...auth4, `SELECT "${S}"."user"`],
          providers: ["stripeClient.getPricesByLookupKeys"],
        },
        products_subscription_get: {
          status: 200,
          statements: auth4,
          providers: [
            "stripeClient.retrieveProductWithDefaultPrice",
            "stripeClient.retrieveProductWithDefaultPrice",
            "stripeClient.retrieveProductWithDefaultPrice",
          ],
        },
        coupons_get: {
          status: 200,
          statements: auth4,
          providers: ["stripeClient.getCouponById"],
        },
        coupons_claim_post: {
          status: 201,
          statements: [...auth4, `SELECT "${S}"."user"`],
          providers: [
            "stripeClient.getCouponById",
            "stripeClient.getPromotionCode",
            "stripeClient.createPromotionCode",
          ],
        },
        enterprise_list_get: {
          status: 200,
          statements: [
            ...auth4,
            `SELECT "${S}"."enterprise_contract"`,
            `SELECT "${S}"."organization"`,
          ],
          providers: [],
        },
        enterprise_patch: {
          status: 200,
          statements: [
            ...auth4,
            `SELECT "${S}"."enterprise_contract"`,
            "BEGIN",
            `UPDATE "${S}"."enterprise_contract"`,
            `SELECT "${S}"."enterprise_contract"`,
            `SELECT "${S}"."organization"`,
            "COMMIT",
          ],
          providers: [],
        },
        admin_invoices_list_get: {
          status: 200,
          statements: auth4,
          providers: [
            "stripeClient.searchInvoices",
            "stripeClient.searchInvoices",
            "stripeClient.getAccountId",
          ],
        },
        admin_invoices_post: {
          status: 200,
          statements: [
            ...auth4,
            `SELECT "${S}"."organization"`,
            `SELECT "${S}"."organization"`,
          ],
          providers: [
            "stripeClient.getCreditTopUpPriceById",
            "stripeClient.getAccountId",
            "stripeClient.retrieveCustomerBillingDetails",
            "stripeClient.createAdminInvoice",
          ],
        },
        org_billing_details_get: {
          status: 200,
          statements: [...auth4, `SELECT "${S}"."organization"`],
          providers: ["stripeClient.retrieveCustomerBillingDetails"],
        },
        org_subscription_seats_put: {
          status: 200,
          statements: [
            ...auth4,
            `SELECT "${S}"."organization"`,
            `SELECT "${S}"."member"`,
            `SELECT "${S}"."enterprise_contract"`,
            `SELECT "${S}"."subscription"`,
            `SELECT "${S}"."subscription"`,
          ],
          providers: [],
        },
        org_credit_spend_get: {
          status: 200,
          statements: [
            ...auth4,
            `SELECT "${S}"."organization"`,
            `SELECT "${S}"."member"`,
            `SELECT "${S}"."member"`,
            `SELECT "${M}"."Transaction"`,
            `SELECT "${M}"."Transaction"`,
            `SELECT "${S}"."user"`,
          ],
          providers: [],
          concurrentReads: true,
        },
        user_billing_details_get: {
          status: 200,
          statements: [
            ...auth4,
            `SELECT "${S}"."user"`,
            `SELECT "${S}"."user"`,
          ],
          providers: ["stripeClient.retrieveCustomerBillingDetails"],
        },
        user_stripe_customer_post: {
          status: 200,
          statements: [
            ...auth4,
            `SELECT "${S}"."user"`,
            `SELECT "${S}"."user"`,
          ],
          providers: [],
        },
        auth_sub_list_session: {
          status: 200,
          statements: [
            `SELECT "${S}"."session"`,
            `SELECT "${S}"."user"`,
            `SELECT "${S}"."subscription"`,
          ],
          providers: [],
        },
        auth_stripe_webhook_good: {
          status: 200,
          statements: [`UPDATE "${S}"."user"`],
          providers: ["stripe.webhooks.constructEventAsync"],
        },
      };

      for (const [name, expected] of Object.entries(pinned)) {
        const a = noHeader.out[name]!;
        const b = mainnetHeader.out[name]!;
        expect([name, a.status]).toEqual([name, expected.status]);
        expect([name, b.status]).toEqual([name, expected.status]);

        const aDesc = a.statements.map((s) => describeSqlStatement(s.text));
        const bDesc = b.statements.map((s) => describeSqlStatement(s.text));
        if (expected.concurrentReads) {
          expect([name, [...aDesc].sort()]).toEqual([
            name,
            [...expected.statements].sort(),
          ]);
          expect([name, [...bDesc].sort()]).toEqual([
            name,
            [...expected.statements].sort(),
          ]);
        } else {
          expect([name, aDesc]).toEqual([name, expected.statements]);
          expect([name, bDesc]).toEqual([name, expected.statements]);
        }

        expect([name, a.providers.map((p) => p.provider)]).toEqual([
          name,
          expected.providers,
        ]);
        expect([name, normalizeValue(b.providers)]).toEqual([
          name,
          normalizeValue(a.providers),
        ]);
        expect([name, normalizeValue(b.body)]).toEqual([
          name,
          normalizeValue(a.body),
        ]);

        const aStmts = a.statements.map((s) =>
          normalizeStatement(s, noHeader.sessionToken),
        );
        const bStmts = b.statements.map((s) =>
          normalizeStatement(s, mainnetHeader.sessionToken),
        );
        if (expected.concurrentReads) {
          expect([name, [...bStmts].sort()]).toEqual([
            name,
            [...aStmts].sort(),
          ]);
        } else {
          expect([name, bStmts]).toEqual([name, aStmts]);
        }
      }
    });
  },
);

// ============================================================================
// Suites B–E: 422 sweep, probes, edge parity, ungated controls, API keys
// ============================================================================
describe.skipIf(!enabled)(
  `Billing Mainnet-only guard on ${onSplitLayout ? "split layout (Preprod on)" : "today's layout (Preprod off)"}`,
  () => {
    let copy: Awaited<ReturnType<typeof copyPostgresTestDatabase>>;
    let loaded: Loaded;
    let seeded: Awaited<ReturnType<typeof seedBillingFixtures>>;

    beforeAll(async () => {
      copy = await copyPostgresTestDatabase(
        BASE_DATABASE_URL!,
        "mainnet_only_test",
      );
      loaded = await loadEnvironment(copy.url, {
        NETWORK_PREPROD_ENABLED: onSplitLayout ? "true" : "false",
      });
      seeded = await seedBillingFixtures(loaded);
    }, SETUP_TIMEOUT);

    afterAll(async () => {
      await closePools();
      if (copy) await copy.drop();
    }, SETUP_TIMEOUT);

    it("refuses every gated /v1 billing route (route-table driven) and every /auth/subscription/* route with 422 mainnet_only_feature, zero post-auth SQL, zero provider calls, and unchanged digests", {
      timeout: SWEEP_TIMEOUT,
    }, async () => {
      const seen = new Set<string>();
      const gatedV1Routes: {
        mount: string;
        method: string;
        path: string;
        fullPath: string;
      }[] = [];

      for (const route of loaded.apiV1.routes) {
        if (route.method === "ALL" || route.path.includes("*")) continue;
        const match = classifyGatedBillingV1Route(route.method, route.path);
        if (!match) continue;
        const key = `${route.method} /v1${route.path}`;
        if (seen.has(key)) continue;
        seen.add(key);
        gatedV1Routes.push({
          ...match,
          method: route.method,
          path: route.path,
          fullPath: `/v1${fillBillingParams(route.path)}`,
        });
      }

      const counts = new Map<string, number>();
      for (const r of gatedV1Routes) {
        counts.set(r.mount, (counts.get(r.mount) ?? 0) + 1);
      }
      expect(counts.get("/v1/checkout")).toBeGreaterThanOrEqual(2);
      expect(counts.get("/v1/products")).toBeGreaterThanOrEqual(3);
      expect(counts.get("/v1/coupons")).toBeGreaterThanOrEqual(2);
      expect(counts.get("/v1/enterprise")).toBeGreaterThanOrEqual(7);
      expect(counts.get("/v1/admin/invoices")).toBeGreaterThanOrEqual(5);
      expect(counts.get("/v1/organizations/:id/<billing>")).toBe(11);
      expect(counts.get("/v1/users/:id/<billing>")).toBe(4);
      expect(
        gatedV1Routes.some(
          (r) =>
            r.method === "GET" && r.path === "/organizations/:id/credit-spend",
        ),
      ).toBe(true);
      expect(
        gatedV1Routes.some(
          (r) =>
            r.method === "GET" && r.path === "/organizations/:id/seat-summary",
        ),
      ).toBe(true);

      // Measure auth-only SQL statements.
      recorded.statements.length = 0;
      const ping = await loaded.app.request(`${ORIGIN}/__auth-only/ping`, {
        headers: {
          origin: ORIGIN,
          authorization: `Bearer ${ADMIN_OAUTH_TOKEN}`,
        },
      });
      expect(ping.status).toBe(200);
      const oauthAuthStmts = recorded.statements.map((s) => s.text).sort();

      const digestBefore = await billingTablesDigest(loaded);

      // Sweep every /v1 billing route as a caller WITH Preprod access AND as a caller WITHOUT.
      for (const [label, token] of [
        ["with Preprod access", ADMIN_OAUTH_TOKEN],
        ["without Preprod access", PLAIN_OAUTH_TOKEN],
      ] as const) {
        for (const route of gatedV1Routes) {
          recorded.statements.length = 0;
          recorded.providers.length = 0;
          const hasBody = route.method !== "GET" && route.method !== "DELETE";
          const res = await loaded.app.request(`${ORIGIN}${route.fullPath}`, {
            method: route.method,
            headers: {
              origin: ORIGIN,
              authorization: `Bearer ${token}`,
              [HEADER]: "preprod",
              ...(hasBody ? { "content-type": "application/json" } : {}),
            },
            ...(hasBody ? { body: "{}" } : {}),
          });
          await drainBackground();
          const body = (await res.json()) as {
            kind?: string;
            message?: string;
          };
          expect([
            label,
            route.method,
            route.fullPath,
            res.status,
            body.kind,
            body.message,
          ]).toEqual([
            label,
            route.method,
            route.fullPath,
            422,
            CORE_API_ERROR_KINDS.MAINNET_ONLY_FEATURE,
            EXPECTED_MESSAGE,
          ]);
          expect([route.method, route.fullPath, recorded.providers]).toEqual([
            route.method,
            route.fullPath,
            [],
          ]);
          expect([
            label,
            route.method,
            route.fullPath,
            recorded.statements.map((s) => s.text).sort(),
          ]).toEqual([label, route.method, route.fullPath, oauthAuthStmts]);
        }
      }

      // Sweep Better Auth /auth/subscription/* signed in, with bad session, and with no session:
      // all answer 422 mainnet_only_feature with 0 SQL statements and 0 Stripe calls.
      const authModes: ReadonlyArray<
        readonly [string, Record<string, string>]
      > = [
        ["signed in", { cookie: seeded.sessionCookie }],
        ["bad session", { cookie: "better-auth.session_token=invalid_tok" }],
        ["missing session", {}],
      ];
      for (const [modeLabel, authHdr] of authModes) {
        for (const [method, path] of BETTER_AUTH_GATED_SUBSCRIPTION_ROUTES) {
          recorded.statements.length = 0;
          recorded.providers.length = 0;
          const res = await loaded.app.request(`${ORIGIN}${path}`, {
            method,
            headers: {
              origin: ORIGIN,
              [HEADER]: "preprod",
              ...authHdr,
              ...(method === "POST"
                ? { "content-type": "application/json" }
                : {}),
            },
            ...(method === "POST" ? { body: "{}" } : {}),
          });
          await drainBackground();
          const body = (await res.json()) as {
            kind?: string;
            message?: string;
          };
          expect([
            modeLabel,
            method,
            path,
            res.status,
            body.kind,
            body.message,
          ]).toEqual([
            modeLabel,
            method,
            path,
            422,
            CORE_API_ERROR_KINDS.MAINNET_ONLY_FEATURE,
            EXPECTED_MESSAGE,
          ]);
          expect([modeLabel, method, path, recorded.statements]).toEqual([
            modeLabel,
            method,
            path,
            [],
          ]);
          expect([modeLabel, method, path, recorded.providers]).toEqual([
            modeLabel,
            method,
            path,
            [],
          ]);
        }
      }

      const digestAfter = await billingTablesDigest(loaded);
      expect(digestAfter).toEqual(digestBefore);
    });

    it("automatically gates a route added later under any gated billing router", async () => {
      let probeHit = 0;
      const probe = (c: { json: (v: unknown) => Response }) => {
        probeHit += 1;
        return c.json({ ok: true });
      };

      const { default: checkoutRouter } = await import(
        "@/routes/v1/checkout/index"
      );
      const { default: productsRouter } = await import(
        "@/routes/v1/products/index"
      );
      const { default: couponsRouter } = await import(
        "@/routes/v1/coupons/index"
      );
      const { default: enterpriseRouter } = await import(
        "@/routes/v1/enterprise/index"
      );
      const { default: adminRouter } = await import("@/routes/v1/admin/index");
      const { default: organizationsRouter } = await import(
        "@/routes/v1/organizations/index"
      );
      const { default: authRouter } = await import("@/routes/auth/index");

      checkoutRouter.get("/__probe-28-2", probe);
      productsRouter.get("/__probe-28-2", probe);
      couponsRouter.get("/__probe-28-2", probe);
      enterpriseRouter.get("/__probe-28-2", probe);
      adminRouter.get("/invoices/__probe-28-2", probe);
      organizationsRouter.get("/:id/subscription/__probe-28-2", probe);

      const { errorHandler } = await import("@/helpers/error-handler");
      const { requestNetworkMiddleware } = await import(
        "@/middleware/network-scope"
      );
      const probeApp = new Hono();
      probeApp.onError(errorHandler);
      probeApp.use("/v1/*", requestNetworkMiddleware);
      probeApp.route("/v1/checkout", checkoutRouter);
      probeApp.route("/v1/products", productsRouter);
      probeApp.route("/v1/coupons", couponsRouter);
      probeApp.route("/v1/enterprise", enterpriseRouter);
      probeApp.route("/v1/admin", adminRouter);
      probeApp.route("/v1/organizations", organizationsRouter);
      probeApp.route("/auth", authRouter);

      const probePaths = [
        "/v1/checkout/__probe-28-2",
        "/v1/products/__probe-28-2",
        "/v1/coupons/__probe-28-2",
        "/v1/enterprise/__probe-28-2",
        "/v1/admin/invoices/__probe-28-2",
        `/v1/organizations/${ORG_ID}/subscription/__probe-28-2`,
        "/auth/subscription/__probe-28-2",
      ];

      for (const path of probePaths) {
        const res = await probeApp.request(`${ORIGIN}${path}`, {
          headers: {
            origin: ORIGIN,
            authorization: `Bearer ${ADMIN_OAUTH_TOKEN}`,
            [HEADER]: "preprod",
          },
        });
        expect([path, res.status]).toEqual([path, 422]);
        expect(await res.json()).toMatchObject({
          kind: CORE_API_ERROR_KINDS.MAINNET_ONLY_FEATURE,
          message: EXPECTED_MESSAGE,
        });
      }
      expect(probeHit).toBe(0);
    });

    it("keeps 400 network_unknown, 401 unauthenticated on /v1, OPTIONS preflight, and Better Auth ungated routes intact", async () => {
      const v1BillingTargets: ReadonlyArray<readonly [string, string]> = [
        ["POST", "/v1/checkout/credits"],
        ["GET", "/v1/products/credits"],
        ["GET", "/v1/coupons/coupon_fixed_28_2"],
        ["GET", "/v1/enterprise/contracts"],
        ["GET", "/v1/admin/invoices"],
        ["GET", `/v1/organizations/${ORG_ID}/billing-details`],
        ["GET", `/v1/organizations/${ORG_ID}/credit-spend`],
        ["GET", "/v1/users/me/billing-details"],
      ];

      // Invalid header values -> 400 network_unknown across all 8 mounts (including /auth)
      for (const badVal of ["testnet", "Mainnet", "PREPROD"]) {
        for (const [method, path] of [
          ...v1BillingTargets,
          ["GET", "/auth/subscription/list"] as const,
        ]) {
          const res = await loaded.app.request(`${ORIGIN}${path}`, {
            method,
            headers: { origin: ORIGIN, [HEADER]: badVal },
          });
          expect([badVal, method, path, res.status]).toEqual([
            badVal,
            method,
            path,
            400,
          ]);
          expect(await res.json()).toMatchObject({
            kind: CORE_API_ERROR_KINDS.NETWORK_UNKNOWN,
          });
        }
      }

      // Unauthenticated with preprod -> 401 on all 7 /v1 mounts
      for (const [method, path] of v1BillingTargets) {
        const res = await loaded.app.request(`${ORIGIN}${path}`, {
          method,
          headers: { origin: ORIGIN, [HEADER]: "preprod" },
        });
        expect([method, path, res.status]).toEqual([method, path, 401]);
      }

      // Non-subscription /auth routes stay open under preprod (kills widening guard to all of /auth)
      const sessionRes = await loaded.app.request(
        `${ORIGIN}/auth/get-session`,
        {
          headers: {
            origin: ORIGIN,
            cookie: seeded.sessionCookie,
            [HEADER]: "preprod",
          },
        },
      );
      expect(sessionRes.status).toBe(200);

      const oidcRes = await loaded.app.request(
        `${ORIGIN}/auth/.well-known/openid-configuration`,
        { headers: { origin: ORIGIN, [HEADER]: "preprod" } },
      );
      expect(oidcRes.status).toBe(200);

      // OPTIONS preflight on /auth/subscription/* stays 204
      const optRes = await loaded.app.request(
        `${ORIGIN}/auth/subscription/list`,
        {
          method: "OPTIONS",
          headers: {
            origin: ORIGIN,
            "access-control-request-method": "GET",
            [HEADER]: "preprod",
          },
        },
      );
      expect(optRes.status).toBe(204);
    });

    it("leaves Stripe and Polar webhooks, renewal crons, members/me/seat, and all four Seat assignment routes open under preprod", async () => {
      const preprodAuth = {
        origin: ORIGIN,
        authorization: `Bearer ${ADMIN_OAUTH_TOKEN}`,
        [HEADER]: "preprod",
      };

      // 1. Signed Stripe webhook under preprod acts on Mainnet; bad sig stays 400.
      expectCoreLog(
        "error",
        "No signatures found matching the expected signature for payload.",
        1,
      );
      const badStripeRes = await loaded.app.request(
        `${ORIGIN}/auth/stripe/webhook`,
        {
          method: "POST",
          headers: {
            origin: ORIGIN,
            "content-type": "application/json",
            "stripe-signature": "t=1700000000,v1=0000000000000000",
            [HEADER]: "preprod",
          },
          body: "{}",
        },
      );
      expect(badStripeRes.status).toBe(400);

      if (!onSplitLayout) {
        // On today's layout, invoice.paid grants credits to the Mainnet ledger
        // (handleInvoicePaidEvent re-reads the invoice via stripeClient.getInvoice,
        // which returns customer "cus_org_28_2" -> organizationId ORG_ID).
        const mainnetDb = loaded.createNetworkScope("mainnet").networkDb;
        const txBefore = await mainnetDb.transaction.count({
          where: { organizationId: ORG_ID },
        });
        const invoiceEvent = signedStripeEvent({
          id: "evt_inv_paid_28_2",
          object: "event",
          api_version: "2026-02-25.clover",
          created: 1795824000,
          livemode: false,
          type: "invoice.paid",
          data: {
            object: {
              id: "in_wh_28_2",
              object: "invoice",
              customer: "cus_org_28_2",
              status: "paid",
              billing_reason: "manual",
              created: 1795824000,
              metadata: {
                credits: "100",
                grant_source: "admin_one_time_credit",
              },
              lines: {
                data: [
                  {
                    pricing: {
                      price_details: { product: "prod_credit_fixed" },
                    },
                    quantity: 100,
                    amount: 12000,
                  },
                ],
              },
            },
          },
        });
        const goodStripeRes = await loaded.app.request(
          `${ORIGIN}/auth/stripe/webhook`,
          {
            method: "POST",
            headers: {
              origin: ORIGIN,
              "content-type": "application/json",
              "stripe-signature": invoiceEvent.signature,
              [HEADER]: "preprod",
            },
            body: invoiceEvent.payload,
          },
        );
        await drainBackground();
        expect(goodStripeRes.status).toBe(200);
        const txAfter = await mainnetDb.transaction.count({
          where: { organizationId: ORG_ID },
        });
        expect(txAfter).toBe(txBefore + 1);
      } else {
        // On split layout, grant.ts still writes Transaction on shared tx until
        // slice 28-3 / ticket 27 moves it; prove signed Stripe customer.created
        // succeeds (200) and leaves Preprod's ledger empty.
        const customerEvent = signedStripeEvent({
          id: "evt_cust_28_2",
          object: "event",
          api_version: "2026-02-25.clover",
          created: 1795824000,
          livemode: false,
          type: "customer.created",
          data: {
            object: {
              id: "cus_user_28_2",
              object: "customer",
              email: "admin-28-2@example.test",
              metadata: { userId: ADMIN_USER_ID, customerType: "user" },
            },
          },
        });
        const goodStripeRes = await loaded.app.request(
          `${ORIGIN}/auth/stripe/webhook`,
          {
            method: "POST",
            headers: {
              origin: ORIGIN,
              "content-type": "application/json",
              "stripe-signature": customerEvent.signature,
              [HEADER]: "preprod",
            },
            body: customerEvent.payload,
          },
        );
        await drainBackground();
        expect(goodStripeRes.status).toBe(200);
        const preprodDb = loaded.createNetworkScope("preprod").networkDb;
        expect(await preprodDb.transaction.count()).toBe(0);
      }

      // 2. Signed Polar webhook under preprod acts on Mainnet; bad sig stays 403.
      polarVerify.mockResolvedValueOnce(err("invalid_signature"));
      const badPolarRes = await loaded.app.request(
        `${ORIGIN}/v1/webhooks/polar`,
        {
          method: "POST",
          headers: {
            origin: ORIGIN,
            "content-type": "application/json",
            [HEADER]: "preprod",
          },
          body: "{}",
        },
      );
      expect(badPolarRes.status).toBe(403);

      const polarSub = {
        id: "polar_sub_28_2",
        status: "active",
        product_id: "prod_growth_month",
        recurring_interval: "month",
        current_period_start: "2026-11-13T10:00:00.000Z",
        current_period_end: "2026-12-13T10:00:00.000Z",
        cancel_at_period_end: false,
        ended_at: null,
      };
      const polarCheckout = {
        metadata: {
          kind: "plan",
          projectId: PROJECT_ID,
          organizationId: ORG_ID,
          userId: ADMIN_USER_ID,
        },
        customer: { id: "polar_cus_28_2", external_id: ORG_ID },
        product: {
          id: polarSub.product_id,
          name: "Growth",
          metadata: { kind: "plan", tier: "growth", credits: "25000" },
        },
      };

      if (!onSplitLayout) {
        const mainnetDb = loaded.createNetworkScope("mainnet").networkDb;
        const orgTxBefore = await mainnetDb.transaction.count({
          where: { organizationId: ORG_ID },
        });
        polarVerify.mockResolvedValueOnce(
          okResult({
            type: "order.paid",
            timestamp: "2026-11-13T10:00:05.000Z",
            data: {
              ...polarCheckout,
              id: "polar_ord_28_2",
              billing_reason: "subscription_create",
              subscription: polarSub,
            },
          }),
        );
        const goodPolarRes = await loaded.app.request(
          `${ORIGIN}/v1/webhooks/polar`,
          {
            method: "POST",
            headers: {
              origin: ORIGIN,
              "content-type": "application/json",
              [HEADER]: "preprod",
            },
            body: "{}",
          },
        );
        await drainBackground();
        expect(goodPolarRes.status).toBe(200);
        const orgTxAfter = await mainnetDb.transaction.count({
          where: { organizationId: ORG_ID },
        });
        expect(orgTxAfter).toBe(orgTxBefore + 1);
      } else {
        polarVerify.mockResolvedValueOnce(
          okResult({
            type: "subscription.updated",
            timestamp: "2026-11-13T10:05:00.000Z",
            data: { ...polarCheckout, ...polarSub, pending_update: null },
          }),
        );
        const goodPolarRes = await loaded.app.request(
          `${ORIGIN}/v1/webhooks/polar`,
          {
            method: "POST",
            headers: {
              origin: ORIGIN,
              "content-type": "application/json",
              [HEADER]: "preprod",
            },
            body: "{}",
          },
        );
        await drainBackground();
        expect(goodPolarRes.status).toBe(200);
        const preprodDb = loaded.createNetworkScope("preprod").networkDb;
        expect(await preprodDb.transaction.count()).toBe(0);
      }

      // 3. Renewal cron under preprod is unchanged.
      const cronRes = await loaded.app.request(
        `${ORIGIN}/sync/free-subscriptions-renewal`,
        {
          method: "GET",
          headers: {
            authorization: `Bearer ${CRON_SECRET}`,
            [HEADER]: "preprod",
          },
        },
      );
      await drainBackground();
      expect(cronRes.status).toBe(200);

      // 4. Seat read admitting work stays 200 under preprod.
      const meSeatRes = await loaded.app.request(
        `${ORIGIN}/v1/organizations/${ORG_ID}/members/me/seat`,
        { headers: preprodAuth },
      );
      expect(meSeatRes.status).toBe(200);
      expect(await meSeatRes.json()).toMatchObject({
        data: { assigned: true },
      });

      // 5. All four Seat assignment routes stay open under preprod (owner decision 2026-11-28).
      const orgSeatPut = await loaded.app.request(
        `${ORIGIN}/v1/organizations/${ORG_ID}/members/${PLAIN_MEMBER_ID}/seat`,
        { method: "PUT", headers: preprodAuth },
      );
      expect(orgSeatPut.status).toBe(200);

      const orgSeatDel = await loaded.app.request(
        `${ORIGIN}/v1/organizations/${ORG_ID}/members/${PLAIN_MEMBER_ID}/seat`,
        { method: "DELETE", headers: preprodAuth },
      );
      expect(orgSeatDel.status).toBe(200);

      const adminSeatPut = await loaded.app.request(
        `${ORIGIN}/v1/admin/organizations/${ORG_SLUG}/members/${PLAIN_MEMBER_ID}/seat`,
        { method: "PUT", headers: preprodAuth },
      );
      expect(adminSeatPut.status).toBe(200);

      const adminSeatDel = await loaded.app.request(
        `${ORIGIN}/v1/admin/organizations/${ORG_SLUG}/members/${PLAIN_MEMBER_ID}/seat`,
        { method: "DELETE", headers: preprodAuth },
      );
      expect(adminSeatDel.status).toBe(200);

      // 6. Generic org & user reads stay open under preprod.
      const orgGet = await loaded.app.request(
        `${ORIGIN}/v1/organizations/${ORG_ID}`,
        { headers: preprodAuth },
      );
      expect(orgGet.status).toBe(200);

      const userGet = await loaded.app.request(`${ORIGIN}/v1/users/me`, {
        headers: preprodAuth,
      });
      expect(userGet.status).toBe(200);
    });

    it.runIf(onSplitLayout)(
      "handles Preprod API keys (422 without header), Mainnet API keys (normal), and contradicted keys (403 api_key_network_mismatch) across all /v1 billing mounts",
      async () => {
        const preprodKey = await loaded.fixture.createApiKey(
          ADMIN_USER_ID,
          "soko_preprod_",
        );
        const mainnetKey = await loaded.fixture.createApiKey(
          ADMIN_USER_ID,
          "soko_mainnet_",
        );

        recorded.statements.length = 0;
        const ping = await loaded.app.request(`${ORIGIN}/__auth-only/ping`, {
          headers: { origin: ORIGIN, authorization: `Bearer ${preprodKey}` },
        });
        expect(ping.status).toBe(200);
        const apiKeyAuthCount = recorded.statements.length;

        const keyTargets: ReadonlyArray<readonly [string, string]> = [
          ["GET", "/v1/checkout/sessions/cs_28_2"],
          ["GET", "/v1/products/credits"],
          ["GET", "/v1/coupons/coupon_fixed_28_2"],
          ["GET", "/v1/enterprise/contracts"],
          ["GET", "/v1/admin/invoices"],
          ["GET", `/v1/organizations/${ORG_ID}/billing-details`],
          ["GET", `/v1/organizations/${ORG_ID}/credit-spend`],
          ["GET", "/v1/users/me/billing-details"],
        ];

        for (const [method, path] of keyTargets) {
          // Preprod API key without header -> 422 mainnet_only_feature, 0 statements after auth
          recorded.statements.length = 0;
          recorded.providers.length = 0;
          const preprodRes = await loaded.app.request(`${ORIGIN}${path}`, {
            method,
            headers: { origin: ORIGIN, authorization: `Bearer ${preprodKey}` },
          });
          expect([method, path, preprodRes.status]).toEqual([
            method,
            path,
            422,
          ]);
          expect(await preprodRes.json()).toMatchObject({
            kind: CORE_API_ERROR_KINDS.MAINNET_ONLY_FEATURE,
            message: EXPECTED_MESSAGE,
          });
          expect([method, path, recorded.statements.length]).toEqual([
            method,
            path,
            apiKeyAuthCount,
          ]);
          expect(recorded.providers).toEqual([]);

          // Mainnet API key without header -> 200 normal answer
          const mainnetRes = await loaded.app.request(`${ORIGIN}${path}`, {
            method,
            headers: { origin: ORIGIN, authorization: `Bearer ${mainnetKey}` },
          });
          expect([method, path, mainnetRes.status]).toEqual([
            method,
            path,
            200,
          ]);

          // Contradicted keys -> 403 api_key_network_mismatch, 0 statements after auth
          recorded.statements.length = 0;
          const contradictedMainnet = await loaded.app.request(
            `${ORIGIN}${path}`,
            {
              method,
              headers: {
                origin: ORIGIN,
                authorization: `Bearer ${mainnetKey}`,
                [HEADER]: "preprod",
              },
            },
          );
          expect([method, path, contradictedMainnet.status]).toEqual([
            method,
            path,
            403,
          ]);
          expect(await contradictedMainnet.json()).toMatchObject({
            kind: CORE_API_ERROR_KINDS.API_KEY_NETWORK_MISMATCH,
          });
          expect(recorded.statements.length).toBe(apiKeyAuthCount);

          recorded.statements.length = 0;
          const contradictedPreprod = await loaded.app.request(
            `${ORIGIN}${path}`,
            {
              method,
              headers: {
                origin: ORIGIN,
                authorization: `Bearer ${preprodKey}`,
                [HEADER]: "mainnet",
              },
            },
          );
          expect([method, path, contradictedPreprod.status]).toEqual([
            method,
            path,
            403,
          ]);
          expect(await contradictedPreprod.json()).toMatchObject({
            kind: CORE_API_ERROR_KINDS.API_KEY_NETWORK_MISMATCH,
          });
          expect(recorded.statements.length).toBe(apiKeyAuthCount);
        }
      },
    );
  },
);
