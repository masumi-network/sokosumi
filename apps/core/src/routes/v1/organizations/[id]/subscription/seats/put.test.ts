import { HTTPException } from "hono/http-exception";
import Stripe from "stripe";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
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
  retrieveSubscriptionWithItemsMock,
  updateSubscriptionItemQuantityMock,
  createSubscriptionScheduleFromSubscriptionMock,
  retrieveSubscriptionScheduleMock,
  updateSubscriptionScheduleMock,
  releaseSubscriptionScheduleMock,
} = vi.hoisted(() => ({
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  assertOrganizationSubscriptionChangeAllowedMock: vi.fn(),
  resolveActiveSubscriptionByReferenceIdMock: vi.fn(),
  subscriptionUpdateMock: vi.fn(),
  retrieveSubscriptionWithItemsMock: vi.fn(),
  updateSubscriptionItemQuantityMock: vi.fn(),
  createSubscriptionScheduleFromSubscriptionMock: vi.fn(),
  retrieveSubscriptionScheduleMock: vi.fn(),
  updateSubscriptionScheduleMock: vi.fn(),
  releaseSubscriptionScheduleMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: vi.fn(),
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
    createSubscriptionScheduleFromSubscription: (...args: unknown[]) =>
      createSubscriptionScheduleFromSubscriptionMock(...args),
    retrieveSubscriptionSchedule: (...args: unknown[]) =>
      retrieveSubscriptionScheduleMock(...args),
    updateSubscriptionSchedule: (...args: unknown[]) =>
      updateSubscriptionScheduleMock(...args),
    releaseSubscriptionSchedule: (...args: unknown[]) =>
      releaseSubscriptionScheduleMock(...args),
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

const PERIOD_START = 1_764_547_200;
const PERIOD_END = 1_767_225_600;

function phase(start: number, end: number, quantity: number) {
  return {
    discounts: [],
    end_date: end,
    items: [{ price: "price_starter", quantity }],
    start_date: start,
  };
}

/** What Stripe returns from `from_subscription`: unmarked, one phase. */
function singlePhaseSchedule() {
  return {
    current_phase: { end_date: PERIOD_END, start_date: PERIOD_START },
    id: "sub_sched_1",
    metadata: {},
    phases: [phase(PERIOD_START, PERIOD_END, 6)],
    status: "active",
  };
}

function pendingSchedule(scheduledSeats = 2) {
  return {
    ...singlePhaseSchedule(),
    metadata: { purpose: "seat_reduction", source: "@better-auth/stripe" },
    phases: [
      phase(PERIOD_START, PERIOD_END, 6),
      phase(PERIOD_END, PERIOD_END + 2_592_000, scheduledSeats),
    ],
  };
}

function setSubscriptionSeats(seats: number, stripeScheduleId?: string) {
  resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
    id: "sub-row-1",
    plan: "starter",
    seats,
    stripeScheduleId: stripeScheduleId ?? null,
    stripeSubscriptionId: "sub_stripe_1",
  });
}

function setStripeSubscription(overrides: Record<string, unknown>) {
  retrieveSubscriptionWithItemsMock.mockResolvedValue({
    id: "sub_stripe_1",
    cancel_at: null,
    cancel_at_period_end: false,
    items: { data: [{ id: "si_1" }] },
    schedule: null,
    ...overrides,
  });
}

beforeAll(async () => {
  const module = await import("./put");
  mountPutOrganizationSubscriptionSeats = module.default;
});

describe("PUT /organizations/{id}/subscription/seats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      id: "sub_stripe_1",
      cancel_at: null,
      cancel_at_period_end: false,
      items: { data: [{ id: "si_1" }] },
      schedule: null,
    });
    updateSubscriptionItemQuantityMock.mockResolvedValue({});
    subscriptionUpdateMock.mockResolvedValue({});
    createSubscriptionScheduleFromSubscriptionMock.mockResolvedValue(
      singlePhaseSchedule(),
    );
    updateSubscriptionScheduleMock.mockResolvedValue(pendingSchedule());
    releaseSubscriptionScheduleMock.mockResolvedValue({});
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

  it("schedules a reduction for renewal and changes nothing today", async () => {
    setMembership("owner");
    setSubscriptionSeats(6);

    const response = await updateSeats("org_123", 2);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      seats: 6,
      scheduledSeats: 2,
      scheduledSeatsAt: "2026-01-01T00:00:00.000Z",
    });
    expect(updateSubscriptionItemQuantityMock).not.toHaveBeenCalled();
    expect(createSubscriptionScheduleFromSubscriptionMock).toHaveBeenCalledWith(
      "sub_stripe_1",
    );
    expect(subscriptionUpdateMock).toHaveBeenCalledWith({
      where: { id: "sub-row-1" },
      data: { stripeScheduleId: "sub_sched_1" },
    });
  });

  it("rejects a reduction while the plan is set to end", async () => {
    setMembership("owner");
    setSubscriptionSeats(6);
    setStripeSubscription({ cancel_at_period_end: true });

    const response = await updateSeats("org_123", 2);

    expect(response.status).toBe(400);
    expect(
      createSubscriptionScheduleFromSubscriptionMock,
    ).not.toHaveBeenCalled();
    expect(updateSubscriptionScheduleMock).not.toHaveBeenCalled();
  });

  it("cancels a pending reduction when the current count is sent", async () => {
    setMembership("owner");
    setSubscriptionSeats(6, "sub_sched_1");
    setStripeSubscription({ schedule: "sub_sched_1" });
    retrieveSubscriptionScheduleMock.mockResolvedValue(pendingSchedule());

    const response = await updateSeats("org_123", 6);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      seats: 6,
      scheduledSeats: null,
      scheduledSeatsAt: null,
    });
    expect(releaseSubscriptionScheduleMock).toHaveBeenCalledWith("sub_sched_1");
    expect(updateSubscriptionItemQuantityMock).not.toHaveBeenCalled();
    expect(subscriptionUpdateMock).toHaveBeenCalledWith({
      where: { id: "sub-row-1" },
      data: { stripeScheduleId: null },
    });
  });

  it("adds seats and cancels a pending reduction", async () => {
    setMembership("owner");
    setSubscriptionSeats(6, "sub_sched_1");
    setStripeSubscription({ schedule: "sub_sched_1" });
    retrieveSubscriptionScheduleMock.mockResolvedValue(pendingSchedule());

    const response = await updateSeats("org_123", 8);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      seats: 8,
      scheduledSeats: null,
      scheduledSeatsAt: null,
    });
    expect(updateSubscriptionItemQuantityMock).toHaveBeenCalledWith(
      "sub_stripe_1",
      "si_1",
      8,
    );
    expect(releaseSubscriptionScheduleMock).toHaveBeenCalledWith("sub_sched_1");
  });

  it("keeps a pending reduction when the card is declined", async () => {
    setMembership("owner");
    setSubscriptionSeats(6, "sub_sched_1");
    setStripeSubscription({ schedule: "sub_sched_1" });
    updateSubscriptionItemQuantityMock.mockRejectedValue(
      new Stripe.errors.StripeCardError({
        code: "card_declined",
        message: "Your card was declined.",
        statusCode: 402,
        type: "card_error",
      }),
    );

    const response = await updateSeats("org_123", 8);

    expect(response.status).not.toBe(200);
    expect(releaseSubscriptionScheduleMock).not.toHaveBeenCalled();
  });

  it("leaves a schedule it did not create alone when adding seats", async () => {
    setMembership("owner");
    setSubscriptionSeats(6);
    setStripeSubscription({ schedule: "sub_sched_portal" });
    retrieveSubscriptionScheduleMock.mockResolvedValue({
      ...singlePhaseSchedule(),
      id: "sub_sched_portal",
    });

    const response = await updateSeats("org_123", 8);

    expect(response.status).toBe(200);
    expect(releaseSubscriptionScheduleMock).not.toHaveBeenCalled();
  });

  it("answers 500 when the local write fails after Stripe", async () => {
    setMembership("owner");
    subscriptionUpdateMock.mockRejectedValueOnce(
      new Error("local seat write failed"),
    );

    const response = await updateSeats("org_123", 5);

    expect(response.status).toBe(500);
    expect(updateSubscriptionItemQuantityMock).toHaveBeenCalledWith(
      "sub_stripe_1",
      "si_1",
      5,
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
    expect(body.data).toEqual({
      seats: 4,
      scheduledSeats: null,
      scheduledSeatsAt: null,
    });
    expect(retrieveSubscriptionWithItemsMock).not.toHaveBeenCalled();
    expect(updateSubscriptionItemQuantityMock).not.toHaveBeenCalled();
    expect(subscriptionUpdateMock).not.toHaveBeenCalled();
  });

  it("updates Stripe and the local seat count for an admin", async () => {
    setMembership("admin");

    const response = await updateSeats("org_123", 6);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      seats: 6,
      scheduledSeats: null,
      scheduledSeatsAt: null,
    });
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

  it("returns 402 and keeps the seat count when Stripe cannot collect payment", async () => {
    setMembership("owner");
    updateSubscriptionItemQuantityMock.mockRejectedValue(
      new Stripe.errors.StripeCardError({
        code: "card_declined",
        message: "Your card was declined.",
        statusCode: 402,
        type: "card_error",
      }),
    );

    const app = createApp();
    app.onError(errorHandler);
    const response = await app.request(
      "http://localhost/org_123/subscription/seats",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seats: 6 }),
      },
    );
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(body.kind).toBe("subscription_payment_failed");
    expect(subscriptionUpdateMock).not.toHaveBeenCalled();
  });

  it("keeps other Stripe failures as server errors", async () => {
    setMembership("owner");
    updateSubscriptionItemQuantityMock.mockRejectedValue(
      new Stripe.errors.StripeAPIError({
        message: "Stripe is unavailable.",
        statusCode: 500,
        type: "api_error",
      }),
    );

    const response = await updateSeats("org_123", 6);

    expect(response.status).toBe(500);
    expect(subscriptionUpdateMock).not.toHaveBeenCalled();
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
    expect(body.data).toEqual({
      seats: 2,
      scheduledSeats: null,
      scheduledSeatsAt: null,
    });
    expect(retrieveSubscriptionWithItemsMock).not.toHaveBeenCalled();
    expect(updateSubscriptionItemQuantityMock).not.toHaveBeenCalled();
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
    expect(subscriptionUpdateMock).not.toHaveBeenCalled();
  });
});
