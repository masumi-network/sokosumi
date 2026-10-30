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
  retrieveSubscriptionWithItemsMock,
  previewSubscriptionItemQuantityMock,
  updateSubscriptionItemQuantityMock,
} = vi.hoisted(() => ({
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  assertOrganizationSubscriptionChangeAllowedMock: vi.fn(),
  resolveActiveSubscriptionByReferenceIdMock: vi.fn(),
  retrieveSubscriptionWithItemsMock: vi.fn(),
  previewSubscriptionItemQuantityMock: vi.fn(),
  updateSubscriptionItemQuantityMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    organization: {
      findUnique: (...args: unknown[]) => organizationFindUniqueMock(...args),
    },
    member: {
      findUnique: memberFindUniqueMock,
    },
  },
}));

vi.mock("@/clients/stripe.client", () => ({
  stripeClient: {
    retrieveSubscriptionWithItems: (...args: unknown[]) =>
      retrieveSubscriptionWithItemsMock(...args),
    previewSubscriptionItemQuantity: (...args: unknown[]) =>
      previewSubscriptionItemQuantityMock(...args),
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

let mountRoute: (app: OpenAPIHonoWithAuth) => void;

function previewSeats(id: string, seats: number | string) {
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", USER_AUTH_CONTEXT);
    return await next();
  });
  mountRoute(app);

  return app.request(
    `http://localhost/${id}/subscription/seats/preview?seats=${seats}`,
  );
}

function setMembership(role: string | null) {
  organizationFindUniqueMock.mockResolvedValue({ id: "org_123" });
  memberFindUniqueMock.mockResolvedValue(role ? { role } : null);
}

beforeAll(async () => {
  const module = await import("./get");
  mountRoute = module.default;
});

describe("GET /organizations/{id}/subscription/seats/preview", () => {
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
      items: { data: [{ id: "si_1", price: { unit_amount: 2500 } }] },
    });
    previewSubscriptionItemQuantityMock.mockResolvedValue({
      amount_due: 1234,
      currency: "eur",
      total: 1234,
    });
  });

  it("returns what adding seats costs without changing the subscription", async () => {
    setMembership("admin");

    const response = await previewSeats("org_123", 5);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      amountDue: 1234,
      creditAmount: 0,
      currency: "eur",
      newMonthlyAmount: 12500,
      seats: 5,
    });
    expect(previewSubscriptionItemQuantityMock).toHaveBeenCalledWith(
      "sub_stripe_1",
      "si_1",
      5,
    );
    expect(updateSubscriptionItemQuantityMock).not.toHaveBeenCalled();
  });

  it("returns the credit when removing seats", async () => {
    setMembership("owner");
    previewSubscriptionItemQuantityMock.mockResolvedValue({
      amount_due: 0,
      currency: "eur",
      total: -800,
    });

    const response = await previewSeats("org_123", 1);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      amountDue: 0,
      creditAmount: 800,
      currency: "eur",
      newMonthlyAmount: 2500,
      seats: 1,
    });
  });

  it("returns 403 for a member who is not an owner or admin", async () => {
    setMembership("member");

    const response = await previewSeats("org_123", 5);

    expect(response.status).toBe(403);
    expect(previewSubscriptionItemQuantityMock).not.toHaveBeenCalled();
  });

  it("returns 400 when an enterprise contract blocks self-serve changes", async () => {
    setMembership("owner");
    const { OrganizationSubscriptionExclusivityError } = await import(
      "@sokosumi/database/helpers"
    );
    assertOrganizationSubscriptionChangeAllowedMock.mockRejectedValue(
      new OrganizationSubscriptionExclusivityError(
        "Active enterprise contract",
      ),
    );

    const response = await previewSeats("org_123", 5);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.kind).toBe("subscription_change_not_allowed");
    expect(previewSubscriptionItemQuantityMock).not.toHaveBeenCalled();
  });

  it("returns 400 when there is no Stripe subscription to preview", async () => {
    setMembership("owner");
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      id: "sub-row-1",
      plan: "free",
      seats: 1,
      stripeSubscriptionId: null,
    });

    const response = await previewSeats("org_123", 5);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.kind).toBe("subscription_not_active");
    expect(previewSubscriptionItemQuantityMock).not.toHaveBeenCalled();
  });

  it("returns 422 for a seat count below 1", async () => {
    setMembership("owner");

    const response = await previewSeats("org_123", 0);

    expect(response.status).toBe(422);
    expect(previewSubscriptionItemQuantityMock).not.toHaveBeenCalled();
  });
});
