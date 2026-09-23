import { APIError } from "better-auth/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";

vi.mock("server-only", () => ({}));

export {};

const assignSeatMock = vi.fn();
const unassignSeatMock = vi.fn();

vi.mock("@/lib/services/organization-seat.service", () => ({
  organizationSeatService: {
    assignSeat: (...args: unknown[]) => assignSeatMock(...args),
    unassignSeat: (...args: unknown[]) => unassignSeatMock(...args),
  },
}));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    (handler: (params: unknown) => Promise<unknown>) =>
    async (params: unknown) =>
      await handler(params),
}));

const session = {
  user: {
    id: "user-1",
  },
} as never;

describe("assignOrganizationSeat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns the assigned seat", async () => {
    const seatAssignedAt = new Date("2026-05-01T00:00:00.000Z");
    assignSeatMock.mockResolvedValue({ memberId: "member-1", seatAssignedAt });

    const { assignOrganizationSeat } = await import("./seat-action");
    const result = await assignOrganizationSeat({
      session,
      memberId: "member-1",
      organizationId: "org-1",
    });

    expect(result).toMatchObject({
      ok: true,
      value: { memberId: "member-1", seatAssignedAt },
    });
  });

  it("keeps the retry message when the seat write hits a CONFLICT", async () => {
    assignSeatMock.mockRejectedValue(
      new APIError("CONFLICT", {
        message: "Another seat change was in progress. Try again.",
      }),
    );

    const { assignOrganizationSeat } = await import("./seat-action");
    const result = await assignOrganizationSeat({
      session,
      memberId: "member-1",
      organizationId: "org-1",
    });

    expect(result).toMatchObject({
      error: {
        code: CommonErrorCode.BAD_INPUT,
        message: "Another seat change was in progress. Try again.",
      },
    });
  });

  it("maps a FORBIDDEN to UNAUTHORIZED", async () => {
    assignSeatMock.mockRejectedValue(
      new APIError("FORBIDDEN", { message: "Not an owner or admin" }),
    );

    const { assignOrganizationSeat } = await import("./seat-action");
    const result = await assignOrganizationSeat({
      session,
      memberId: "member-1",
      organizationId: "org-1",
    });

    expect(result).toMatchObject({
      error: {
        code: CommonErrorCode.UNAUTHORIZED,
        message: "Not an owner or admin",
      },
    });
  });

  it("maps an unknown failure to INTERNAL_SERVER_ERROR", async () => {
    assignSeatMock.mockRejectedValue(new Error("boom"));

    const { assignOrganizationSeat } = await import("./seat-action");
    const result = await assignOrganizationSeat({
      session,
      memberId: "member-1",
      organizationId: "org-1",
    });

    expect(result).toMatchObject({
      error: { code: CommonErrorCode.INTERNAL_SERVER_ERROR },
    });
  });
});
