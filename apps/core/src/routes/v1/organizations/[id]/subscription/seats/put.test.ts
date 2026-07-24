import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

const {
  organizationFindUniqueMock,
  memberFindUniqueMock,
  assertOrganizationSubscriptionChangeAllowedMock,
  resolveActiveSubscriptionByReferenceIdMock,
  getAssignedMemberCountMock,
  subscriptionUpdateMock,
  transactionMock,
  retrieveSubscriptionWithItemsMock,
  updateSubscriptionItemQuantityMock,
} = vi.hoisted(() => ({
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  assertOrganizationSubscriptionChangeAllowedMock: vi.fn(),
  resolveActiveSubscriptionByReferenceIdMock: vi.fn(),
  getAssignedMemberCountMock: vi.fn(),
  subscriptionUpdateMock: vi.fn(),
  transactionMock: vi.fn(),
  retrieveSubscriptionWithItemsMock: vi.fn(),
  updateSubscriptionItemQuantityMock: vi.fn(),
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
    $transaction: (...args: unknown[]) => transactionMock(...args),
    subscription: {
      update: (...args: unknown[]) => subscriptionUpdateMock(...args),
    },
  },
}));

vi.mock("@/clients/stripe.client", () => ({
  stripeClient: {
    retrieveSubscriptionWithItems: (...args: unknown[]) =>
      retrieveSubscriptionWithItemsMock(...args),
    updateSubscriptionItemQuantity: (...args: unknown[]) =>
      updateSubscriptionItemQuantityMock(...args),
  },
}));

vi.mock("@sokosumi/database/helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/helpers")>();
  return {
    ...actual,
    assertOrganizationSubscriptionChangeAllowed: (...args: unknown[]) =>
      assertOrganizationSubscriptionChangeAllowedMock(...args),
  };
});

vi.mock("@sokosumi/database/repositories", () => ({
  memberRepository: {
    getAssignedMemberCount: (...args: unknown[]) =>
      getAssignedMemberCountMock(...args),
  },
  subscriptionRepository: {
    resolveActiveSubscriptionByReferenceId: (...args: unknown[]) =>
      resolveActiveSubscriptionByReferenceIdMock(...args),
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

let mountPutOrganizationSubscriptionSeats: (app: OpenAPIHonoWithAuth) => void;

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

  mountPutOrganizationSubscriptionSeats(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

function setMembership(role: string | null) {
  organizationFindUniqueMock.mockResolvedValue({ id: "org_123" });
  memberFindUniqueMock.mockResolvedValue(role ? { role } : null);
}

function updateSeats(id: string, seats: number) {
  return createApp().request(`http://localhost/${id}/subscription/seats`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ seats }),
  });
}

beforeAll(async () => {
  const module = await import("./put");
  mountPutOrganizationSubscriptionSeats = module.default;
});

describe("PUT /organizations/{id}/subscription/seats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.mockImplementation(
      async (callback: (tx: unknown) => unknown) =>
        callback({
          organization: { findUnique: organizationFindUniqueMock },
          member: { findUnique: memberFindUniqueMock },
        }),
    );
    assertOrganizationSubscriptionChangeAllowedMock.mockResolvedValue(
      undefined,
    );
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      id: "sub-row-1",
      plan: "starter",
      seats: 2,
      stripeSubscriptionId: "sub_stripe_1",
    });
    getAssignedMemberCountMock.mockResolvedValue(2);
    retrieveSubscriptionWithItemsMock.mockResolvedValue({
      items: { data: [{ id: "si_1" }] },
    });
    updateSubscriptionItemQuantityMock.mockResolvedValue({});
    subscriptionUpdateMock.mockResolvedValue({});
  });

  it("returns 404 when the organization does not exist", async () => {
    organizationFindUniqueMock.mockResolvedValue(null);
    const response = await updateSeats("missing", 3);
    expect(response.status).toBe(404);
    expect(subscriptionUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the user is not a member", async () => {
    setMembership(null);
    const response = await updateSeats("org_123", 3);
    expect(response.status).toBe(403);
    expect(subscriptionUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 403 for a member who is not an owner or admin", async () => {
    setMembership("member");
    const response = await updateSeats("org_123", 3);
    expect(response.status).toBe(403);
    expect(subscriptionUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 400 when an enterprise contract blocks self-serve changes", async () => {
    setMembership("owner");
    const { OrganizationSubscriptionExclusivityError } = await import(
      "@sokosumi/database/helpers"
    );
    assertOrganizationSubscriptionChangeAllowedMock.mockRejectedValue(
      new OrganizationSubscriptionExclusivityError(
        "This organization has an active enterprise contract. Self-serve subscriptions are not available.",
      ),
    );

    const response = await updateSeats("org_123", 3);

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("active enterprise contract");
    expect(subscriptionUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 400 when no active organization subscription exists", async () => {
    setMembership("owner");
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue(null);

    const response = await updateSeats("org_123", 3);

    expect(response.status).toBe(400);
    expect(await response.text()).toContain(
      "An active organization subscription is required before updating seats.",
    );
    expect(subscriptionUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 400 when decreasing seats below the assigned member count", async () => {
    setMembership("owner");
    getAssignedMemberCountMock.mockResolvedValue(4);
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      id: "sub-row-1",
      plan: "starter",
      seats: 6,
      stripeSubscriptionId: "sub_stripe_1",
    });

    const response = await updateSeats("org_123", 3);

    expect(response.status).toBe(400);
    expect(await response.text()).toContain(
      "Purchased seats (3) must be at least 4 to cover all assigned members",
    );
    expect(retrieveSubscriptionWithItemsMock).not.toHaveBeenCalled();
    expect(subscriptionUpdateMock).not.toHaveBeenCalled();
  });

  it("returns the current seats without touching Stripe when unchanged", async () => {
    setMembership("owner");
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      id: "sub-row-1",
      plan: "starter",
      seats: 4,
      stripeSubscriptionId: "sub_stripe_1",
    });
    getAssignedMemberCountMock.mockResolvedValue(2);

    const response = await updateSeats("org_123", 4);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ seats: 4 });
    expect(retrieveSubscriptionWithItemsMock).not.toHaveBeenCalled();
    expect(updateSubscriptionItemQuantityMock).not.toHaveBeenCalled();
    expect(subscriptionUpdateMock).not.toHaveBeenCalled();
  });

  it("updates Stripe and the local seat count for an admin", async () => {
    setMembership("admin");

    const response = await updateSeats("org_123", 6);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ seats: 6 });
    expect(retrieveSubscriptionWithItemsMock).toHaveBeenCalledWith(
      "sub_stripe_1",
    );
    expect(updateSubscriptionItemQuantityMock).toHaveBeenCalledWith(
      "sub_stripe_1",
      "si_1",
      6,
    );
    expect(subscriptionUpdateMock).toHaveBeenCalledWith({
      where: { id: "sub-row-1" },
      data: { seats: 6 },
    });
  });

  it("returns 500 when the Stripe subscription has no items", async () => {
    setMembership("owner");
    retrieveSubscriptionWithItemsMock.mockResolvedValue({
      items: { data: [] },
    });

    const response = await updateSeats("org_123", 6);

    expect(response.status).toBe(500);
    expect(updateSubscriptionItemQuantityMock).not.toHaveBeenCalled();
    expect(subscriptionUpdateMock).not.toHaveBeenCalled();
  });

  it("updates only the local seat count for local free subscriptions", async () => {
    setMembership("owner");
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      id: "sub-row-1",
      plan: "free",
      seats: 2,
      stripeSubscriptionId: null,
    });

    const response = await updateSeats("org_123", 6);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ seats: 6 });
    expect(retrieveSubscriptionWithItemsMock).not.toHaveBeenCalled();
    expect(updateSubscriptionItemQuantityMock).not.toHaveBeenCalled();
    expect(subscriptionUpdateMock).toHaveBeenCalledWith({
      where: { id: "sub-row-1" },
      data: { seats: 6 },
    });
  });
});
