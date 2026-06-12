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

const {
  getOrganizationSeatSummaryMock,
  assignOrganizationSeatMock,
  unassignOrganizationSeatMock,
} = vi.hoisted(() => ({
  getOrganizationSeatSummaryMock: vi.fn(),
  assignOrganizationSeatMock: vi.fn(),
  unassignOrganizationSeatMock: vi.fn(),
}));

class MockCoreApiRequestError extends Error {
  kind?: string;
  status?: number;

  constructor(message: string, options?: { kind?: string; status?: number }) {
    super(message);
    this.name = "CoreApiRequestError";
    this.kind = options?.kind;
    this.status = options?.status;
  }
}

vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError: MockCoreApiRequestError,
  coreClient: {
    assignOrganizationSeat: (...args: unknown[]) =>
      assignOrganizationSeatMock(...args),
    getOrganizationSeatSummary: (...args: unknown[]) =>
      getOrganizationSeatSummaryMock(...args),
    unassignOrganizationSeat: (...args: unknown[]) =>
      unassignOrganizationSeatMock(...args),
  },
}));

function coreError(status: number, message: string, kind?: string) {
  return new MockCoreApiRequestError(message, { kind, status });
}

describe("organizationSeatService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the seat summary resolved by core", async () => {
    getOrganizationSeatSummaryMock.mockResolvedValue({
      data: {
        assignedCount: 2,
        memberCount: 5,
        isEnterpriseContract: false,
        paidPlan: "starter",
        purchasedSeats: 4,
        unusedSeats: 2,
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
      memberCount: 5,
      paidPlan: "starter",
      purchasedSeats: 4,
      unusedSeats: 2,
    });
    expect(getOrganizationSeatSummaryMock).toHaveBeenCalledWith("org-1");
  });

  it("resolves the seat summary to null when core responds 403", async () => {
    getOrganizationSeatSummaryMock.mockRejectedValue(
      coreError(403, "You are not a member of this organization"),
    );

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    await expect(
      organizationSeatService.getSeatSummary("org-1"),
    ).resolves.toBeNull();
  });

  it("resolves the seat summary to null when core responds 404", async () => {
    getOrganizationSeatSummaryMock.mockRejectedValue(
      coreError(404, "Organization not found", "organization_not_found"),
    );

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    await expect(
      organizationSeatService.getSeatSummary("org-1"),
    ).resolves.toBeNull();
  });

  it("rethrows other seat summary errors", async () => {
    const failure = coreError(500, "Internal Server Error");
    getOrganizationSeatSummaryMock.mockRejectedValue(failure);

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    await expect(organizationSeatService.getSeatSummary("org-1")).rejects.toBe(
      failure,
    );
  });

  it("assigns a seat through core", async () => {
    assignOrganizationSeatMock.mockResolvedValue({
      data: {
        memberId: "member-1",
        seatAssignedAt: "2026-05-01T00:00:00.000Z",
      },
    });

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    const result = await organizationSeatService.assignSeat(
      "user-1",
      "org-1",
      "member-1",
    );

    expect(result).toEqual({
      memberId: "member-1",
      seatAssignedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    expect(assignOrganizationSeatMock).toHaveBeenCalledWith(
      "org-1",
      "member-1",
    );
  });

  it("maps a core 403 to the seat-management FORBIDDEN error", async () => {
    assignOrganizationSeatMock.mockRejectedValue(
      coreError(403, "You must be owner, admin"),
    );

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    await expect(
      organizationSeatService.assignSeat("user-1", "org-1", "member-1"),
    ).rejects.toMatchObject({
      status: "FORBIDDEN",
      message:
        "Only organization owners and admins can manage seat assignments",
    });
  });

  it("maps a missing organization to FORBIDDEN like the previous guard", async () => {
    assignOrganizationSeatMock.mockRejectedValue(
      coreError(404, "Organization not found"),
    );

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    await expect(
      organizationSeatService.assignSeat("user-1", "org-1", "member-1"),
    ).rejects.toMatchObject({
      status: "FORBIDDEN",
      message:
        "Only organization owners and admins can manage seat assignments",
    });
  });

  it("maps the organization_not_found kind to FORBIDDEN even when the message is reworded", async () => {
    assignOrganizationSeatMock.mockRejectedValue(
      coreError(
        404,
        "We could not find that organization",
        "organization_not_found",
      ),
    );

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    await expect(
      organizationSeatService.assignSeat("user-1", "org-1", "member-1"),
    ).rejects.toMatchObject({
      status: "FORBIDDEN",
      message:
        "Only organization owners and admins can manage seat assignments",
    });
  });

  it("maps the member_not_found kind to NOT_FOUND", async () => {
    assignOrganizationSeatMock.mockRejectedValue(
      coreError(404, "Member not found", "member_not_found"),
    );

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    await expect(
      organizationSeatService.assignSeat("user-1", "org-1", "member-1"),
    ).rejects.toMatchObject({
      status: "NOT_FOUND",
      message: "Member not found",
    });
  });

  it("maps the seat_capacity_exceeded kind to BAD_REQUEST", async () => {
    assignOrganizationSeatMock.mockRejectedValue(
      coreError(
        400,
        "No unused seats available. Purchase more seats or unassign another member.",
        "seat_capacity_exceeded",
      ),
    );

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    await expect(
      organizationSeatService.assignSeat("user-1", "org-1", "member-1"),
    ).rejects.toMatchObject({
      status: "BAD_REQUEST",
      message:
        "No unused seats available. Purchase more seats or unassign another member.",
    });
  });

  it("maps a missing member to NOT_FOUND", async () => {
    assignOrganizationSeatMock.mockRejectedValue(
      coreError(404, "Member not found"),
    );

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    await expect(
      organizationSeatService.assignSeat("user-1", "org-1", "member-1"),
    ).rejects.toMatchObject({
      status: "NOT_FOUND",
      message: "Member not found",
    });
  });

  it("maps exhausted capacity to BAD_REQUEST with core's message", async () => {
    assignOrganizationSeatMock.mockRejectedValue(
      coreError(
        400,
        "No unused seats available. Purchase more seats or unassign another member.",
      ),
    );

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    await expect(
      organizationSeatService.assignSeat("user-1", "org-1", "member-1"),
    ).rejects.toMatchObject({
      status: "BAD_REQUEST",
      message:
        "No unused seats available. Purchase more seats or unassign another member.",
    });
  });

  it("rethrows non-core errors from seat assignment", async () => {
    const failure = new Error("network down");
    assignOrganizationSeatMock.mockRejectedValue(failure);

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    await expect(
      organizationSeatService.assignSeat("user-1", "org-1", "member-1"),
    ).rejects.toBe(failure);
  });

  it("unassigns a seat through core", async () => {
    unassignOrganizationSeatMock.mockResolvedValue({
      data: {
        memberId: "member-1",
      },
    });

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    await expect(
      organizationSeatService.unassignSeat("user-1", "org-1", "member-1"),
    ).resolves.toEqual({
      memberId: "member-1",
    });
    expect(unassignOrganizationSeatMock).toHaveBeenCalledWith(
      "org-1",
      "member-1",
    );
  });

  it("maps a core 403 on unassign to the seat-management FORBIDDEN error", async () => {
    unassignOrganizationSeatMock.mockRejectedValue(
      coreError(403, "You must be owner, admin"),
    );

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    await expect(
      organizationSeatService.unassignSeat("user-1", "org-1", "member-1"),
    ).rejects.toMatchObject({
      status: "FORBIDDEN",
      message:
        "Only organization owners and admins can manage seat assignments",
    });
  });
});
