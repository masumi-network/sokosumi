import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

const {
  organizationFindUniqueMock,
  memberFindUniqueMock,
  memberCountMock,
  getAssignedMemberCountMock,
  resolveOrganizationBillingPlanMock,
  transactionMock,
} = vi.hoisted(() => ({
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  memberCountMock: vi.fn(),
  getAssignedMemberCountMock: vi.fn(),
  resolveOrganizationBillingPlanMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/middleware/auth", async () => {
  const { mockRequireOwnerUserContext } = await import(
    "@/test-fixtures/require-owner-user-context.mock.js"
  );
  const { HTTPException } = await import("hono/http-exception");
  return {
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
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}));

vi.mock("@sokosumi/database/helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/helpers")>();
  return {
    ...actual,
    resolveOrganizationBillingPlan: (...args: unknown[]) =>
      resolveOrganizationBillingPlanMock(...args),
  };
});

vi.mock("@sokosumi/database/repositories", () => ({
  memberRepository: {
    getAssignedMemberCount: (...args: unknown[]) =>
      getAssignedMemberCountMock(...args),
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

let mountGetOrganizationSeatSummary: (app: OpenAPIHonoWithAuth) => void;

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

  mountGetOrganizationSeatSummary(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

function setMembership(role: string | null) {
  organizationFindUniqueMock.mockResolvedValue({ id: "org_123" });
  memberFindUniqueMock.mockResolvedValue(role ? { role } : null);
}

function getSeatSummary(id: string) {
  return createApp().request(`http://localhost/${id}/seat-summary`);
}

beforeAll(async () => {
  const module = await import("./get");
  mountGetOrganizationSeatSummary = module.default;
});

describe("GET /organizations/{id}/seat-summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.mockImplementation(
      async (callback: (tx: unknown) => unknown) =>
        callback({
          organization: { findUnique: organizationFindUniqueMock },
          member: {
            findUnique: memberFindUniqueMock,
            count: memberCountMock,
          },
        }),
    );
  });

  it("returns 404 when the organization does not exist", async () => {
    organizationFindUniqueMock.mockResolvedValue(null);
    const response = await getSeatSummary("missing");
    expect(response.status).toBe(404);
  });

  it("returns 403 when the user is not a member", async () => {
    setMembership(null);
    const response = await getSeatSummary("org_123");
    expect(response.status).toBe(403);
  });

  it("returns 403 for coworker authentication", async () => {
    const response = await createApp(COWORKER_AUTH_CONTEXT).request(
      "http://localhost/org_123/seat-summary",
    );
    expect(response.status).toBe(403);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("returns zeroed seat entitlements for free organizations", async () => {
    setMembership("member");
    getAssignedMemberCountMock.mockResolvedValue(2);
    memberCountMock.mockResolvedValue(5);
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      cancelAtPeriodEnd: false,
      mode: "self_serve",
      periodEnd: null,
      plan: "free",
      purchasedSeats: 0,
      subscriptionId: null,
    });

    const response = await getSeatSummary("org_123");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      assignedCount: 0,
      memberCount: 5,
      isEnterpriseContract: false,
      paidPlan: null,
      purchasedSeats: 0,
      unusedSeats: 0,
    });
  });

  it("returns seat counts for paid self-serve organizations", async () => {
    setMembership("member");
    getAssignedMemberCountMock.mockResolvedValue(2);
    memberCountMock.mockResolvedValue(5);
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      cancelAtPeriodEnd: false,
      mode: "self_serve",
      periodEnd: null,
      plan: "starter",
      purchasedSeats: 4,
      subscriptionId: "sub_1",
    });

    const response = await getSeatSummary("org_123");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      assignedCount: 2,
      memberCount: 5,
      isEnterpriseContract: false,
      paidPlan: "starter",
      purchasedSeats: 4,
      unusedSeats: 2,
    });
  });

  it("returns enterprise seat counts for enterprise contracts", async () => {
    setMembership("owner");
    getAssignedMemberCountMock.mockResolvedValue(2);
    memberCountMock.mockResolvedValue(5);
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      cancelAtPeriodEnd: false,
      contractId: "contract_1",
      isConsumable: false,
      mode: "enterprise_contract",
      periodEnd: null,
      plan: "enterprise",
      purchasedSeats: 12,
    });

    const response = await getSeatSummary("org_123");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      assignedCount: 2,
      memberCount: 5,
      isEnterpriseContract: true,
      paidPlan: "enterprise",
      purchasedSeats: 12,
      unusedSeats: 10,
    });
  });
});
