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
  getSubscriptionCatalogMock,
} = vi.hoisted(() => ({
  getOrganizationSeatSummaryMock: vi.fn(),
  assignOrganizationSeatMock: vi.fn(),
  unassignOrganizationSeatMock: vi.fn(),
  getSubscriptionCatalogMock: vi.fn(),
}));

class MockCoreApiRequestError extends Error {
  status?: number;

  constructor(message: string, options?: { status?: number }) {
    super(message);
    this.name = "CoreApiRequestError";
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

vi.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => ({
    STRIPE_SECRET_KEY: "sk_test_mock",
  }),
}));

vi.mock("@/lib/stripe/subscription-catalog", () => ({
  getSubscriptionCatalog: (...args: unknown[]) =>
    getSubscriptionCatalogMock(...args),
}));

vi.mock("stripe", () => ({
  __esModule: true,
  default: vi.fn(function MockStripe() {
    return {};
  }),
}));

function coreError(status: number, message: string) {
  return new MockCoreApiRequestError(message, { status });
}

describe("organizationSeatService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSubscriptionCatalogMock.mockResolvedValue({
      pro: { credits: 10000 },
      standard: { credits: 4000 },
      starter: { credits: 1000 },
    });
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

  it("assigns a seat through core, passing the catalog seat credits", async () => {
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
      {
        seatCreditsByPlan: {
          pro: 10000,
          standard: 4000,
          starter: 1000,
        },
      },
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
