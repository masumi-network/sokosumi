import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler.js";
import { OpenAPIHonoWithAuth } from "@/lib/hono.js";

const { organizationFindUniqueMock, transactionMock, unassignSeatMock } =
  vi.hoisted(() => ({
    organizationFindUniqueMock: vi.fn(),
    transactionMock: vi.fn(),
    unassignSeatMock: vi.fn(),
  }));

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

vi.mock("@sokosumi/database/repositories", () => ({
  memberRepository: {
    unassignSeat: (...args: unknown[]) => unassignSeatMock(...args),
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

const { default: mountUnassignAdminOrganizationMemberSeat } = await import(
  "./delete.js"
);

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  mountUnassignAdminOrganizationMemberSeat(app);
  return app;
}

function unassignSeat(slug: string, memberId: string) {
  return createApp().request(
    `http://localhost/${slug}/members/${memberId}/seat`,
    { method: "DELETE" },
  );
}

describe("DELETE /v1/admin/organizations/{slug}/members/{memberId}/seat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.mockImplementation(
      async (callback: (tx: unknown) => unknown) => callback({}),
    );
    organizationFindUniqueMock.mockResolvedValue({ id: "org_123" });
    unassignSeatMock.mockResolvedValue({
      id: "member_456",
      seatAssignedAt: null,
    });
  });

  it("returns 404 when the organization does not exist", async () => {
    organizationFindUniqueMock.mockResolvedValue(null);

    const response = await unassignSeat("missing", "member_456");

    expect(response.status).toBe(404);
    expect(unassignSeatMock).not.toHaveBeenCalled();
  });

  it("releases the seat in a serializable transaction", async () => {
    const response = await unassignSeat("acme", "member_456");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ memberId: "member_456" });
    expect(unassignSeatMock).toHaveBeenCalledWith(
      "member_456",
      "org_123",
      expect.anything(),
    );
    // Not toHaveBeenCalledWith: that passes when any one call matches.
    expect(transactionMock.mock.calls).toHaveLength(1);
    expect(transactionMock.mock.calls[0]?.[1]).toEqual({
      isolationLevel: "Serializable",
    });
  });

  it("returns 404 when the member does not exist", async () => {
    unassignSeatMock.mockRejectedValue(new Error("Member not found"));

    const response = await unassignSeat("acme", "member_456");

    expect(response.status).toBe(404);
  });

  it("returns 409 when the release keeps losing the serialization race", async () => {
    transactionMock.mockRejectedValue(
      Object.assign(new Error("Transaction failed"), { code: "P2034" }),
    );
    vi.useFakeTimers();
    try {
      const pending = unassignSeat("acme", "member_456");
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
