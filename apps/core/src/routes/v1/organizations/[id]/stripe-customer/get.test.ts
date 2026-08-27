import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

const { organizationFindUniqueMock, memberFindUniqueMock } = vi.hoisted(() => ({
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
}));

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  const { mockRequireOwnerUserContext } = await import(
    "@/test-fixtures/require-owner-user-context.mock.js"
  );
  const { HTTPException } = await import("hono/http-exception");
  return {
    ...actual,
    authMiddleware: stubAuthMiddleware,
    requireUserContext: (authContext: AuthenticationContext | null) => {
      if (!authContext || authContext.actor !== "user") {
        throw new HTTPException(403, {
          message: "User authentication required",
        });
      }
      return { source: "session" as const, ...authContext };
    },
    requireOwnerUserContext: mockRequireOwnerUserContext,
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    organization: { findUnique: organizationFindUniqueMock },
    member: { findUnique: memberFindUniqueMock },
  },
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

let mountGetOrganizationStripeCustomer: (app: OpenAPIHonoWithAuth) => void;

function createApp(
  authContext: AuthenticationContext | null = USER_AUTH_CONTEXT,
) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    if (!authContext) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountGetOrganizationStripeCustomer(app);
  return app;
}

function setMembership(role: string | null, stripeCustomerId: string | null) {
  organizationFindUniqueMock.mockResolvedValue({
    id: "org_123",
    slug: "acme",
    stripeCustomerId,
  });
  memberFindUniqueMock.mockResolvedValue(role ? { role } : null);
}

beforeAll(async () => {
  const module = await import("./get");
  mountGetOrganizationStripeCustomer = module.default;
});

describe("GET /organizations/{id}/stripe-customer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    const response = await createApp(null).request(
      "http://localhost/org_123/stripe-customer",
    );
    expect(response.status).toBe(401);
  });

  it("returns 403 for coworker authentication", async () => {
    const response = await createApp(COWORKER_AUTH_CONTEXT).request(
      "http://localhost/org_123/stripe-customer",
    );
    expect(response.status).toBe(403);
    expect(organizationFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the organization does not exist", async () => {
    organizationFindUniqueMock.mockResolvedValue(null);
    const response = await createApp().request(
      "http://localhost/missing/stripe-customer",
    );
    expect(response.status).toBe(404);
    expect(memberFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the user is not a member", async () => {
    setMembership(null, "cus_1");
    const response = await createApp().request(
      "http://localhost/org_123/stripe-customer",
    );
    expect(response.status).toBe(403);
  });

  it("returns the stripe customer id for any member", async () => {
    setMembership("member", "cus_org");
    const response = await createApp().request(
      "http://localhost/org_123/stripe-customer",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ stripeCustomerId: "cus_org" });
  });

  it("returns null when no stripe customer is provisioned", async () => {
    setMembership("owner", null);
    const response = await createApp().request(
      "http://localhost/org_123/stripe-customer",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ stripeCustomerId: null });
  });
});
