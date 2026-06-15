import { beforeEach, describe, expect, it, vi } from "vitest";

export {};

vi.mock("server-only", () => ({}));

const updateOrganizationSeatsImmediatelyMock = vi.fn();

vi.mock("@/lib/services", () => ({
  organizationSubscriptionService: {
    updateOrganizationSeatsImmediately: updateOrganizationSeatsImmediatelyMock,
  },
}));

vi.mock("@sokosumi/database/helpers", () => ({
  OrganizationSubscriptionExclusivityError: class OrganizationSubscriptionExclusivityError extends Error {},
}));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    (handler: (params: unknown) => Promise<unknown>) =>
    async (params: unknown) =>
      await handler(params),
}));

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

  it("maps organization subscription exclusivity errors from the seat update", async () => {
    const { OrganizationSubscriptionExclusivityError } = await import(
      "@sokosumi/database/helpers"
    );
    updateOrganizationSeatsImmediatelyMock.mockRejectedValue(
      new OrganizationSubscriptionExclusivityError(
        "Self-serve subscriptions are not available.",
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
        message: "Self-serve subscriptions are not available.",
      },
      ok: false,
    });
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
