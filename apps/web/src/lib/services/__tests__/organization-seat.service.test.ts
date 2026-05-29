import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("better-auth/api", () => ({
  APIError: class APIError extends Error {
    status?: string;
    constructor(code: string, options?: { message?: string }) {
      super(options?.message ?? "API error");
      this.name = "APIError";
      this.status = code;
    }
  },
}));

const getMemberByUserIdAndOrganizationIdMock = vi.fn();
const getAssignedMemberCountMock = vi.fn();
const assignSeatMock = vi.fn();
const unassignSeatMock = vi.fn();
const getLatestActiveSubscriptionByReferenceIdMock = vi.fn();
const memberCountMock = vi.fn();

vi.mock("@sokosumi/database/repositories", () => ({
  memberRepository: {
    assignSeat: (...args: unknown[]) => assignSeatMock(...args),
    getAssignedMemberCount: (...args: unknown[]) =>
      getAssignedMemberCountMock(...args),
    getMemberByUserIdAndOrganizationId: (...args: unknown[]) =>
      getMemberByUserIdAndOrganizationIdMock(...args),
    unassignSeat: (...args: unknown[]) => unassignSeatMock(...args),
  },
  subscriptionRepository: {
    getLatestActiveSubscriptionByReferenceId: (...args: unknown[]) =>
      getLatestActiveSubscriptionByReferenceIdMock(...args),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  __esModule: true,
  default: {
    member: {
      count: (...args: unknown[]) => memberCountMock(...args),
    },
  },
}));

describe("organizationSeatService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns seat summary counts", async () => {
    getAssignedMemberCountMock.mockResolvedValue(2);
    memberCountMock.mockResolvedValue(5);
    getLatestActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      seats: 4,
    });

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    await expect(
      organizationSeatService.getSeatSummary("org-1"),
    ).resolves.toEqual({
      assignedCount: 2,
      memberCount: 5,
      purchasedSeats: 4,
      unusedSeats: 2,
    });
  });

  it("assigns a seat when caller is owner and capacity remains", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({ role: "owner" });
    getLatestActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      seats: 3,
    });
    assignSeatMock.mockResolvedValue({
      id: "member-1",
      seatAssignedAt: new Date("2026-05-01T00:00:00.000Z"),
    });

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    const result = await organizationSeatService.assignSeat(
      "user-1",
      "org-1",
      "member-1",
    );

    expect(result.memberId).toBe("member-1");
    expect(assignSeatMock).toHaveBeenCalledWith(
      "member-1",
      "org-1",
      3,
      expect.any(Object),
    );
  });

  it("rejects seat assignment for non-admin members", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({
      role: "member",
    });

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    await expect(
      organizationSeatService.assignSeat("user-1", "org-1", "member-1"),
    ).rejects.toThrow(
      "Only organization owners and admins can manage seat assignments",
    );
  });
});
