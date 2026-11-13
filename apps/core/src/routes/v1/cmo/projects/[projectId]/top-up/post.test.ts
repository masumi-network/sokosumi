import { beforeEach, describe, expect, it, vi } from "vitest";

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
  member: vi.fn(),
  subscription: vi.fn(),
}));

vi.mock("@/clients/polar.client", () => ({
  createPolarCheckout: m.createPolarCheckout,
  listPolarProducts: m.listPolarProducts,
}));

const PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const UNKNOWN = "aaaaaaaa-aaaa-4aaa-8aaa-000000000009";

vi.mock("@/lib/db/prisma", () => ({
  default: {
    project: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === PROJECT
          ? {
              id: PROJECT,
              workspaceId: "ws-1",
              workspace: { userId: null, organizationId: "org-1" },
            }
          : null,
    },
    member: { findFirst: m.member },
    workspace: { findUnique: async () => ({ organizationId: "org-1" }) },
    sokoBot: {
      findFirst: async () => ({
        id: "bot-1",
        createdAt: new Date("2026-10-01T09:00:00Z"),
        project: {
          id: PROJECT,
          workspaceId: "ws-1",
          websiteUrl: "https://acme.example",
          workspace: { organizationId: "org-1" },
          brandBrain: null,
        },
      }),
    },
    polarSubscription: { findFirst: m.subscription },
  },
}));

import cmoRouter from "../../../index";

function pack(id: string, credits: number, priceAmount: number) {
  return {
    id,
    name: `${credits} credits`,
    is_recurring: false,
    recurring_interval: null,
    recurring_interval_count: null,
    metadata: { kind: "top-up", credits: String(credits) },
    prices: [
      {
        amount_type: "fixed",
        is_archived: false,
        price_amount: priceAmount,
        price_currency: "usd",
      },
    ],
  };
}

const PRODUCTS = [
  pack("prod_top_up_25000", 25_000, 75_000),
  pack("prod_top_up_5000", 5_000, 15_000),
  {
    ...pack("prod_growth_month", 25_000, 50_000),
    is_recurring: true,
    recurring_interval: "month",
    recurring_interval_count: 1,
    metadata: { kind: "plan", tier: "growth", credits: "25000" },
  },
  pack("prod_top_up_10000", 10_000, 30_000),
];

function startTopUp(
  projectId = PROJECT,
  body: unknown = { returnUrl: "https://cmo.xyz/?project=p" },
) {
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
  app.onError(errorHandler);
  app.route("/", cmoRouter);
  return app.request(`/projects/${projectId}/top-up`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  m.member.mockResolvedValue({ id: "member-1" });
  m.subscription.mockResolvedValue({ id: "sub-row-1" });
  m.listPolarProducts.mockResolvedValue(PRODUCTS);
  m.createPolarCheckout.mockResolvedValue("https://polar.example/checkout/1");
});

describe("POST /v1/cmo/projects/{projectId}/top-up", () => {
  it("returns Polar's checkout with the three packs for the Cuso's organization", async () => {
    const response = await startTopUp();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { url: "https://polar.example/checkout/1" },
    });
    expect(m.createPolarCheckout).toHaveBeenCalledExactlyOnceWith({
      productIds: [
        "prod_top_up_5000",
        "prod_top_up_10000",
        "prod_top_up_25000",
      ],
      organizationId: "org-1",
      metadata: {
        projectId: PROJECT,
        organizationId: "org-1",
        userId: "user-1",
        kind: "top-up",
      },
      returnUrl: "https://cmo.xyz/?project=p",
    });
  });

  it("asks only for a subscription of this Cuso that is active and has not ended", async () => {
    await startTopUp();

    expect(m.subscription).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: PROJECT, status: "active", endedAt: null },
      }),
    );
  });

  it("refuses a Cuso without an active subscription", async () => {
    m.subscription.mockResolvedValue(null);

    const response = await startTopUp();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      kind: "subscription_not_active",
    });
    expect(m.createPolarCheckout).not.toHaveBeenCalled();
  });

  it("answers 404 to someone who is not a member of the Cuso's organization", async () => {
    m.member.mockResolvedValue(null);

    const response = await startTopUp();

    expect(response.status).toBe(404);
    expect(m.createPolarCheckout).not.toHaveBeenCalled();
  });

  it("answers 404 for a Project that does not exist", async () => {
    const response = await startTopUp(UNKNOWN);

    expect(response.status).toBe(404);
  });

  it("refuses a return address that is not CMO's own page", async () => {
    const response = await startTopUp(PROJECT, {
      returnUrl: "https://evil.example/back",
    });

    expect(response.status).toBe(409);
    expect(m.createPolarCheckout).not.toHaveBeenCalled();
  });

  it("answers 503 without Polar configuration", async () => {
    m.createPolarCheckout.mockRejectedValue(
      serviceUnavailable("Polar is not configured"),
    );

    const response = await startTopUp();

    expect(response.status).toBe(503);
  });
});
