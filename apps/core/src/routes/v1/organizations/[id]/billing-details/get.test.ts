import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import type { RequestIdVariables } from "hono/request-id";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { forbidden } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler.js";
import { defaultValidationHook, type OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

const {
  getOrganizationBillingDetailsMock,
  getOrganizationBillingDetailsByIdMock,
} = vi.hoisted(() => ({
  getOrganizationBillingDetailsMock: vi.fn(),
  getOrganizationBillingDetailsByIdMock: vi.fn(),
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
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

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
  mountGetOrganizationBillingDetails(app as unknown as OpenAPIHonoWithAuth);
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
