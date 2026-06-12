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

const getAssignedMemberCountMock = vi.fn();
const getOrganizationMemberUserIdsMock = vi.fn();
const getUnassignedMemberUserIdsMock = vi.fn();
const ensureLocalFreeSubscriptionPeriodMock = vi.fn();
const grantFreeOrganizationMemberSubscriptionCreditsMock = vi.fn();
const resolveActiveSubscriptionByReferenceIdMock = vi.fn();
const resolveOrganizationBillingPlanMock = vi.fn();
const prismaTransactionMock = vi.fn();
const updateSubscriptionRecordMock = vi.fn();
const updateOrganizationSubscriptionSeatsMock = vi.fn();

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
    updateOrganizationSubscriptionSeats: (...args: unknown[]) =>
      updateOrganizationSubscriptionSeatsMock(...args),
  },
}));

vi.mock("@sokosumi/database/repositories", () => ({
  memberRepository: {
    getAssignedMemberCount: (...args: unknown[]) =>
      getAssignedMemberCountMock(...args),
    getOrganizationMemberUserIds: (...args: unknown[]) =>
      getOrganizationMemberUserIdsMock(...args),
    getUnassignedMemberUserIds: (...args: unknown[]) =>
      getUnassignedMemberUserIdsMock(...args),
  },
  subscriptionRepository: {
    resolveActiveSubscriptionByReferenceId: (...args: unknown[]) =>
      resolveActiveSubscriptionByReferenceIdMock(...args),
  },
}));

vi.mock("@sokosumi/database/helpers", () => ({
  ensureLocalFreeSubscriptionPeriod: (...args: unknown[]) =>
    ensureLocalFreeSubscriptionPeriodMock(...args),
  grantFreeOrganizationMemberSubscriptionCredits: (...args: unknown[]) =>
    grantFreeOrganizationMemberSubscriptionCreditsMock(...args),
  resolvePurchasedSeats: (seats: number | null | undefined) =>
    seats && seats > 0 ? seats : 1,
  resolveOrganizationBillingPlan: (...args: unknown[]) =>
    resolveOrganizationBillingPlanMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  __esModule: true,
  default: {
    $transaction: (...args: unknown[]) => prismaTransactionMock(...args),
    member: {
      count: vi.fn(),
    },
    subscription: {
      update: (...args: unknown[]) => updateSubscriptionRecordMock(...args),
    },
  },
}));

describe("organizationSubscriptionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaTransactionMock.mockImplementation(
      async (callback) =>
        await callback({
          __tx: true,
          subscription: {
            update: (...args: unknown[]) =>
              updateSubscriptionRecordMock(...args),
          },
        }),
    );
  });

  describe("updateOrganizationSeatsImmediately", () => {
    it("returns the seat count resolved by core", async () => {
      updateOrganizationSubscriptionSeatsMock.mockResolvedValue({
        data: { seats: 6 },
      });

      const { organizationSubscriptionService } = await import(
        "../organization-subscription.service"
      );

      await expect(
        organizationSubscriptionService.updateOrganizationSeatsImmediately(
          "user-1",
          "org-1",
          6,
        ),
      ).resolves.toEqual({
        seats: 6,
      });

      expect(updateOrganizationSubscriptionSeatsMock).toHaveBeenCalledWith(
        "org-1",
        6,
      );
    });

    it("maps a core 403 to the owner/admin FORBIDDEN error", async () => {
      updateOrganizationSubscriptionSeatsMock.mockRejectedValue(
        new MockCoreApiRequestError("You must be owner, admin", {
          status: 403,
        }),
      );

      const { organizationSubscriptionService } = await import(
        "../organization-subscription.service"
      );

      await expect(
        organizationSubscriptionService.updateOrganizationSeatsImmediately(
          "user-1",
          "org-1",
          3,
        ),
      ).rejects.toThrow(
        "Only organization owners and admins can manage subscriptions",
      );
    });

    it("maps a missing organization to the owner/admin FORBIDDEN error", async () => {
      updateOrganizationSubscriptionSeatsMock.mockRejectedValue(
        new MockCoreApiRequestError("Organization not found", {
          status: 404,
        }),
      );

      const { organizationSubscriptionService } = await import(
        "../organization-subscription.service"
      );

      await expect(
        organizationSubscriptionService.updateOrganizationSeatsImmediately(
          "user-1",
          "org-1",
          3,
        ),
      ).rejects.toThrow(
        "Only organization owners and admins can manage subscriptions",
      );
    });

    it("maps the organization_not_found kind to FORBIDDEN even when the message is reworded", async () => {
      updateOrganizationSubscriptionSeatsMock.mockRejectedValue(
        new MockCoreApiRequestError("We could not find that organization", {
          kind: "organization_not_found",
          status: 404,
        }),
      );

      const { organizationSubscriptionService } = await import(
        "../organization-subscription.service"
      );

      await expect(
        organizationSubscriptionService.updateOrganizationSeatsImmediately(
          "user-1",
          "org-1",
          3,
        ),
      ).rejects.toThrow(
        "Only organization owners and admins can manage subscriptions",
      );
    });

    it("keeps core's message when no active subscription exists", async () => {
      updateOrganizationSubscriptionSeatsMock.mockRejectedValue(
        new MockCoreApiRequestError(
          "An active organization subscription is required before updating seats.",
          { status: 400 },
        ),
      );

      const { organizationSubscriptionService } = await import(
        "../organization-subscription.service"
      );

      await expect(
        organizationSubscriptionService.updateOrganizationSeatsImmediately(
          "user-1",
          "org-1",
          3,
        ),
      ).rejects.toThrow(
        "An active organization subscription is required before updating seats.",
      );
    });

    it("keeps core's message when decreasing seats below assigned count", async () => {
      updateOrganizationSubscriptionSeatsMock.mockRejectedValue(
        new MockCoreApiRequestError(
          "Purchased seats (3) must be at least 4 to cover all assigned members",
          { status: 400 },
        ),
      );

      const { organizationSubscriptionService } = await import(
        "../organization-subscription.service"
      );

      await expect(
        organizationSubscriptionService.updateOrganizationSeatsImmediately(
          "user-1",
          "org-1",
          3,
        ),
      ).rejects.toThrow(
        "Purchased seats (3) must be at least 4 to cover all assigned members",
      );
    });

    it("rethrows unexpected core errors unchanged", async () => {
      const coreError = new MockCoreApiRequestError(
        "Unable to update organization subscription seats: missing Stripe subscription item",
        { status: 500 },
      );
      updateOrganizationSubscriptionSeatsMock.mockRejectedValue(coreError);

      const { organizationSubscriptionService } = await import(
        "../organization-subscription.service"
      );

      await expect(
        organizationSubscriptionService.updateOrganizationSeatsImmediately(
          "user-1",
          "org-1",
          3,
        ),
      ).rejects.toBe(coreError);
    });
  });
});
