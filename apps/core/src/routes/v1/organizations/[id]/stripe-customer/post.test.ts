import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

const {
  organizationFindUniqueMock,
  memberFindUniqueMock,
  provisionOrganizationStripeCustomerMock,
} = vi.hoisted(() => ({
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  provisionOrganizationStripeCustomerMock: vi.fn(),
}));

vi.mock("@/middleware/auth", () => ({
  requireUserContext: (authContext: AuthenticationContext | null) => {
    if (!authContext || authContext.actor !== "user") {
      throw new HTTPException(403, {
        message: "User authentication required",
      });
    }
    return { source: "session" as const, ...authContext };
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    organization: { findUnique: organizationFindUniqueMock },
    member: { findUnique: memberFindUniqueMock },
  },
}));

vi.mock("@/services/stripe-customer-provision.service", () => ({
  provisionOrganizationStripeCustomer: (...args: unknown[]) =>
    provisionOrganizationStripeCustomerMock(...args),
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const COWORKER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_123",
  vendorId: TEST_VENDOR_ID,
};

let mountPostOrganizationStripeCustomer: (app: OpenAPIHonoWithAuth) => void;

function createApp(
  authContext: AuthenticationContext | null = USER_AUTH_CONTEXT,
) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & { requestId: string };
  }>();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    if (!authContext) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountPostOrganizationStripeCustomer(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

function setMembership(role: string | null, stripeCustomerId: string | null) {
  organizationFindUniqueMock.mockResolvedValue({
    id: "org_123",
    slug: "acme",
    name: "Acme",
    metadata: JSON.stringify({ url: "https://acme.test" }),
    stripeCustomerId,
  });
  memberFindUniqueMock.mockResolvedValue(role ? { role } : null);
}

beforeAll(async () => {
  const module = await import("./post");
  mountPostOrganizationStripeCustomer = module.default;
});

describe("POST /organizations/{id}/stripe-customer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    const response = await createApp(null).request(
      "http://localhost/org_123/stripe-customer",
      { method: "POST" },
    );
    expect(response.status).toBe(401);
  });

  it("returns 403 for coworker authentication", async () => {
    const response = await createApp(COWORKER_AUTH_CONTEXT).request(
      "http://localhost/org_123/stripe-customer",
      { method: "POST" },
    );
    expect(response.status).toBe(403);
    expect(organizationFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the organization does not exist", async () => {
    organizationFindUniqueMock.mockResolvedValue(null);
    const response = await createApp().request(
      "http://localhost/missing/stripe-customer",
      { method: "POST" },
    );
    expect(response.status).toBe(404);
    expect(memberFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the user is not a member", async () => {
    setMembership(null, null);
    const response = await createApp().request(
      "http://localhost/org_123/stripe-customer",
      { method: "POST" },
    );
    expect(response.status).toBe(403);
    expect(provisionOrganizationStripeCustomerMock).not.toHaveBeenCalled();
  });

  it("returns the existing customer id without creating a new one", async () => {
    setMembership("member", "cus_org");
    const response = await createApp().request(
      "http://localhost/org_123/stripe-customer",
      { method: "POST" },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ stripeCustomerId: "cus_org" });
    expect(provisionOrganizationStripeCustomerMock).not.toHaveBeenCalled();
  });

  it("creates a Stripe customer when none is provisioned", async () => {
    setMembership("member", null);
    provisionOrganizationStripeCustomerMock.mockResolvedValue("cus_new");
    const response = await createApp().request(
      "http://localhost/org_123/stripe-customer",
      { method: "POST" },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ stripeCustomerId: "cus_new" });
    expect(provisionOrganizationStripeCustomerMock).toHaveBeenCalledWith({
      id: "org_123",
      name: "Acme",
      slug: "acme",
    });
  });
});
