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
  captureExceptionMock,
  memberFindUniqueMock,
  organizationFindUniqueMock,
  resolveActiveSubscriptionByReferenceIdMock,
  retrieveSubscriptionScheduleMock,
} = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  resolveActiveSubscriptionByReferenceIdMock: vi.fn(),
  retrieveSubscriptionScheduleMock: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    organization: {
      findUnique: (...args: unknown[]) => organizationFindUniqueMock(...args),
    },
    member: { findUnique: memberFindUniqueMock },
  },
}));

vi.mock("@/clients/stripe.client", () => ({
  stripeClient: {
    retrieveSubscriptionSchedule: (...args: unknown[]) =>
      retrieveSubscriptionScheduleMock(...args),
  },
}));

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

const PERIOD_START = 1_764_547_200;
const PERIOD_END = 1_767_225_600;

function phase(start: number, end: number, quantity: number) {
  return {
    end_date: end,
    items: [{ price: "price_starter", quantity }],
    start_date: start,
  };
}

let mountRoute: (app: OpenAPIHonoWithAuth) => void;

function readSeats() {
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", USER_AUTH_CONTEXT);
    return await next();
  });
  mountRoute(app);

  return app.request("http://localhost/org_123/subscription/seats");
}

beforeAll(async () => {
  const module = await import("./get");
  mountRoute = module.default;
});

describe("GET /organizations/{id}/subscription/seats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    organizationFindUniqueMock.mockResolvedValue({ id: "org_123" });
    memberFindUniqueMock.mockResolvedValue({ role: "member" });
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      id: "sub-row-1",
      seats: 6,
      stripeScheduleId: null,
    });
  });

  it("reads no schedule from Stripe when none is attached", async () => {
    const response = await readSeats();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      scheduledReduction: null,
      seats: 6,
    });
    expect(retrieveSubscriptionScheduleMock).not.toHaveBeenCalled();
  });

  it("returns a pending reduction", async () => {
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      id: "sub-row-1",
      seats: 6,
      stripeScheduleId: "sub_sched_1",
    });
    retrieveSubscriptionScheduleMock.mockResolvedValue({
      current_phase: { end_date: PERIOD_END, start_date: PERIOD_START },
      metadata: { purpose: "seat_reduction" },
      phases: [
        phase(PERIOD_START, PERIOD_END, 6),
        phase(PERIOD_END, PERIOD_END + 2_592_000, 2),
      ],
      status: "active",
    });

    const response = await readSeats();
    const body = await response.json();

    expect(body.data).toEqual({
      scheduledReduction: {
        effectiveAt: "2026-01-01T00:00:00.000Z",
        seats: 2,
      },
      seats: 6,
    });
  });

  it("still answers when Stripe fails, and reports it", async () => {
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      id: "sub-row-1",
      seats: 6,
      stripeScheduleId: "sub_sched_1",
    });
    retrieveSubscriptionScheduleMock.mockRejectedValue(
      new Error("Stripe is unavailable"),
    );

    const response = await readSeats();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.scheduledReduction).toBeNull();
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it("returns 400 without an active subscription", async () => {
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue(null);

    const response = await readSeats();
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.kind).toBe("subscription_not_active");
  });

  it("returns 403 for someone outside the organization", async () => {
    memberFindUniqueMock.mockResolvedValue(null);

    const response = await readSeats();

    expect(response.status).toBe(403);
  });
});
