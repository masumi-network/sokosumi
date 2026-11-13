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
  clearPolarPendingPlanChange: vi.fn(),
  createPolarCustomerPortalUrl: vi.fn(),
  listPolarProducts: vi.fn(),
  prisma: {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    polarSubscription: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    member: { findFirst: vi.fn() },
    project: { findUnique: vi.fn() },
    sokoBot: { findFirst: vi.fn(), updateMany: vi.fn() },
    task: { findMany: vi.fn() },
    transaction: { create: vi.fn() },
    workspace: { findUnique: vi.fn() },
  },
}));

vi.mock("@/clients/polar.client", () => ({
  changePolarSubscriptionPlan: m.changePolarSubscriptionPlan,
  clearPolarPendingPlanChange: m.clearPolarPendingPlanChange,
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
  pendingPolarProductId: null,
};

/** When Polar made the change, by its own clock. */
const MODIFIED_AT = "2026-12-28T22:00:00.000Z";

/** Polar's answer to a plan change: the subscription as it is now. */
function polarSubscription(patch: Record<string, unknown> = {}) {
  return {
    id: "sub_1",
    modified_at: MODIFIED_AT,
    status: "active",
    product_id: "prod_growth_month",
    product: plan("growth", "month", 25_000),
    recurring_interval: "month",
    current_period_start: "2026-12-13T10:00:00.000Z",
    current_period_end: "2027-01-13T10:00:00.000Z",
    cancel_at_period_end: false,
    ended_at: null,
    metadata: { projectId: PROJECT_ID },
    customer: { id: "cus_1", external_id: "org-1" },
    pending_update: null,
    ...patch,
  };
}

/** A plan change's claim on the row, or its release. */
function isClaimWrite(args: { data: Record<string, unknown> }) {
  return "planChangeClaimedAt" in args.data;
}

/** Every write to the stored subscription row, with its newest-state guard. */
function rowWrites() {
  return m.prisma.polarSubscription.updateMany.mock.calls
    .map(([args]) => args)
    .filter((args) => !isClaimWrite(args));
}

/** Whether a plan change holds the row, as the claim's conditional write sees it. */
let claimed = false;

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
  m.changePolarSubscriptionPlan.mockResolvedValue(ok(polarSubscription()));
  m.clearPolarPendingPlanChange.mockResolvedValue(ok(polarSubscription()));
  m.prisma.polarSubscription.findUnique.mockResolvedValue({
    id: "row-1",
    projectId: PROJECT_ID,
    organizationId: "org-1",
  });
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
  m.prisma.polarSubscription.findFirst.mockResolvedValue(SUBSCRIPTION);
  claimed = false;
  m.prisma.polarSubscription.updateMany.mockImplementation(async (args) => {
    if (!isClaimWrite(args)) return { count: 1 };
    if (args.data.planChangeClaimedAt === null) {
      claimed = false;
      return { count: 1 };
    }
    if (claimed) return { count: 0 };
    claimed = true;
    return { count: 1 };
  });
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

  it("refuses a second change while the first is still at Polar, then reads the tier the first left", async () => {
    m.prisma.polarSubscription.findFirst.mockResolvedValue({
      ...SUBSCRIPTION,
      polarProductId: "prod_starter_month",
    });
    let answer = (_value: unknown) => {};
    m.changePolarSubscriptionPlan.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const first = changePlan("growth");
    await vi.waitFor(() =>
      expect(m.changePolarSubscriptionPlan).toHaveBeenCalledTimes(1),
    );

    const second = await changePlan("scale");

    expect(second.status).toBe(409);
    expect((await second.json()).kind).toBe("subscription_change_not_allowed");
    expect(m.changePolarSubscriptionPlan).toHaveBeenCalledTimes(1);

    answer(ok(polarSubscription()));
    expect((await first).status).toBe(200);
    // The first change left Growth; the next change counts its credits from it.
    m.prisma.polarSubscription.findFirst.mockResolvedValue({
      ...SUBSCRIPTION,
      polarProductId: "prod_growth_month",
    });
    expect((await changePlan("scale")).status).toBe(200);
    expect(m.changePolarSubscriptionPlan).toHaveBeenLastCalledWith({
      polarSubscriptionId: "sub_1",
      productId: "prod_scale_month",
      upgradeFromCredits: 25_000,
    });
  });

  it("releases the subscription when Polar refuses the change", async () => {
    m.changePolarSubscriptionPlan.mockResolvedValueOnce(err("not_changeable"));

    expect((await changePlan("scale")).status).toBe(409);
    expect(claimed).toBe(false);
  });

  it("writes the upgraded tier onto the subscription before answering", async () => {
    m.changePolarSubscriptionPlan.mockResolvedValue(
      ok(
        polarSubscription({
          product_id: "prod_scale_month",
          product: plan("scale", "month", 50_000),
        }),
      ),
    );

    await changePlan("scale");

    // Polar's webhooks follow seconds later; one older than this changes nothing.
    expect(rowWrites()).toEqual([
      {
        where: {
          polarSubscriptionId: "sub_1",
          polarEventAt: { lte: new Date(MODIFIED_AT) },
        },
        data: expect.objectContaining({
          polarProductId: "prod_scale_month",
          tier: "scale",
          pendingPolarProductId: null,
          polarEventAt: new Date(MODIFIED_AT),
        }),
      },
    ]);
  });

  it("writes the scheduled downgrade as the pending tier before answering", async () => {
    m.changePolarSubscriptionPlan.mockResolvedValue(
      ok(
        polarSubscription({
          pending_update: { product_id: "prod_starter_month" },
        }),
      ),
    );

    await changePlan("starter");

    expect(rowWrites()).toEqual([
      {
        where: {
          polarSubscriptionId: "sub_1",
          polarEventAt: { lte: new Date(MODIFIED_AT) },
        },
        data: expect.objectContaining({
          tier: "growth",
          pendingPolarProductId: "prod_starter_month",
        }),
      },
    ]);
  });

  it("leaves the subscription as it was when the upgrade's payment fails", async () => {
    m.changePolarSubscriptionPlan.mockResolvedValue(err("payment_failed"));

    await changePlan("scale");

    expect(rowWrites()).toEqual([]);
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
    m.prisma.polarSubscription.findFirst.mockResolvedValue({
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

  it("grants a yearly plan's started month at the old tier before it upgrades", async () => {
    const DAY = 86_400_000;
    // Month 1 of the paid year began ten days ago; the grant job has not run.
    const periodStart = new Date(Date.now() - 40 * DAY);
    m.prisma.polarSubscription.findFirst.mockResolvedValue({
      ...SUBSCRIPTION,
      id: "row-1",
      projectId: PROJECT_ID,
      organizationId: "org-1",
      polarProductId: "prod_growth_year",
      interval: "year",
      currentPeriodStart: periodStart,
      lastPaidOrderId: "order_y1",
    });
    m.prisma.$transaction.mockImplementation((run) => run(m.prisma));
    m.prisma.$queryRaw.mockImplementation(async (sql: string[]) =>
      sql.join("?").includes('"polar_subscription"')
        ? [
            {
              endedAt: null,
              lastPaidOrderId: "order_y1",
              lastPaidOrderRefundedAt: null,
            },
          ]
        : [],
    );
    m.prisma.task.findMany.mockResolvedValue([]);
    m.prisma.transaction.create.mockResolvedValue({ id: "tx_1" });
    // The grant write-locks the live Cuso's row.
    m.prisma.sokoBot.updateMany.mockResolvedValue({ count: 1 });

    const response = await changePlan("scale");

    expect(response.status).toBe(200);
    // The upgrade's own order then adds the prorated rest of month 1; the
    // grant job would have granted the whole month at the new tier.
    expect(m.prisma.transaction.create).toHaveBeenCalledTimes(1);
    expect(
      m.prisma.transaction.create.mock.calls[0]?.[0].data.sourceCreditBucket
        .create,
    ).toMatchObject({
      amount: 25_000n * 10_000_000_000n,
      referenceId: "order_y1:1",
      referenceType: "POLAR_SUBSCRIPTION_MONTH",
    });
    expect(
      m.prisma.transaction.create.mock.invocationCallOrder[0],
    ).toBeLessThan(
      m.changePolarSubscriptionPlan.mock.invocationCallOrder[0] ?? 0,
    );
  });

  describe("keeping the plan while a downgrade is pending", () => {
    beforeEach(() => {
      m.prisma.polarSubscription.findFirst.mockResolvedValue({
        ...SUBSCRIPTION,
        pendingPolarProductId: "prod_starter_month",
      });
    });

    it("clears the pending change at Polar and on the subscription", async () => {
      const response = await changePlan("growth");

      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual({ change: "kept" });
      expect(m.clearPolarPendingPlanChange).toHaveBeenCalledExactlyOnceWith(
        "sub_1",
      );
      expect(m.changePolarSubscriptionPlan).not.toHaveBeenCalled();
      expect(rowWrites()).toEqual([
        {
          where: {
            polarSubscriptionId: "sub_1",
            polarEventAt: { lte: new Date(MODIFIED_AT) },
          },
          data: expect.objectContaining({
            tier: "growth",
            pendingPolarProductId: null,
          }),
        },
      ]);
    });

    it("leaves the subscription as it was when Polar refuses", async () => {
      m.clearPolarPendingPlanChange.mockResolvedValue(err("not_changeable"));

      const response = await changePlan("growth");

      expect(response.status).toBe(409);
      expect((await response.json()).kind).toBe(
        "subscription_change_not_allowed",
      );
      expect(rowWrites()).toEqual([]);
    });

    it("is for owners and admins only", async () => {
      callerIs("member");

      const response = await changePlan("growth");

      expect(response.status).toBe(403);
      expect(m.clearPolarPendingPlanChange).not.toHaveBeenCalled();
      expect(rowWrites()).toEqual([]);
    });

    it("answers 503 without Polar configuration", async () => {
      m.clearPolarPendingPlanChange.mockRejectedValue(
        serviceUnavailable("Polar is not configured"),
      );

      expect((await changePlan("growth")).status).toBe(503);
      expect(rowWrites()).toEqual([]);
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
    m.prisma.polarSubscription.findFirst.mockResolvedValue({
      ...SUBSCRIPTION,
      ...row,
    });

    const response = await changePlan(tier);

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.kind).toBe(kind);
    expect(body.message).toContain(reason);
    expect(m.changePolarSubscriptionPlan).not.toHaveBeenCalled();
    expect(m.clearPolarPendingPlanChange).not.toHaveBeenCalled();
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
    m.prisma.polarSubscription.findFirst.mockResolvedValue(null);

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
