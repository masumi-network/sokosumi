import { err, ok } from "neverthrow";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { serviceUnavailable } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";

/** Changing a Cuso's CMO plan and opening Polar's portal (ADR 0068). */

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const m = vi.hoisted(() => ({
  changePolarSubscriptionPlan: vi.fn(),
  createPolarCustomerPortalUrl: vi.fn(),
  listPolarProducts: vi.fn(),
  prisma: {
    cmoSubscription: { findFirst: vi.fn() },
    member: { findFirst: vi.fn() },
    project: { findUnique: vi.fn() },
    sokoBot: { findFirst: vi.fn() },
    workspace: { findUnique: vi.fn() },
  },
}));

vi.mock("@/clients/polar.client", () => ({
  changePolarSubscriptionPlan: m.changePolarSubscriptionPlan,
  createPolarCustomerPortalUrl: m.createPolarCustomerPortalUrl,
  listPolarProducts: m.listPolarProducts,
}));
vi.mock("@/lib/db/prisma", () => ({ default: m.prisma }));
vi.mock("@sentry/node", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";
const RETURN_URL = `https://app.cmo.xyz/?project=${PROJECT_ID}&view=settings`;
const PORTAL_URL = "https://sandbox.polar.sh/acme/portal?customer_session=1";

function plan(tier: string, interval: "month" | "year", credits: number) {
  return {
    id: `prod_${tier}_${interval}`,
    name: tier,
    is_archived: false,
    is_recurring: true,
    recurring_interval: interval,
    recurring_interval_count: 1,
    metadata: { kind: "plan", tier, credits: String(credits) },
    prices: [
      {
        amount_type: "fixed",
        price_amount: credits * 2,
        price_currency: "usd",
        is_archived: false,
      },
    ],
  };
}

// The tier slugs are Polar's; Core orders the plans by credits.
const PRODUCTS = [
  plan("scale", "month", 50_000),
  plan("starter", "year", 10_000),
  plan("growth", "month", 25_000),
  plan("starter", "month", 10_000),
  plan("scale", "year", 50_000),
  plan("growth", "year", 25_000),
];

/** The Cuso's monthly Growth subscription, paid and running. */
const SUBSCRIPTION = {
  polarSubscriptionId: "sub_1",
  polarProductId: "prod_growth_month",
  interval: "month",
  status: "active",
  cancelAtPeriodEnd: false,
};

// Loading the routes takes seconds on a busy machine.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

let app: OpenAPIHonoWithAuth;
beforeAll(async () => {
  const [{ default: mountPlan }, { default: mountPortal }] = await Promise.all([
    import("./post"),
    import("../portal/post"),
  ]);
  app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user-1",
      organizationId: null,
      role: "user",
      authenticationMethod: "oauth",
      oauthClientId: "cmo-oauth-client",
    });
    return await next();
  });
  mountPlan(app);
  mountPortal(app);
  app.onError(errorHandler);
});

function changePlan(tier: string) {
  return app.request(`/projects/${PROJECT_ID}/plan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tier }),
  });
}

function openPortal(returnUrl = RETURN_URL) {
  return app.request(`/projects/${PROJECT_ID}/portal`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ returnUrl }),
  });
}

/** The caller's role in Cuso's organization. */
function callerIs(role: string) {
  m.prisma.member.findFirst.mockResolvedValue({ id: "member-1", role });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.listPolarProducts.mockResolvedValue(PRODUCTS);
  m.changePolarSubscriptionPlan.mockResolvedValue(ok(undefined));
  m.createPolarCustomerPortalUrl.mockResolvedValue(PORTAL_URL);
  m.prisma.project.findUnique.mockResolvedValue({
    id: PROJECT_ID,
    workspaceId: "ws-1",
    workspace: { userId: null, organizationId: "org-1" },
  });
  callerIs("admin");
  m.prisma.sokoBot.findFirst.mockResolvedValue({
    id: "bot-1",
    createdAt: new Date("2026-11-01T09:00:00.000Z"),
    project: {
      id: PROJECT_ID,
      workspaceId: "ws-1",
      websiteUrl: "https://acme.io",
      workspace: { organizationId: "org-1" },
      brandBrain: null,
    },
  });
  m.prisma.workspace.findUnique.mockResolvedValue({ organizationId: "org-1" });
  m.prisma.cmoSubscription.findFirst.mockResolvedValue(SUBSCRIPTION);
});

describe("POST /v1/cmo/projects/{projectId}/plan", () => {
  it("upgrades at once: Polar invoices the prorated difference", async () => {
    const response = await changePlan("scale");

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ change: "upgrade" });
    expect(m.changePolarSubscriptionPlan).toHaveBeenCalledExactlyOnceWith({
      polarSubscriptionId: "sub_1",
      productId: "prod_scale_month",
      upgradeFromCredits: 25_000,
    });
  });

  it("schedules a downgrade for the next period", async () => {
    const response = await changePlan("starter");

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ change: "downgrade" });
    expect(m.changePolarSubscriptionPlan).toHaveBeenCalledExactlyOnceWith({
      polarSubscriptionId: "sub_1",
      productId: "prod_starter_month",
    });
  });

  it("moves a yearly plan only within the yearly plans", async () => {
    m.prisma.cmoSubscription.findFirst.mockResolvedValue({
      ...SUBSCRIPTION,
      polarProductId: "prod_growth_year",
      interval: "year",
    });

    await changePlan("scale");

    expect(m.changePolarSubscriptionPlan).toHaveBeenCalledExactlyOnceWith({
      polarSubscriptionId: "sub_1",
      productId: "prod_scale_year",
      upgradeFromCredits: 25_000,
    });
  });

  it.each([
    [
      "the current tier",
      "growth",
      {},
      "subscription_change_not_allowed",
      "on that plan already",
    ],
    [
      "a tier the interval does not have",
      "enterprise",
      {},
      "subscription_change_not_allowed",
      "billed monthly",
    ],
    [
      "a past due subscription",
      "scale",
      { status: "past_due" },
      "subscription_not_active",
      "payment failed",
    ],
    [
      "a subscription scheduled to cancel",
      "scale",
      { cancelAtPeriodEnd: true },
      "subscription_change_not_allowed",
      "Undo the cancel",
    ],
  ])("refuses %s with a reason", async (_, tier, row, kind, reason) => {
    m.prisma.cmoSubscription.findFirst.mockResolvedValue({
      ...SUBSCRIPTION,
      ...row,
    });

    const response = await changePlan(tier);

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.kind).toBe(kind);
    expect(body.message).toContain(reason);
    expect(m.changePolarSubscriptionPlan).not.toHaveBeenCalled();
  });

  it("refuses a tier of the other interval", async () => {
    m.listPolarProducts.mockResolvedValue(
      PRODUCTS.filter((product) => product.id !== "prod_scale_month"),
    );
    // A fresh catalog: it is cached for the process lifetime.
    vi.resetModules();
    const { default: mountPlan } = await import("./post");
    const fresh = new OpenAPIHonoWithAuth();
    fresh.use("*", async (c, next) => {
      c.set("isAuthenticated", true);
      c.set("authContext", {
        actor: "user",
        userId: "user-1",
        organizationId: null,
        role: "user",
        authenticationMethod: "oauth",
        oauthClientId: "cmo-oauth-client",
      });
      return await next();
    });
    mountPlan(fresh);
    fresh.onError(errorHandler);

    const response = await fresh.request(`/projects/${PROJECT_ID}/plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tier: "scale" }),
    });

    expect(response.status).toBe(409);
    expect((await response.json()).message).toContain("billed monthly");
    expect(m.changePolarSubscriptionPlan).not.toHaveBeenCalled();
  });

  it("refuses a Cuso without a subscription", async () => {
    m.prisma.cmoSubscription.findFirst.mockResolvedValue(null);

    const response = await changePlan("scale");

    expect(response.status).toBe(409);
    expect((await response.json()).kind).toBe("subscription_not_active");
  });

  it("says so when Polar could not take the upgrade's payment", async () => {
    m.changePolarSubscriptionPlan.mockResolvedValue(err("payment_failed"));

    const response = await changePlan("scale");

    expect(response.status).toBe(409);
    expect((await response.json()).kind).toBe("subscription_payment_failed");
  });

  it.each(["member", null])(
    "is for owners and admins only, not a %s",
    async (role) => {
      if (role) callerIs(role);
      else m.prisma.member.findFirst.mockResolvedValue(null);

      const response = await changePlan("scale");

      expect(response.status).toBe(role ? 403 : 404);
      expect(m.changePolarSubscriptionPlan).not.toHaveBeenCalled();
    },
  );

  it("lets an owner change the plan", async () => {
    callerIs("owner");

    expect((await changePlan("scale")).status).toBe(200);
  });

  it("answers 503 without Polar configuration", async () => {
    m.changePolarSubscriptionPlan.mockRejectedValue(
      serviceUnavailable("Polar is not configured"),
    );

    expect((await changePlan("scale")).status).toBe(503);
  });
});

describe("POST /v1/cmo/projects/{projectId}/portal", () => {
  it("answers the organization's Polar customer portal link", async () => {
    const response = await openPortal();

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ url: PORTAL_URL });
    expect(m.createPolarCustomerPortalUrl).toHaveBeenCalledExactlyOnceWith({
      organizationId: "org-1",
      returnUrl: RETURN_URL,
    });
  });

  it("is for owners and admins only", async () => {
    callerIs("member");

    const response = await openPortal();

    expect(response.status).toBe(403);
    expect((await response.json()).kind).toBe("organization_role_forbidden");
    expect(m.createPolarCustomerPortalUrl).not.toHaveBeenCalled();
  });

  it("refuses an organization Polar does not know yet", async () => {
    m.createPolarCustomerPortalUrl.mockResolvedValue(null);

    const response = await openPortal();

    expect(response.status).toBe(409);
    expect((await response.json()).kind).toBe("subscription_not_active");
  });

  it("refuses a return address that is not CMO's", async () => {
    const response = await openPortal("https://evil.example/");

    expect(response.status).toBe(409);
    expect(m.createPolarCustomerPortalUrl).not.toHaveBeenCalled();
  });

  it("answers 503 without Polar configuration", async () => {
    m.createPolarCustomerPortalUrl.mockRejectedValue(
      serviceUnavailable("Polar is not configured"),
    );

    expect((await openPortal()).status).toBe(503);
  });
});
