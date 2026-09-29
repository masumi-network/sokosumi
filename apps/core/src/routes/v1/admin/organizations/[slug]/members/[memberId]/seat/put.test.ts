import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler.js";
import { OpenAPIHonoWithAuth } from "@/lib/hono.js";

const {
  assignSeatMock,
  organizationFindUniqueMock,
  resolveOrganizationBillingPlanMock,
  transactionMock,
} = vi.hoisted(() => ({
  assignSeatMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  resolveOrganizationBillingPlanMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

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
    assignSeat: (...args: unknown[]) => assignSeatMock(...args),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (...args: unknown[]) => transactionMock(...args),
    organization: {
      findUnique: (...args: unknown[]) => organizationFindUniqueMock(...args),
    },
  },
}));

const { default: mountAssignAdminOrganizationMemberSeat } = await import(
  "./put.js"
);

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  mountAssignAdminOrganizationMemberSeat(app);
  return app;
}

function assignSeat(slug: string, memberId: string) {
  return createApp().request(
    `http://localhost/${slug}/members/${memberId}/seat`,
    { method: "PUT" },
  );
}

describe("PUT /v1/admin/organizations/{slug}/members/{memberId}/seat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.mockImplementation(
      async (callback: (tx: unknown) => unknown) => callback({}),
    );
    organizationFindUniqueMock.mockResolvedValue({ id: "org_123" });
    resolveOrganizationBillingPlanMock.mockResolvedValue({ purchasedSeats: 3 });
    assignSeatMock.mockResolvedValue({
      id: "member_456",
      seatAssignedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
  });

  it("returns 404 when the organization does not exist", async () => {
    organizationFindUniqueMock.mockResolvedValue(null);

    const response = await assignSeat("missing", "member_456");

    expect(response.status).toBe(404);
    expect(assignSeatMock).not.toHaveBeenCalled();
  });

  it("assigns the seat in a serializable transaction", async () => {
    const response = await assignSeat("acme", "member_456");
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
    // Not toHaveBeenCalledWith: that passes when any one call matches.
    expect(transactionMock.mock.calls).toHaveLength(1);
    expect(transactionMock.mock.calls[0]?.[1]).toEqual({
      isolationLevel: "Serializable",
    });
  });

  it("returns 400 when the assignment exceeds purchased seats", async () => {
    assignSeatMock.mockRejectedValue(
      new Error("Assigned seat count (4) exceeds purchased seats (3)"),
    );

    const response = await assignSeat("acme", "member_456");

    expect(response.status).toBe(400);
  });

  it("returns 409 when the assignment keeps losing the serialization race", async () => {
    transactionMock.mockRejectedValue(
      Object.assign(new Error("Transaction failed"), { code: "P2034" }),
    );
    vi.useFakeTimers();
    try {
      const pending = assignSeat("acme", "member_456");
      await vi.runAllTimersAsync();
      const response = await pending;

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        kind: "concurrency_conflict",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
