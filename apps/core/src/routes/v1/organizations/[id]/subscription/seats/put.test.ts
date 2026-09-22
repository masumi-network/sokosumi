import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  organizationFindUniqueMock,
  memberFindUniqueMock,
  assertOrganizationSubscriptionChangeAllowedMock,
  resolveActiveSubscriptionByReferenceIdMock,
  subscriptionUpdateMock,
  memberFindManyMock,
  memberUpdateMock,
  transactionMock,
  captureExceptionMock,
  retrieveSubscriptionWithItemsMock,
  updateSubscriptionItemQuantityMock,
} = vi.hoisted(() => ({
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  assertOrganizationSubscriptionChangeAllowedMock: vi.fn(),
  resolveActiveSubscriptionByReferenceIdMock: vi.fn(),
  subscriptionUpdateMock: vi.fn(),
  memberFindManyMock: vi.fn(),
  memberUpdateMock: vi.fn(),
  transactionMock: vi.fn(),
  captureExceptionMock: vi.fn(),
  retrieveSubscriptionWithItemsMock: vi.fn(),
  updateSubscriptionItemQuantityMock: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (...args: unknown[]) => transactionMock(...args),
    organization: {
      findUnique: (...args: unknown[]) => organizationFindUniqueMock(...args),
    },
    member: {
      findUnique: memberFindUniqueMock,
    },
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

  mountPutOrganizationSubscriptionSeats(app);
  return app;
}

function setMembership(role: string | null) {
  organizationFindUniqueMock.mockResolvedValue({ id: "org_123" });
  memberFindUniqueMock.mockResolvedValue(role ? { role } : null);
}

function updateSeats(
  id: string,
  seats: number,
  authContext: AuthenticationContext | null = USER_AUTH_CONTEXT,
) {
  return createApp(authContext).request(
    `http://localhost/${id}/subscription/seats`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seats }),
    },
  );
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
          member: {
            findMany: (...args: unknown[]) => memberFindManyMock(...args),
            findUnique: memberFindUniqueMock,
            update: (...args: unknown[]) => memberUpdateMock(...args),
          },
          subscription: {
            update: (...args: unknown[]) => subscriptionUpdateMock(...args),
          },
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
    retrieveSubscriptionWithItemsMock.mockResolvedValue({
      items: { data: [{ id: "si_1" }] },
    });
    updateSubscriptionItemQuantityMock.mockResolvedValue({});
    subscriptionUpdateMock.mockResolvedValue({});
    memberFindManyMock.mockResolvedValue([]);
    memberUpdateMock.mockResolvedValue({});
  });

  it("returns 404 when the organization does not exist", async () => {
    organizationFindUniqueMock.mockResolvedValue(null);
    const response = await updateSeats("missing", 3);
    expect(response.status).toBe(404);
    expect(transactionMock).not.toHaveBeenCalled();
    expect(subscriptionUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the user is not a member", async () => {
    setMembership(null);
    const response = await updateSeats("org_123", 3);
    expect(response.status).toBe(403);
    expect(transactionMock).not.toHaveBeenCalled();
    expect(subscriptionUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 403 for a member who is not an owner or admin", async () => {
    setMembership("member");
    const response = await updateSeats("org_123", 3);
    expect(response.status).toBe(403);
    expect(transactionMock).not.toHaveBeenCalled();
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
    expect(transactionMock).not.toHaveBeenCalled();
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
    expect(transactionMock).not.toHaveBeenCalled();
    expect(subscriptionUpdateMock).not.toHaveBeenCalled();
  });

  it("allows decreasing purchased seats below the assigned member count", async () => {
    setMembership("owner");
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      id: "sub-row-1",
      plan: "starter",
      seats: 6,
      stripeSubscriptionId: "sub_stripe_1",
    });
    memberFindManyMock.mockResolvedValue([
      {
        id: "m-oldest",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        seatAssignedAt: new Date("2026-04-01T00:00:00.000Z"),
      },
      {
        id: "m-middle",
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
        seatAssignedAt: new Date("2026-04-01T00:00:00.000Z"),
      },
      {
        id: "m-newest",
        createdAt: new Date("2026-03-01T00:00:00.000Z"),
        seatAssignedAt: new Date("2026-04-01T00:00:00.000Z"),
      },
    ]);

    const response = await updateSeats("org_123", 1);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ seats: 1 });
    expect(updateSubscriptionItemQuantityMock).toHaveBeenCalledWith(
      "sub_stripe_1",
      "si_1",
      1,
    );
    expect(subscriptionUpdateMock).toHaveBeenCalledWith({
      where: { id: "sub-row-1" },
      data: { seats: 1 },
    });
    expect(memberUpdateMock.mock.calls.map((call) => call[0].where.id)).toEqual(
      ["m-newest", "m-middle"],
    );
    expect(memberUpdateMock.mock.calls[0]?.[0].data.seatAssignedAt).toBeNull();
  });

  it("persists the seat change in a serializable transaction", async () => {
    setMembership("owner");

    const response = await updateSeats("org_123", 5);

    expect(response.status).toBe(200);
    // Not toHaveBeenCalledWith: that passes when any one call matches, so it
    // would stay green if a later write dropped back to the default level.
    expect(transactionMock.mock.calls).toHaveLength(1);
    expect(transactionMock.mock.calls[0]?.[1]).toEqual({
      isolationLevel: "Serializable",
    });
  });

  it("unassigns overflow if the local seat write fails after Stripe", async () => {
    setMembership("owner");
    memberFindManyMock.mockResolvedValue([
      {
        id: "m-oldest",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        seatAssignedAt: new Date("2026-04-01T00:00:00.000Z"),
      },
      {
        id: "m-newest",
        createdAt: new Date("2026-03-01T00:00:00.000Z"),
        seatAssignedAt: new Date("2026-04-01T00:00:00.000Z"),
      },
    ]);

    let transactionCalls = 0;
    transactionMock.mockImplementation(
      async (callback: (tx: unknown) => unknown) => {
        transactionCalls += 1;
        const tx = {
          organization: { findUnique: organizationFindUniqueMock },
          member: {
            findMany: (...args: unknown[]) => memberFindManyMock(...args),
            findUnique: memberFindUniqueMock,
            update: (...args: unknown[]) => memberUpdateMock(...args),
          },
          subscription: {
            update: (...args: unknown[]) => subscriptionUpdateMock(...args),
          },
        };
        if (transactionCalls === 1 || transactionCalls === 2) {
          throw new Error("local seat write failed");
        }
        return callback(tx);
      },
    );

    const response = await updateSeats("org_123", 1);

    expect(response.status).toBe(500);
    expect(updateSubscriptionItemQuantityMock).toHaveBeenCalledWith(
      "sub_stripe_1",
      "si_1",
      1,
    );
    expect(subscriptionUpdateMock).not.toHaveBeenCalled();
    expect(memberUpdateMock.mock.calls.map((call) => call[0].where.id)).toEqual(
      ["m-newest"],
    );
  });

  it("reports the cleanup failure but still surfaces the persist error", async () => {
    setMembership("owner");
    memberFindManyMock.mockResolvedValue([]);

    let transactionCalls = 0;
    transactionMock.mockImplementation(async () => {
      transactionCalls += 1;
      // Both persist attempts fail, then the cleanup loses every
      // serialization race and raises its own 409.
      if (transactionCalls <= 2) {
        throw new Error("local seat write failed");
      }
      throw Object.assign(new Error("Transaction failed"), { code: "P2034" });
    });

    vi.useFakeTimers();
    try {
      const pending = updateSeats("org_123", 1);
      await vi.runAllTimersAsync();
      const response = await pending;

      // 500 from the persist failure, not the cleanup's 409: the caller needs
      // the error that explains why the seat write never landed.
      expect(response.status).toBe(500);
    } finally {
      vi.useRealTimers();
    }

    // The cleanup runs serializable too: a read committed cleanup can lose
    // the race with a concurrent assignment and leave the organization above
    // the seat count Stripe now bills for.
    expect(transactionMock.mock.calls[2]?.[1]).toEqual({
      isolationLevel: "Serializable",
    });
    expect(captureExceptionMock.mock.calls).toHaveLength(1);
    expect(captureExceptionMock.mock.calls[0]?.[1]).toMatchObject({
      tags: { context: "organization_seat_reduction_cleanup" },
    });
  });

  it("persists seats on retry when the first local write fails after Stripe", async () => {
    setMembership("owner");
    memberFindManyMock.mockResolvedValue([
      {
        id: "m-oldest",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        seatAssignedAt: new Date("2026-04-01T00:00:00.000Z"),
      },
      {
        id: "m-newest",
        createdAt: new Date("2026-03-01T00:00:00.000Z"),
        seatAssignedAt: new Date("2026-04-01T00:00:00.000Z"),
      },
    ]);

    let transactionCalls = 0;
    transactionMock.mockImplementation(
      async (callback: (tx: unknown) => unknown) => {
        transactionCalls += 1;
        const tx = {
          organization: { findUnique: organizationFindUniqueMock },
          member: {
            findMany: (...args: unknown[]) => memberFindManyMock(...args),
            findUnique: memberFindUniqueMock,
            update: (...args: unknown[]) => memberUpdateMock(...args),
          },
          subscription: {
            update: (...args: unknown[]) => subscriptionUpdateMock(...args),
          },
        };
        if (transactionCalls === 1) {
          throw new Error("local seat write failed");
        }
        return callback(tx);
      },
    );

    const response = await updateSeats("org_123", 1);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ seats: 1 });
    expect(subscriptionUpdateMock).toHaveBeenCalledWith({
      where: { id: "sub-row-1" },
      data: { seats: 1 },
    });
    expect(memberUpdateMock.mock.calls.map((call) => call[0].where.id)).toEqual(
      ["m-newest"],
    );
  });

  it("returns the current seats without touching Stripe when unchanged", async () => {
    setMembership("owner");
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      id: "sub-row-1",
      plan: "starter",
      seats: 4,
      stripeSubscriptionId: "sub_stripe_1",
    });

    const response = await updateSeats("org_123", 4);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ seats: 4 });
    expect(retrieveSubscriptionWithItemsMock).not.toHaveBeenCalled();
    expect(updateSubscriptionItemQuantityMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
    expect(subscriptionUpdateMock).not.toHaveBeenCalled();
  });

  it("updates Stripe and the local seat count for an admin", async () => {
    setMembership("admin");

    const response = await updateSeats("org_123", 6);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ seats: 6 });
    expect(
      assertOrganizationSubscriptionChangeAllowedMock,
    ).toHaveBeenCalledWith(
      "org_123",
      expect.objectContaining({
        $transaction: expect.any(Function),
        organization: expect.objectContaining({
          findUnique: expect.any(Function),
        }),
      }),
    );
    expect(resolveActiveSubscriptionByReferenceIdMock).toHaveBeenCalledWith(
      "org_123",
      expect.objectContaining({
        $transaction: expect.any(Function),
      }),
    );
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
    expect(transactionMock).not.toHaveBeenCalled();
    expect(subscriptionUpdateMock).not.toHaveBeenCalled();
  });

  it("no-ops seat quantity updates for local free subscriptions", async () => {
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
    expect(body.data).toEqual({ seats: 2 });
    expect(retrieveSubscriptionWithItemsMock).not.toHaveBeenCalled();
    expect(updateSubscriptionItemQuantityMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
    expect(subscriptionUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects coworker context even with X-Context-User-Id", async () => {
    setMembership("owner");

    const response = await updateSeats("org_123", 6, {
      actor: "coworker",
      coworkerId: "coworker_1",
      vendorId: "vendor_1",
      context: { userId: "user_123", organizationId: "org_123" },
    });

    expect(response.status).toBe(403);
    expect(organizationFindUniqueMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
    expect(subscriptionUpdateMock).not.toHaveBeenCalled();
  });
});
