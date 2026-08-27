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
  unassignSeatMock,
  resolveActiveSubscriptionByReferenceIdMock,
  resolveOrganizationBillingPlanMock,
  grantFreeOrganizationMemberSubscriptionCreditsMock,
  ensureLocalFreeSubscriptionPeriodMock,
  fetchOrganizationMemberUserIdsMock,
  transactionMock,
} = vi.hoisted(() => ({
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  unassignSeatMock: vi.fn(),
  resolveActiveSubscriptionByReferenceIdMock: vi.fn(),
  resolveOrganizationBillingPlanMock: vi.fn(),
  grantFreeOrganizationMemberSubscriptionCreditsMock: vi.fn(),
  ensureLocalFreeSubscriptionPeriodMock: vi.fn(),
  fetchOrganizationMemberUserIdsMock: vi.fn(),
  transactionMock: vi.fn(),
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
    ensureLocalFreeSubscriptionPeriod: (...args: unknown[]) =>
      ensureLocalFreeSubscriptionPeriodMock(...args),
    fetchOrganizationMemberUserIds: (...args: unknown[]) =>
      fetchOrganizationMemberUserIdsMock(...args),
    grantFreeOrganizationMemberSubscriptionCredits: (...args: unknown[]) =>
      grantFreeOrganizationMemberSubscriptionCreditsMock(...args),
    resolveOrganizationBillingPlan: (...args: unknown[]) =>
      resolveOrganizationBillingPlanMock(...args),
  };
});

vi.mock("@sokosumi/database/repositories", () => ({
  memberRepository: {
    unassignSeat: (...args: unknown[]) => unassignSeatMock(...args),
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

let mountDeleteOrganizationMemberSeat: (app: OpenAPIHonoWithAuth) => void;

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

  mountDeleteOrganizationMemberSeat(app);
  return app;
}

function setMembership(role: string | null) {
  organizationFindUniqueMock.mockResolvedValue({ id: "org_123" });
  memberFindUniqueMock.mockResolvedValue(role ? { role } : null);
}

function unassignSeat(
  id: string,
  memberId: string,
  authContext: AuthenticationContext | null = USER_AUTH_CONTEXT,
) {
  return createApp(authContext).request(
    `http://localhost/${id}/members/${memberId}/seat`,
    {
      method: "DELETE",
    },
  );
}

beforeAll(async () => {
  const module = await import("./delete");
  mountDeleteOrganizationMemberSeat = module.default;
});

describe("DELETE /organizations/{id}/members/{memberId}/seat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.mockImplementation(
      async (callback: (tx: unknown) => unknown) =>
        callback({
          organization: { findUnique: organizationFindUniqueMock },
          member: { findUnique: memberFindUniqueMock },
        }),
    );
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      cancelAtPeriodEnd: false,
      mode: "self_serve",
      periodEnd: null,
      plan: "starter",
      purchasedSeats: 3,
      subscriptionId: "sub_1",
    });
    unassignSeatMock.mockResolvedValue({
      id: "member_456",
      seatAssignedAt: null,
      userId: "user_456",
    });
    grantFreeOrganizationMemberSubscriptionCreditsMock.mockResolvedValue(1);
    ensureLocalFreeSubscriptionPeriodMock.mockResolvedValue({
      grantsCreated: 0,
      subscriptionCreated: false,
      subscriptionId: "sub-local-free",
    });
    fetchOrganizationMemberUserIdsMock.mockResolvedValue([]);
  });

  it("returns 404 when the organization does not exist", async () => {
    organizationFindUniqueMock.mockResolvedValue(null);
    const response = await unassignSeat("missing", "member_456");
    expect(response.status).toBe(404);
    expect(unassignSeatMock).not.toHaveBeenCalled();
  });

  it("returns 403 for a member who is not an owner or admin", async () => {
    setMembership("member");
    const response = await unassignSeat("org_123", "member_456");
    expect(response.status).toBe(403);
    expect(unassignSeatMock).not.toHaveBeenCalled();
  });

  it("grants free monthly credits when unassigning in a paid organization", async () => {
    setMembership("owner");
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      periodEnd: new Date("2026-06-01T00:00:00.000Z"),
      plan: "starter",
      status: "active",
      stripeSubscriptionId: "sub_123",
    });

    const response = await unassignSeat("org_123", "member_456");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ memberId: "member_456" });
    expect(unassignSeatMock).toHaveBeenCalledWith(
      "member_456",
      "org_123",
      expect.anything(),
    );
    expect(
      grantFreeOrganizationMemberSubscriptionCreditsMock,
    ).toHaveBeenCalledWith(
      {
        memberUserIds: ["user_456"],
        organizationId: "org_123",
        periodEnd: new Date("2026-06-01T00:00:00.000Z"),
      },
      expect.anything(),
    );
    expect(ensureLocalFreeSubscriptionPeriodMock).not.toHaveBeenCalled();
  });

  it("syncs local-free credits when unassigning in a free organization", async () => {
    setMembership("admin");
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      periodEnd: new Date("2026-06-01T00:00:00.000Z"),
      periodStart: new Date("2026-05-01T00:00:00.000Z"),
      plan: "free",
      seats: 2,
      status: "active",
      stripeSubscriptionId: null,
    });
    fetchOrganizationMemberUserIdsMock.mockResolvedValue([
      "user_123",
      "user_456",
    ]);

    const response = await unassignSeat("org_123", "member_456");

    expect(response.status).toBe(200);
    expect(
      grantFreeOrganizationMemberSubscriptionCreditsMock,
    ).not.toHaveBeenCalled();
    expect(ensureLocalFreeSubscriptionPeriodMock).toHaveBeenCalledWith(
      {
        billingAnchorDate: new Date("2026-01-01T00:00:00.000Z"),
        memberUserIds: ["user_123", "user_456"],
        organizationId: "org_123",
        periodEnd: new Date("2026-06-01T00:00:00.000Z"),
        periodStart: new Date("2026-05-01T00:00:00.000Z"),
        purchasedSeats: 2,
        referenceId: "org_123",
      },
      expect.anything(),
    );
  });

  it("skips credit handling when unassigning on consumable enterprise contracts", async () => {
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

    const response = await unassignSeat("org_123", "member_456");

    expect(response.status).toBe(200);
    expect(resolveActiveSubscriptionByReferenceIdMock).not.toHaveBeenCalled();
    expect(
      grantFreeOrganizationMemberSubscriptionCreditsMock,
    ).not.toHaveBeenCalled();
  });

  it("returns 404 when the member does not exist", async () => {
    setMembership("owner");
    unassignSeatMock.mockRejectedValue(new Error("Member not found"));

    const response = await unassignSeat("org_123", "member_456");

    expect(response.status).toBe(404);
    expect(await response.text()).toContain("Member not found");
  });

  it("rejects coworker context even with X-Context-User-Id", async () => {
    setMembership("owner");

    const response = await unassignSeat("org_123", "member_456", {
      actor: "coworker",
      coworkerId: "coworker_1",
      vendorId: "vendor_1",
      context: { userId: "user_123", organizationId: "org_123" },
    });

    expect(response.status).toBe(403);
    expect(organizationFindUniqueMock).not.toHaveBeenCalled();
    expect(unassignSeatMock).not.toHaveBeenCalled();
  });

  it("allows orchestrator with context headers as the context user", async () => {
    setMembership("owner");
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      periodEnd: new Date("2026-06-01T00:00:00.000Z"),
      plan: "starter",
      status: "active",
      stripeSubscriptionId: "sub_123",
    });

    const response = await unassignSeat("org_123", "member_456", {
      actor: "orchestrator",
      orchestratorId: "orch_1",
      context: { userId: "user_123", organizationId: "org_123" },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ memberId: "member_456" });
    expect(unassignSeatMock).toHaveBeenCalledWith(
      "member_456",
      "org_123",
      expect.anything(),
    );
  });
});
