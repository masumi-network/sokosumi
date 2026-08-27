import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { forbidden } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler.js";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

const {
  getOrganizationBillingDetailsMock,
  getOrganizationBillingDetailsByIdMock,
} = vi.hoisted(() => ({
  getOrganizationBillingDetailsMock: vi.fn(),
  getOrganizationBillingDetailsByIdMock: vi.fn(),
}));

vi.mock("@/middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/auth")>()),
  authMiddleware: (await import("@/test-fixtures/auth-middleware"))
    .stubAuthMiddleware,
  requireUserContext: (authContext: AuthenticationContext | null) => {
    if (!authContext) {
      throw new HTTPException(403, {
        message: "User authentication required",
      });
    }
    if (authContext.actor === "user") {
      return { source: "session" as const, ...authContext };
    }
    if (
      (authContext.actor === "coworker" ||
        authContext.actor === "orchestrator") &&
      "context" in authContext &&
      authContext.context
    ) {
      return {
        source: "context" as const,
        userId: authContext.context.userId,
        organizationId: authContext.context.organizationId,
      };
    }
    throw new HTTPException(403, {
      message:
        "Context headers (X-Context-User-Id) are required for this resource",
    });
  },
  requireOwnerUserContext: (authContext: AuthenticationContext | null) => {
    if (!authContext) {
      throw new HTTPException(403, {
        message: "User authentication required",
      });
    }
    if (authContext.actor === "coworker") {
      throw new HTTPException(403, {
        message: "Coworker authentication cannot perform this owner action",
      });
    }
    if (authContext.actor === "user") {
      return { source: "session" as const, ...authContext };
    }
    if (
      authContext.actor === "orchestrator" &&
      "context" in authContext &&
      authContext.context
    ) {
      return {
        source: "context" as const,
        userId: authContext.context.userId,
        organizationId: authContext.context.organizationId,
      };
    }
    throw new HTTPException(403, {
      message:
        "Context headers (X-Context-User-Id) are required for this resource",
    });
  },
  hasAdminRole: (role: string | null | undefined) => role === "admin",
}));

vi.mock("@/services/stripe-customer-billing.service", () => ({
  stripeCustomerBillingService: {
    getOrganizationBillingDetails: (...args: unknown[]) =>
      getOrganizationBillingDetailsMock(...args),
    getOrganizationBillingDetailsById: (...args: unknown[]) =>
      getOrganizationBillingDetailsByIdMock(...args),
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

const billingDetails = {
  stripeCustomerId: "cus_org",
  email: "billing@acme.example",
  address: null,
  taxIds: [],
};

let mountGetOrganizationBillingDetails: (app: OpenAPIHonoWithAuth) => void;

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

  app.onError(errorHandler);
  mountGetOrganizationBillingDetails(app);
  return app;
}

beforeAll(async () => {
  const module = await import("./get");
  mountGetOrganizationBillingDetails = module.default;
});

describe("GET /organizations/{id}/billing-details", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOrganizationBillingDetailsMock.mockResolvedValue(billingDetails);
  });

  it("returns 401 when unauthenticated", async () => {
    const response = await createApp(null).request(
      "http://localhost/org_123/billing-details",
    );

    expect(response.status).toBe(401);
  });

  it("returns 403 for coworker authentication", async () => {
    const response = await createApp(COWORKER_AUTH_CONTEXT).request(
      "http://localhost/org_123/billing-details",
    );

    expect(response.status).toBe(403);
    expect(getOrganizationBillingDetailsMock).not.toHaveBeenCalled();
  });

  it("rejects coworker with context headers (owner/session or orchestrator only)", async () => {
    const response = await createApp({
      actor: "coworker",
      coworkerId: "cow_1",
      vendorId: TEST_VENDOR_ID,
      context: { userId: "user_1", organizationId: "org_1" },
    }).request("http://localhost/org_1/billing-details");

    expect(response.status).toBe(403);
  });

  it("allows orchestrator with context headers as the context user", async () => {
    const response = await createApp({
      actor: "orchestrator",
      orchestratorId: "orch_123",
      context: { userId: "user_123", organizationId: "org_123" },
    }).request("http://localhost/org_123/billing-details");

    expect(response.status).toBe(200);
    expect(getOrganizationBillingDetailsMock).toHaveBeenCalledWith(
      "org_123",
      "user_123",
    );
  });

  it("returns 403 when the user is not an owner or admin", async () => {
    getOrganizationBillingDetailsMock.mockRejectedValue(
      forbidden("You must be owner, admin"),
    );

    const response = await createApp().request(
      "http://localhost/org_123/billing-details",
    );

    expect(response.status).toBe(403);
  });

  it("returns billing details for an organization owner or admin", async () => {
    const response = await createApp().request(
      "http://localhost/org_123/billing-details",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(billingDetails);
    expect(getOrganizationBillingDetailsMock).toHaveBeenCalledWith(
      "org_123",
      "user_123",
    );
  });

  it("returns billing details for a platform admin without org membership", async () => {
    const adminAuthContext: AuthenticationContext = {
      actor: "user",
      userId: "admin_123",
      organizationId: null,
      role: "admin",
    };
    getOrganizationBillingDetailsByIdMock.mockResolvedValue(billingDetails);

    const response = await createApp(adminAuthContext).request(
      "http://localhost/org_123/billing-details",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(billingDetails);
    expect(getOrganizationBillingDetailsByIdMock).toHaveBeenCalledWith(
      "org_123",
    );
    expect(getOrganizationBillingDetailsMock).not.toHaveBeenCalled();
  });

  it("returns empty billing details when no stripe customer is provisioned", async () => {
    getOrganizationBillingDetailsMock.mockResolvedValue({
      stripeCustomerId: null,
      email: null,
      address: null,
      taxIds: [],
    });

    const response = await createApp().request(
      "http://localhost/org_123/billing-details",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      stripeCustomerId: null,
      email: null,
      address: null,
      taxIds: [],
    });
  });

  it("returns 500 when the stripe read fails instead of empty billing details", async () => {
    getOrganizationBillingDetailsMock.mockRejectedValue(
      new Error("stripe down"),
    );

    const response = await createApp().request(
      "http://localhost/org_123/billing-details",
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.data).toBeUndefined();
  });
});
