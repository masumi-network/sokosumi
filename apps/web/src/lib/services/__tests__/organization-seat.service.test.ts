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

const getMyMemberInOrganizationMock = vi.fn();
const getOrganizationMembersMock = vi.fn();
const getOrganizationBillingPlanMock = vi.fn();
const assignOrganizationMemberSeatMock = vi.fn();
const unassignOrganizationMemberSeatMock = vi.fn();

vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError: class CoreApiRequestError extends Error {
    status?: number;
    constructor(message: string, options?: { status?: number }) {
      super(message);
      this.name = "CoreApiRequestError";
      this.status = options?.status;
    }
  },
  coreClient: {
    assignOrganizationMemberSeat: (...args: unknown[]) =>
      assignOrganizationMemberSeatMock(...args),
    getMyMemberInOrganization: (...args: unknown[]) =>
      getMyMemberInOrganizationMock(...args),
    getOrganizationBillingPlan: (...args: unknown[]) =>
      getOrganizationBillingPlanMock(...args),
    getOrganizationMembers: (...args: unknown[]) =>
      getOrganizationMembersMock(...args),
    unassignOrganizationMemberSeat: (...args: unknown[]) =>
      unassignOrganizationMemberSeatMock(...args),
  },
}));

describe("organizationSeatService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMyMemberInOrganizationMock.mockResolvedValue({
      data: { role: "owner" },
    });
  });

  it("returns zero purchased seats for free organizations", async () => {
    getOrganizationMembersMock.mockResolvedValue({
      data: [
        { seatAssignedAt: "2025-01-01T00:00:00.000Z" },
        { seatAssignedAt: null },
        { seatAssignedAt: null },
        { seatAssignedAt: null },
        { seatAssignedAt: null },
      ],
    });
    getOrganizationBillingPlanMock.mockResolvedValue({
      data: {
        mode: "self_serve",
        plan: "free",
        purchasedSeats: 0,
      },
    });

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    await expect(
      organizationSeatService.getSeatSummary("org-1"),
    ).resolves.toEqual({
      assignedCount: 0,
      isEnterpriseContract: false,
      memberCount: 5,
      paidPlan: null,
      purchasedSeats: 0,
      unusedSeats: 0,
    });
  });

  it("returns seat summary for paid organizations", async () => {
    getOrganizationMembersMock.mockResolvedValue({
      data: [
        { seatAssignedAt: "2025-01-01T00:00:00.000Z" },
        { seatAssignedAt: "2025-01-02T00:00:00.000Z" },
        { seatAssignedAt: null },
      ],
    });
    getOrganizationBillingPlanMock.mockResolvedValue({
      data: {
        mode: "self_serve",
        plan: "starter",
        purchasedSeats: 5,
      },
    });

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    await expect(
      organizationSeatService.getSeatSummary("org-1"),
    ).resolves.toEqual({
      assignedCount: 2,
      isEnterpriseContract: false,
      memberCount: 3,
      paidPlan: "starter",
      purchasedSeats: 5,
      unusedSeats: 3,
    });
  });

  it("assigns a seat through Core API", async () => {
    assignOrganizationMemberSeatMock.mockResolvedValue({
      data: {
        memberId: "member-1",
        seatAssignedAt: "2025-01-01T00:00:00.000Z",
      },
    });

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    await expect(
      organizationSeatService.assignSeat("user-1", "org-1", "member-1"),
    ).resolves.toEqual({
      memberId: "member-1",
      seatAssignedAt: new Date("2025-01-01T00:00:00.000Z"),
    });

    expect(assignOrganizationMemberSeatMock).toHaveBeenCalledWith(
      "org-1",
      "member-1",
    );
  });

  it("rejects assign when caller is not owner or admin", async () => {
    getMyMemberInOrganizationMock.mockResolvedValue({
      data: { role: "member" },
    });

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    await expect(
      organizationSeatService.assignSeat("user-1", "org-1", "member-1"),
    ).rejects.toMatchObject({
      status: "FORBIDDEN",
    });
  });

  it("maps Core 404 to member not found", async () => {
    const { CoreApiRequestError } = await import("@/lib/clients/core.client");
    assignOrganizationMemberSeatMock.mockRejectedValue(
      new CoreApiRequestError("Member not found", { status: 404 }),
    );

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    await expect(
      organizationSeatService.assignSeat("user-1", "org-1", "member-1"),
    ).rejects.toMatchObject({
      status: "NOT_FOUND",
    });
  });

  it("unassigns a seat through Core API", async () => {
    unassignOrganizationMemberSeatMock.mockResolvedValue({
      data: { memberId: "member-1" },
    });

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    await expect(
      organizationSeatService.unassignSeat("user-1", "org-1", "member-1"),
    ).resolves.toEqual({
      memberId: "member-1",
    });
  });
});
