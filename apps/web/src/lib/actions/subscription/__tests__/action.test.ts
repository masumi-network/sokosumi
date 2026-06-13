import { beforeEach, describe, expect, it, vi } from "vitest";

export {};

vi.mock("server-only", () => ({}));

const clearSubscriptionOnboardingGateSessionCookieMock = vi.fn();
const updateOrganizationSeatsImmediatelyMock = vi.fn();
const assertOrganizationSubscriptionChangeAllowedMock = vi.fn();
const assertPersonalSubscriptionChangeAllowedMock = vi.fn();

vi.mock("@/lib/actions/onboarding", () => ({
  clearSubscriptionOnboardingGateSessionCookie:
    clearSubscriptionOnboardingGateSessionCookieMock,
}));

vi.mock("@/lib/services", () => ({
  organizationSubscriptionService: {
    updateOrganizationSeatsImmediately: updateOrganizationSeatsImmediatelyMock,
  },
}));

vi.mock("@sokosumi/database/helpers", () => ({
  assertOrganizationSubscriptionChangeAllowed:
    assertOrganizationSubscriptionChangeAllowedMock,
  assertPersonalSubscriptionChangeAllowed:
    assertPersonalSubscriptionChangeAllowedMock,
  OrganizationSubscriptionExclusivityError: class OrganizationSubscriptionExclusivityError extends Error {},
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {},
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
  session: {
    activeOrganizationId: null,
  },
} as never;

const organizationSession = {
  user: {
    id: "user-1",
  },
  session: {
    activeOrganizationId: "org-1",
  },
} as never;

describe("subscription actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertOrganizationSubscriptionChangeAllowedMock.mockResolvedValue(
      undefined,
    );
    assertPersonalSubscriptionChangeAllowedMock.mockResolvedValue(undefined);
  });

  it("returns BAD_INPUT for invalid personal checkout plan names", async () => {
    const { CommonErrorCode } = await import("@/lib/actions/errors");
    const { validatePersonalSubscriptionChange } = await import("../action");

    const result = await validatePersonalSubscriptionChange({
      session,
      plan: "invalid-plan" as never,
    });

    expect(result).toEqual({
      error: {
        code: CommonErrorCode.BAD_INPUT,
      },
      ok: false,
    });
    expect(assertPersonalSubscriptionChangeAllowedMock).not.toHaveBeenCalled();
  });

  it("runs personal prisma guard without clearing onboarding cookie for checkout validation", async () => {
    const { validatePersonalSubscriptionChange } = await import("../action");

    const result = await validatePersonalSubscriptionChange({
      session,
      plan: "starter",
      returnPath: "/billing?tab=subscription",
    });

    expect(result).toEqual({
      data: undefined,
      ok: true,
    });
    expect(assertPersonalSubscriptionChangeAllowedMock).toHaveBeenCalledWith(
      "user-1",
      {},
    );
    // The onboarding gate is cleared client-side only after the checkout call
    // succeeds, never during validation.
    expect(
      clearSubscriptionOnboardingGateSessionCookieMock,
    ).not.toHaveBeenCalled();
  });

  it("runs personal prisma guard without clearing onboarding cookie for portal validation", async () => {
    const { validatePersonalSubscriptionChange } = await import("../action");

    const result = await validatePersonalSubscriptionChange({
      session,
      returnPath: "/billing?tab=coupon",
    });

    expect(result).toEqual({
      data: undefined,
      ok: true,
    });
    expect(assertPersonalSubscriptionChangeAllowedMock).toHaveBeenCalledWith(
      "user-1",
      {},
    );
    expect(
      clearSubscriptionOnboardingGateSessionCookieMock,
    ).not.toHaveBeenCalled();
  });

  it("maps organization subscription exclusivity errors", async () => {
    const { OrganizationSubscriptionExclusivityError } = await import(
      "@sokosumi/database/helpers"
    );
    assertPersonalSubscriptionChangeAllowedMock.mockRejectedValue(
      new OrganizationSubscriptionExclusivityError(
        "Personal subscription blocked",
      ),
    );

    const { CommonErrorCode } = await import("@/lib/actions/errors");
    const { validatePersonalSubscriptionChange } = await import("../action");

    const result = await validatePersonalSubscriptionChange({
      session,
      plan: "pro",
    });

    expect(result).toEqual({
      error: {
        code: CommonErrorCode.BAD_INPUT,
        message: "Personal subscription blocked",
      },
      ok: false,
    });
  });

  it("returns BAD_INPUT for invalid organization checkout seats", async () => {
    const { CommonErrorCode } = await import("@/lib/actions/errors");
    const { validateOrganizationSubscriptionChange } = await import(
      "../action"
    );

    const result = await validateOrganizationSubscriptionChange({
      session: organizationSession,
      organizationId: "org-1",
      plan: "starter",
      returnPath: "/organizations/org-1",
      seats: 0,
    });

    expect(result).toEqual({
      error: {
        code: CommonErrorCode.BAD_INPUT,
      },
      ok: false,
    });
    expect(
      assertOrganizationSubscriptionChangeAllowedMock,
    ).not.toHaveBeenCalled();
  });

  it("runs organization prisma guard without clearing onboarding cookie for checkout validation", async () => {
    const { validateOrganizationSubscriptionChange } = await import(
      "../action"
    );

    const result = await validateOrganizationSubscriptionChange({
      session: organizationSession,
      organizationId: "org-1",
      plan: "pro",
      returnPath: "/organizations/acme",
      seats: 7,
    });

    expect(result).toEqual({
      data: undefined,
      ok: true,
    });
    expect(
      assertOrganizationSubscriptionChangeAllowedMock,
    ).toHaveBeenCalledWith("org-1", {});
    // The onboarding gate is cleared client-side only after the checkout call
    // succeeds, never during validation.
    expect(
      clearSubscriptionOnboardingGateSessionCookieMock,
    ).not.toHaveBeenCalled();
  });

  it("runs organization prisma guard for billing portal validation", async () => {
    const { validateOrganizationSubscriptionChange } = await import(
      "../action"
    );

    const result = await validateOrganizationSubscriptionChange({
      session: organizationSession,
      organizationId: "org-1",
      returnPath: "/organizations/acme",
    });

    expect(result).toEqual({
      data: undefined,
      ok: true,
    });
    expect(
      assertOrganizationSubscriptionChangeAllowedMock,
    ).toHaveBeenCalledWith("org-1", {});
    expect(
      clearSubscriptionOnboardingGateSessionCookieMock,
    ).not.toHaveBeenCalled();
  });

  it("returns BAD_INPUT for invalid immediate organization seat update", async () => {
    const { CommonErrorCode } = await import("@/lib/actions/errors");
    const { updateOrganizationSubscriptionSeats } = await import("../action");

    const result = await updateOrganizationSubscriptionSeats({
      session: organizationSession,
      organizationId: "org-1",
      seats: 0,
    });

    expect(result).toEqual({
      error: {
        code: CommonErrorCode.BAD_INPUT,
      },
      ok: false,
    });
    expect(updateOrganizationSeatsImmediatelyMock).not.toHaveBeenCalled();
  });

  it("updates organization seats immediately without redirect flow", async () => {
    updateOrganizationSeatsImmediatelyMock.mockResolvedValue({
      seats: 9,
    });

    const { updateOrganizationSubscriptionSeats } = await import("../action");

    const result = await updateOrganizationSubscriptionSeats({
      session: organizationSession,
      organizationId: "org-1",
      seats: 9,
    });

    expect(result).toEqual({
      data: { seats: 9 },
      ok: true,
    });
    expect(updateOrganizationSeatsImmediatelyMock).toHaveBeenCalledWith(
      "user-1",
      "org-1",
      9,
    );
  });

  it("maps unauthorized immediate seat update errors", async () => {
    updateOrganizationSeatsImmediatelyMock.mockRejectedValue(
      Object.assign(
        new Error(
          "Only organization owners and admins can manage subscriptions",
        ),
        { status: "FORBIDDEN" },
      ),
    );

    const { CommonErrorCode } = await import("@/lib/actions/errors");
    const { updateOrganizationSubscriptionSeats } = await import("../action");

    const result = await updateOrganizationSubscriptionSeats({
      session: organizationSession,
      organizationId: "org-1",
      seats: 5,
    });

    expect(result).toEqual({
      error: {
        code: CommonErrorCode.UNAUTHORIZED,
        message: "Only organization owners and admins can manage subscriptions",
      },
      ok: false,
    });
  });

  it("maps bad request immediate seat update errors", async () => {
    updateOrganizationSeatsImmediatelyMock.mockRejectedValue(
      Object.assign(
        new Error(
          "An active organization subscription is required before updating seats.",
        ),
        { status: "BAD_REQUEST" },
      ),
    );

    const { CommonErrorCode } = await import("@/lib/actions/errors");
    const { updateOrganizationSubscriptionSeats } = await import("../action");

    const result = await updateOrganizationSubscriptionSeats({
      session: organizationSession,
      organizationId: "org-1",
      seats: 5,
    });

    expect(result).toEqual({
      error: {
        code: CommonErrorCode.BAD_INPUT,
        message:
          "An active organization subscription is required before updating seats.",
      },
      ok: false,
    });
  });
});
