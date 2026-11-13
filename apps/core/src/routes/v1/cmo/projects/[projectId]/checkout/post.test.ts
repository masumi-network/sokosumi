import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { serviceUnavailable } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const m = vi.hoisted(() => ({
  createPolarCheckout: vi.fn(),
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
  createPolarCheckout: m.createPolarCheckout,
  listPolarProducts: m.listPolarProducts,
}));
vi.mock("@/lib/db/prisma", () => ({ default: m.prisma }));
vi.mock("@sentry/node", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";
const RETURN_URL = `https://app.cmo.xyz/?project=${PROJECT_ID}&step=subscribed`;
const CHECKOUT_URL = "https://sandbox.polar.sh/checkout/polar_c_1";

function plan(
  tier: string,
  interval: "month" | "year",
  credits: number,
  amount: number,
) {
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
        price_amount: amount,
        price_currency: "usd",
        is_archived: false,
      },
    ],
  };
}

// ADR 0068's plans, in no particular order.
const PRODUCTS = [
  plan("scale", "month", 50_000, 100_000),
  plan("starter", "year", 10_000, 200_000),
  plan("growth", "month", 25_000, 50_000),
  plan("starter", "month", 10_000, 20_000),
  plan("scale", "year", 50_000, 1_000_000),
  plan("growth", "year", 25_000, 500_000),
];

// Loading the routes takes seconds on a busy machine.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

/**
 * The two routes on a fresh module graph: the catalog is cached for the
 * process lifetime, so a test that changes Polar's products starts over.
 */
async function freshApp() {
  vi.resetModules();
  const [{ default: mountCheckout }, { default: mountPlans }] =
    await Promise.all([import("./post"), import("@/routes/v1/cmo/plans/get")]);
  const app = new OpenAPIHonoWithAuth();
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
  mountCheckout(app);
  mountPlans(app);
  app.onError(errorHandler);
  return app;
}

/** The routes over ADR 0068's catalog, loaded once. */
let app: Awaited<ReturnType<typeof freshApp>>;
beforeAll(async () => {
  m.listPolarProducts.mockResolvedValue(PRODUCTS);
  app = await freshApp();
});

function startCheckout(body: Record<string, unknown>, on = app) {
  return on.request(`/projects/${PROJECT_ID}/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /v1/cmo/projects/{projectId}/checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.listPolarProducts.mockResolvedValue(PRODUCTS);
    m.createPolarCheckout.mockResolvedValue(CHECKOUT_URL);
    // A live Cuso in an organization the caller is a plain member of.
    m.prisma.project.findUnique.mockResolvedValue({
      id: PROJECT_ID,
      workspaceId: "ws-1",
      workspace: { userId: null, organizationId: "org-1" },
    });
    m.prisma.member.findFirst.mockResolvedValue({ id: "member-1" });
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
    m.prisma.workspace.findUnique.mockResolvedValue({
      organizationId: "org-1",
    });
    m.prisma.cmoSubscription.findFirst.mockResolvedValue(null);
  });

  it("answers Polar's checkout for the interval's three plans, for any member", async () => {
    const response = await startCheckout({
      interval: "month",
      returnUrl: RETURN_URL,
    });
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ url: CHECKOUT_URL });
    expect(m.createPolarCheckout).toHaveBeenCalledTimes(1);
    expect(m.createPolarCheckout).toHaveBeenCalledWith({
      productIds: [
        "prod_starter_month",
        "prod_growth_month",
        "prod_scale_month",
      ],
      organizationId: "org-1",
      metadata: {
        kind: "plan",
        projectId: PROJECT_ID,
        organizationId: "org-1",
        userId: "user-1",
      },
      returnUrl: RETURN_URL,
    });
  });

  it("offers the yearly plans for a yearly checkout", async () => {
    await startCheckout({ interval: "year", returnUrl: RETURN_URL });
    expect(m.createPolarCheckout.mock.calls[0]?.[0].productIds).toEqual([
      "prod_starter_year",
      "prod_growth_year",
      "prod_scale_year",
    ]);
  });

  it("puts the tier the person picked first, so Polar opens on it", async () => {
    await startCheckout({
      interval: "month",
      tier: "scale",
      returnUrl: RETURN_URL,
    });
    expect(m.createPolarCheckout.mock.calls[0]?.[0].productIds).toEqual([
      "prod_scale_month",
      "prod_starter_month",
      "prod_growth_month",
    ]);
  });

  it("refuses a Cuso whose subscription has not ended", async () => {
    m.prisma.cmoSubscription.findFirst.mockResolvedValue({ id: "sub-row-1" });
    const response = await startCheckout({
      interval: "month",
      returnUrl: RETURN_URL,
    });
    expect(response.status).toBe(409);
    expect(m.prisma.cmoSubscription.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: PROJECT_ID, endedAt: null },
      }),
    );
    expect(m.createPolarCheckout).not.toHaveBeenCalled();
  });

  it("answers 404 to a person outside the Cuso's organization", async () => {
    m.prisma.member.findFirst.mockResolvedValue(null);
    const response = await startCheckout({
      interval: "month",
      returnUrl: RETURN_URL,
    });
    expect(response.status).toBe(404);
    expect(m.createPolarCheckout).not.toHaveBeenCalled();
  });

  it("refuses a return address that is not CMO's own page", async () => {
    const response = await startCheckout({
      interval: "month",
      returnUrl: "https://evil.example/?paid=1",
    });
    expect(response.status).toBe(409);
    expect(m.createPolarCheckout).not.toHaveBeenCalled();
  });

  it("answers 422 for an interval CMO does not sell", async () => {
    const response = await startCheckout({
      interval: "week",
      returnUrl: RETURN_URL,
    });
    expect(response.status).toBe(422);
  });

  it("answers 503 without Polar configuration", async () => {
    m.listPolarProducts.mockRejectedValue(
      serviceUnavailable("Polar is not configured"),
    );
    const response = await startCheckout(
      { interval: "month", returnUrl: RETURN_URL },
      await freshApp(),
    );
    expect(response.status).toBe(503);
    expect(m.createPolarCheckout).not.toHaveBeenCalled();
  });

  it("answers 503 when Polar has no plan for the interval", async () => {
    m.listPolarProducts.mockResolvedValue(
      PRODUCTS.filter((product) => product.recurring_interval === "month"),
    );
    const response = await startCheckout(
      { interval: "year", returnUrl: RETURN_URL },
      await freshApp(),
    );
    expect(response.status).toBe(503);
    expect(m.createPolarCheckout).not.toHaveBeenCalled();
  });
});

describe("GET /v1/cmo/plans", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.listPolarProducts.mockResolvedValue(PRODUCTS);
  });

  it("lists the six plans with price and monthly credits, monthly first, each by credits", async () => {
    const response = await app.request("/plans");
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(
      data.map((item: { tier: string; interval: string }) => [
        item.interval,
        item.tier,
      ]),
    ).toEqual([
      ["month", "starter"],
      ["month", "growth"],
      ["month", "scale"],
      ["year", "starter"],
      ["year", "growth"],
      ["year", "scale"],
    ]);
    expect(data[1]).toEqual({
      tier: "growth",
      name: "growth",
      interval: "month",
      credits: 25_000,
      priceAmount: 50_000,
      currency: "usd",
    });
  });

  it("answers 503 without Polar configuration", async () => {
    m.listPolarProducts.mockRejectedValue(
      serviceUnavailable("Polar is not configured"),
    );
    const response = await (await freshApp()).request("/plans");
    expect(response.status).toBe(503);
  });
});
