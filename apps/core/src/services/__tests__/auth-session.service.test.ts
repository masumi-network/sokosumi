import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserByIdMock = vi.fn();
const getMemberByUserIdAndOrganizationIdMock = vi.fn();
const updateCustomerEmailMock = vi.fn();

vi.mock("@sokosumi/database/repositories", () => ({
  memberRepository: {
    getMemberByUserIdAndOrganizationId: (...args: unknown[]) =>
      getMemberByUserIdAndOrganizationIdMock(...args),
  },
  userRepository: {
    getUserById: (...args: unknown[]) => getUserByIdMock(...args),
  },
}));

vi.mock("@/clients/stripe.client", () => ({
  stripeClient: {
    updateCustomerEmail: (...args: unknown[]) =>
      updateCustomerEmailMock(...args),
  },
}));

const mockPrisma = {};
vi.mock("@/lib/db/prisma", () => ({
  __esModule: true,
  default: mockPrisma,
}));

describe("authSessionService.resolveActiveOrganizationIdForSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the preferred organization when membership is still valid", async () => {
    getUserByIdMock.mockResolvedValue({
      id: "user-1",
      preferredOrganizationId: "org-1",
    });
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({
      id: "member-1",
    });

    const { authSessionService } = await import("../auth-session.service");
    const result =
      await authSessionService.resolveActiveOrganizationIdForSession("user-1");

    expect(result).toBe("org-1");
    expect(getMemberByUserIdAndOrganizationIdMock).toHaveBeenCalledWith(
      "user-1",
      "org-1",
      mockPrisma,
    );
  });

  it("returns null when there is no stored preferred organization", async () => {
    getUserByIdMock.mockResolvedValue({
      id: "user-1",
      preferredOrganizationId: null,
    });

    const { authSessionService } = await import("../auth-session.service");
    const result =
      await authSessionService.resolveActiveOrganizationIdForSession("user-1");

    expect(result).toBeNull();
    expect(getMemberByUserIdAndOrganizationIdMock).not.toHaveBeenCalled();
  });

  it("returns null for a stale preference when membership was removed", async () => {
    getUserByIdMock.mockResolvedValue({
      id: "user-1",
      preferredOrganizationId: "org-1",
    });
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue(null);

    const { authSessionService } = await import("../auth-session.service");
    const result =
      await authSessionService.resolveActiveOrganizationIdForSession("user-1");

    expect(result).toBeNull();
  });
});

describe("authSessionService.syncUserEmailWithStripe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates the Stripe customer email from the local user record", async () => {
    getUserByIdMock.mockResolvedValue({
      id: "user-1",
      stripeCustomerId: "cus_user",
    });
    updateCustomerEmailMock.mockResolvedValue({});

    const { authSessionService } = await import("../auth-session.service");
    const result = await authSessionService.syncUserEmailWithStripe(
      "user-1",
      "new@example.com",
    );

    expect(result).toBe(true);
    expect(updateCustomerEmailMock).toHaveBeenCalledWith(
      "cus_user",
      "new@example.com",
    );
  });

  it("returns true without a Stripe call when the user has no customer", async () => {
    getUserByIdMock.mockResolvedValue({
      id: "user-1",
      stripeCustomerId: null,
    });

    const { authSessionService } = await import("../auth-session.service");
    const result = await authSessionService.syncUserEmailWithStripe(
      "user-1",
      "new@example.com",
    );

    expect(result).toBe(true);
    expect(updateCustomerEmailMock).not.toHaveBeenCalled();
  });

  it("returns false when the Stripe update fails", async () => {
    getUserByIdMock.mockResolvedValue({
      id: "user-1",
      stripeCustomerId: "cus_user",
    });
    updateCustomerEmailMock.mockRejectedValue(new Error("stripe down"));

    const { authSessionService } = await import("../auth-session.service");
    const result = await authSessionService.syncUserEmailWithStripe(
      "user-1",
      "new@example.com",
    );

    expect(result).toBe(false);
  });
});
