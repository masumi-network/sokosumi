import { OpenAPIHono } from "@hono/zod-openapi";
import { convertCreditsToCents } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

const {
  organizationFindUniqueMock,
  memberFindUniqueMock,
  assignSeatMock,
  resolveActiveSubscriptionByReferenceIdMock,
  resolveOrganizationBillingPlanMock,
  countOrganizationSubscriptionPeriodSeatGrantsMock,
  hasOrganizationMemberSubscriptionPeriodGrantMock,
  ensureLocalFreeSubscriptionPeriodMock,
  fetchOrganizationMemberUserIdsMock,
  creditBucketFindUniqueMock,
  transactionCreateMock,
  taskFindManyMock,
  transactionMock,
  getSubscriptionSeatCreditsMock,
} = vi.hoisted(() => ({
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  assignSeatMock: vi.fn(),
  resolveActiveSubscriptionByReferenceIdMock: vi.fn(),
  resolveOrganizationBillingPlanMock: vi.fn(),
  countOrganizationSubscriptionPeriodSeatGrantsMock: vi.fn(),
  hasOrganizationMemberSubscriptionPeriodGrantMock: vi.fn(),
  ensureLocalFreeSubscriptionPeriodMock: vi.fn(),
  fetchOrganizationMemberUserIdsMock: vi.fn(),
  creditBucketFindUniqueMock: vi.fn(),
  transactionCreateMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  transactionMock: vi.fn(),
  getSubscriptionSeatCreditsMock: vi.fn(),
}));

vi.mock("@/services/subscription-seat-credits.service", () => ({
  getSubscriptionSeatCredits: (...args: unknown[]) =>
    getSubscriptionSeatCreditsMock(...args),
}));

vi.mock("@/middleware/auth", () => ({
  requireOwnerUserContext: (authContext: AuthenticationContext | null) => {
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
  },
}));

vi.mock("@sokosumi/database/helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/helpers")>();
  return {
    ...actual,
    countOrganizationSubscriptionPeriodSeatGrants: (...args: unknown[]) =>
      countOrganizationSubscriptionPeriodSeatGrantsMock(...args),
    ensureLocalFreeSubscriptionPeriod: (...args: unknown[]) =>
      ensureLocalFreeSubscriptionPeriodMock(...args),
    fetchOrganizationMemberUserIds: (...args: unknown[]) =>
      fetchOrganizationMemberUserIdsMock(...args),
    hasOrganizationMemberSubscriptionPeriodGrant: (...args: unknown[]) =>
      hasOrganizationMemberSubscriptionPeriodGrantMock(...args),
    resolveOrganizationBillingPlan: (...args: unknown[]) =>
      resolveOrganizationBillingPlanMock(...args),
  };
});

vi.mock("@sokosumi/database/repositories", () => ({
  memberRepository: {
    assignSeat: (...args: unknown[]) => assignSeatMock(...args),
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

const FUTURE_PERIOD_END = new Date("2099-06-01T00:00:00.000Z");

let mountPutOrganizationMemberSeat: (app: OpenAPIHonoWithAuth) => void;

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

  mountPutOrganizationMemberSeat(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

function setMembership(role: string | null) {
  organizationFindUniqueMock.mockResolvedValue({ id: "org_123" });
  memberFindUniqueMock.mockResolvedValue(role ? { role } : null);
}

function assignSeat(id: string, memberId: string) {
  return createApp().request(
    `http://localhost/${id}/members/${memberId}/seat`,
    {
      method: "PUT",
    },
  );
}

beforeAll(async () => {
  const module = await import("./put");
  mountPutOrganizationMemberSeat = module.default;
});

describe("PUT /organizations/{id}/members/{memberId}/seat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.mockImplementation(
      async (callback: (tx: unknown) => unknown) =>
        callback({
          organization: { findUnique: organizationFindUniqueMock },
          member: { findUnique: memberFindUniqueMock },
          creditBucket: { findUnique: creditBucketFindUniqueMock },
          transaction: { create: transactionCreateMock },
          task: { findMany: taskFindManyMock },
        }),
    );
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      cancelAtPeriodEnd: false,
      mode: "self_serve",
      periodEnd: FUTURE_PERIOD_END,
      plan: "starter",
      purchasedSeats: 3,
      subscriptionId: "sub_1",
    });
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      periodEnd: FUTURE_PERIOD_END,
      periodStart: new Date("2026-05-01T00:00:00.000Z"),
      plan: "starter",
      seats: 3,
      status: "active",
      stripeSubscriptionId: "sub_123",
    });
    assignSeatMock.mockResolvedValue({
      id: "member_456",
      seatAssignedAt: new Date("2026-05-01T00:00:00.000Z"),
      userId: "user_456",
    });
    countOrganizationSubscriptionPeriodSeatGrantsMock.mockResolvedValue(0);
    hasOrganizationMemberSubscriptionPeriodGrantMock.mockResolvedValue(false);
    getSubscriptionSeatCreditsMock.mockResolvedValue({
      pro: 10000,
      standard: 4000,
      starter: 1000,
    });
    creditBucketFindUniqueMock.mockResolvedValue(null);
    transactionCreateMock.mockResolvedValue({});
    taskFindManyMock.mockResolvedValue([]);
    ensureLocalFreeSubscriptionPeriodMock.mockResolvedValue({
      grantsCreated: 0,
      subscriptionCreated: false,
      subscriptionId: "sub-local-free",
    });
    fetchOrganizationMemberUserIdsMock.mockResolvedValue([]);
  });

  it("returns 404 when the organization does not exist", async () => {
    organizationFindUniqueMock.mockResolvedValue(null);
    const response = await assignSeat("missing", "member_456");
    expect(response.status).toBe(404);
    expect(assignSeatMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the user is not a member", async () => {
    setMembership(null);
    const response = await assignSeat("org_123", "member_456");
    expect(response.status).toBe(403);
    expect(assignSeatMock).not.toHaveBeenCalled();
  });

  it("returns 403 for a member who is not an owner or admin", async () => {
    setMembership("member");
    const response = await assignSeat("org_123", "member_456");
    expect(response.status).toBe(403);
    expect(assignSeatMock).not.toHaveBeenCalled();
  });

  it("assigns a seat and grants unused-seat credits for an owner", async () => {
    setMembership("owner");
    const response = await assignSeat("org_123", "member_456");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      memberId: "member_456",
      seatAssignedAt: "2026-05-01T00:00:00.000Z",
    });
    expect(assignSeatMock).toHaveBeenCalledWith(
      "member_456",
      "org_123",
      3,
      expect.anything(),
    );
    expect(transactionCreateMock).toHaveBeenCalledOnce();
    expect(transactionCreateMock.mock.calls[0]?.[0]?.data).toMatchObject({
      amount: convertCreditsToCents(1000),
    });
  });

  it("fails when the Stripe catalog cannot be resolved", async () => {
    setMembership("owner");
    getSubscriptionSeatCreditsMock.mockRejectedValue(
      new Error("Missing credits metadata for starter plan"),
    );

    const response = await assignSeat("org_123", "member_456");

    expect(response.status).toBe(500);
    expect(transactionCreateMock).not.toHaveBeenCalled();
  });

  it("skips credit grants when assigning on consumable enterprise contracts", async () => {
    setMembership("owner");
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      cancelAtPeriodEnd: false,
      contractId: "contract_1",
      isConsumable: true,
      mode: "enterprise_contract",
      periodEnd: null,
      plan: "enterprise",
      purchasedSeats: 3,
    });

    const response = await assignSeat("org_123", "member_456");

    expect(response.status).toBe(200);
    expect(resolveActiveSubscriptionByReferenceIdMock).not.toHaveBeenCalled();
    expect(transactionCreateMock).not.toHaveBeenCalled();
  });

  it("syncs local-free credits when assigning in a free organization", async () => {
    setMembership("owner");
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      periodEnd: FUTURE_PERIOD_END,
      periodStart: new Date("2026-05-01T00:00:00.000Z"),
      plan: "free",
      seats: 3,
      status: "active",
      stripeSubscriptionId: null,
    });
    fetchOrganizationMemberUserIdsMock.mockResolvedValue([
      "user_123",
      "user_456",
    ]);

    const response = await assignSeat("org_123", "member_456");

    expect(response.status).toBe(200);
    expect(transactionCreateMock).not.toHaveBeenCalled();
    expect(ensureLocalFreeSubscriptionPeriodMock).toHaveBeenCalledWith(
      expect.objectContaining({
        memberUserIds: ["user_123", "user_456"],
        organizationId: "org_123",
        referenceId: "org_123",
      }),
      expect.anything(),
    );
  });

  it("returns 404 when the member does not exist", async () => {
    setMembership("owner");
    assignSeatMock.mockRejectedValue(new Error("Member not found"));

    const response = await assignSeat("org_123", "member_456");

    expect(response.status).toBe(404);
    expect(await response.text()).toContain("Member not found");
  });

  it("returns 400 when assignment exceeds purchased seats", async () => {
    setMembership("owner");
    assignSeatMock.mockRejectedValue(
      new Error("Assigned seat count (4) exceeds purchased seats (3)"),
    );

    const response = await assignSeat("org_123", "member_456");

    expect(response.status).toBe(400);
    expect(await response.text()).toContain(
      "No unused seats available. Purchase more seats or unassign another member.",
    );
  });
});
