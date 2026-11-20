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
  captureException: vi.fn(),
  createPolarCheckout: vi.fn(),
  ensurePolarOrganizationCustomer: vi.fn(),
  listPolarProducts: vi.fn(),
  getOrganizationBillingDetailsById: vi.fn(),
  updatePolarCustomerBilling: vi.fn(),
  prisma: {
    organization: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    polarSubscription: { findFirst: vi.fn() },
    member: { findFirst: vi.fn() },
    project: { findUnique: vi.fn() },
    sokoBot: { findFirst: vi.fn() },
    workspace: { findUnique: vi.fn() },
  },
}));

vi.mock("@/clients/polar.client", () => ({
  createPolarCheckout: m.createPolarCheckout,
  ensurePolarOrganizationCustomer: m.ensurePolarOrganizationCustomer,
  listPolarProducts: m.listPolarProducts,
  updatePolarCustomerBilling: m.updatePolarCustomerBilling,
}));
vi.mock("@/services/stripe-customer-billing.service", () => ({
  stripeCustomerBillingService: {
    getOrganizationBillingDetailsById: m.getOrganizationBillingDetailsById,
  },
}));
vi.mock("@/lib/db/prisma", () => ({ default: m.prisma }));
vi.mock("@sentry/node", () => ({
  captureException: m.captureException,
  captureMessage: vi.fn(),
}));

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";
const RETURN_URL = `https://app.cmo.xyz/?project=${PROJECT_ID}&step=subscribed`;
/** Polar's back link: the plans again, never the confirming state. */
const BACK_URL = `https://app.cmo.xyz/?project=${PROJECT_ID}`;
const CHECKOUT_URL = "https://sandbox.polar.sh/checkout/polar_c_1";

/** An organization without a Stripe customer: nothing to copy to Polar. */
const NO_STRIPE_BILLING = {
  stripeCustomerId: null,
  email: null,
  address: null,
  taxIds: [],
};

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
    m.prisma.polarSubscription.findFirst.mockResolvedValue(null);
    m.prisma.organization.findUnique.mockResolvedValue({ name: "Acme Inc" });
    m.prisma.user.findUnique.mockResolvedValue({ email: "payer@acme.io" });
    m.ensurePolarOrganizationCustomer.mockResolvedValue("cus_org_1");
    m.updatePolarCustomerBilling.mockResolvedValue(undefined);
    m.getOrganizationBillingDetailsById.mockResolvedValue(NO_STRIPE_BILLING);
  });

  it("answers Polar's checkout for the interval's three plans, for any member", async () => {
    const response = await startCheckout({
      interval: "month",
      returnUrl: RETURN_URL,
      backUrl: BACK_URL,
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
      customerId: "cus_org_1",
      customerEmail: "payer@acme.io",
      metadata: {
        kind: "plan",
        projectId: PROJECT_ID,
        organizationId: "org-1",
        userId: "user-1",
      },
      returnUrl: RETURN_URL,
      backUrl: BACK_URL,
      allowDiscountCodes: true,
    });
  });

  it("checks out as the organization's Polar customer, with the payer as its owner", async () => {
    await startCheckout({
      interval: "month",
      returnUrl: RETURN_URL,
      backUrl: BACK_URL,
    });

    expect(m.ensurePolarOrganizationCustomer).toHaveBeenCalledWith({
      organizationId: "org-1",
      name: "Acme Inc",
      ownerEmail: "payer@acme.io",
    });
    expect(m.createPolarCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "cus_org_1",
        customerEmail: "payer@acme.io",
      }),
    );
  });

  it("copies the organization's Stripe billing address and first tax ID to its Polar customer", async () => {
    m.getOrganizationBillingDetailsById.mockResolvedValue({
      stripeCustomerId: "cus_stripe_1",
      email: "billing@acme.io",
      address: {
        line1: "1 Main St",
        line2: "Suite 4",
        city: "San Francisco",
        state: "CA",
        postalCode: "94105",
        country: "US",
      },
      taxIds: [
        {
          id: "txi_1",
          type: "us_ein",
          value: "12-3456789",
          country: "US",
          verificationStatus: null,
        },
        {
          id: "txi_2",
          type: "eu_vat",
          value: "DE811907980",
          country: "DE",
          verificationStatus: "verified",
        },
      ],
    });

    await startCheckout({
      interval: "month",
      returnUrl: RETURN_URL,
      backUrl: BACK_URL,
    });

    expect(m.updatePolarCustomerBilling).toHaveBeenCalledWith("cus_org_1", {
      name: "Acme Inc",
      billingAddress: {
        line1: "1 Main St",
        line2: "Suite 4",
        city: "San Francisco",
        state: "CA",
        postal_code: "94105",
        country: "US",
      },
      taxId: "12-3456789",
    });
  });

  it("sends no billing address or tax ID when the organization has none at Stripe", async () => {
    await startCheckout({
      interval: "month",
      returnUrl: RETURN_URL,
      backUrl: BACK_URL,
    });

    expect(m.updatePolarCustomerBilling).toHaveBeenCalledWith("cus_org_1", {
      name: "Acme Inc",
      billingAddress: null,
      taxId: null,
    });
  });

  it("sends no billing address without a country, and blanks as nothing", async () => {
    // Stripe keeps a partial address with its missing fields blank.
    const partial = {
      line1: "",
      line2: null,
      city: "Berlin",
      state: null,
      postalCode: "",
    };
    m.getOrganizationBillingDetailsById.mockResolvedValueOnce({
      ...NO_STRIPE_BILLING,
      stripeCustomerId: "cus_stripe_1",
      address: { ...partial, country: "" },
    });
    await startCheckout({
      interval: "month",
      returnUrl: RETURN_URL,
      backUrl: BACK_URL,
    });
    m.getOrganizationBillingDetailsById.mockResolvedValueOnce({
      ...NO_STRIPE_BILLING,
      stripeCustomerId: "cus_stripe_1",
      address: { ...partial, country: "DE" },
    });
    await startCheckout({
      interval: "month",
      returnUrl: RETURN_URL,
      backUrl: BACK_URL,
    });

    expect(
      m.updatePolarCustomerBilling.mock.calls.map(
        ([, billing]) => billing.billingAddress,
      ),
    ).toEqual([
      null,
      {
        line1: null,
        line2: null,
        city: "Berlin",
        state: null,
        postal_code: null,
        country: "DE",
      },
    ]);
  });

  it("starts the checkout and reports it when the billing details cannot be copied", async () => {
    const refused = new Error("Invalid tax ID.");
    m.updatePolarCustomerBilling.mockRejectedValue(refused);

    const response = await startCheckout({
      interval: "month",
      returnUrl: RETURN_URL,
      backUrl: BACK_URL,
    });

    expect(response.status).toBe(200);
    expect(m.createPolarCheckout).toHaveBeenCalledTimes(1);
    expect(m.captureException).toHaveBeenCalledWith(refused, expect.anything());
  });

  it("answers 503 and starts no checkout when Polar cannot give the organization's customer", async () => {
    m.ensurePolarOrganizationCustomer.mockRejectedValue(
      new Error("Polar is down"),
    );

    const response = await startCheckout({
      interval: "month",
      returnUrl: RETURN_URL,
      backUrl: BACK_URL,
    });

    expect(response.status).toBe(503);
    expect(m.createPolarCheckout).not.toHaveBeenCalled();
  });

  it("offers the yearly plans for a yearly checkout", async () => {
    await startCheckout({
      interval: "year",
      returnUrl: RETURN_URL,
      backUrl: BACK_URL,
    });
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
      backUrl: BACK_URL,
    });
    expect(m.createPolarCheckout.mock.calls[0]?.[0].productIds).toEqual([
      "prod_scale_month",
      "prod_starter_month",
      "prod_growth_month",
    ]);
  });

  it("refuses a Cuso whose subscription has not ended", async () => {
    m.prisma.polarSubscription.findFirst.mockResolvedValue({ id: "sub-row-1" });
    const response = await startCheckout({
      interval: "month",
      returnUrl: RETURN_URL,
      backUrl: BACK_URL,
    });
    expect(response.status).toBe(409);
    expect(m.prisma.polarSubscription.findFirst).toHaveBeenCalledWith(
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
      backUrl: BACK_URL,
    });
    expect(response.status).toBe(404);
    expect(m.createPolarCheckout).not.toHaveBeenCalled();
  });

  it("refuses a return address that is not CMO's own page", async () => {
    const response = await startCheckout({
      interval: "month",
      returnUrl: "https://evil.example/?paid=1",
      backUrl: BACK_URL,
    });
    expect(response.status).toBe(409);
    expect(m.createPolarCheckout).not.toHaveBeenCalled();
  });

  it("refuses a back address that is not CMO's own page", async () => {
    const response = await startCheckout({
      interval: "month",
      returnUrl: RETURN_URL,
      backUrl: "https://evil.example/",
    });
    expect(response.status).toBe(409);
    expect(m.createPolarCheckout).not.toHaveBeenCalled();
  });

  it("answers 422 for an interval CMO does not sell", async () => {
    const response = await startCheckout({
      interval: "week",
      returnUrl: RETURN_URL,
      backUrl: BACK_URL,
    });
    expect(response.status).toBe(422);
  });

  it("answers 503 without Polar configuration", async () => {
    m.listPolarProducts.mockRejectedValue(
      serviceUnavailable("Polar is not configured"),
    );
    const response = await startCheckout(
      { interval: "month", returnUrl: RETURN_URL, backUrl: BACK_URL },
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
      { interval: "year", returnUrl: RETURN_URL, backUrl: BACK_URL },
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
