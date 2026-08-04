import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

export {};

vi.mock("server-only", () => ({}));

const updateOrganizationSubscriptionSeatsMock = vi.fn();

vi.mock("@/lib/auth/subscription.server", () => ({
  upgradeOrganizationSubscriptionServer: vi.fn(),
  upgradePersonalSubscriptionServer: vi.fn(),
}));

vi.mock("@/lib/clients/core.client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/clients/core.client")>();

  return {
    ...actual,
    coreClient: {
      ...actual.coreClient,
      updateOrganizationSubscriptionSeats: (...args: unknown[]) =>
        updateOrganizationSubscriptionSeatsMock(...args),
    },
  };
});

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    (handler: (params: unknown) => Promise<unknown>) =>
    async (params: unknown) =>
      await handler(params),
}));

const invalidatePrivateSidebarChromeMock = vi.fn();

vi.mock("@/app/components/private-sidebar-cache", () => ({
  invalidatePrivateSidebarChrome: (...args: unknown[]) =>
    invalidatePrivateSidebarChromeMock(...args),
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
    expect(updateOrganizationSubscriptionSeatsMock).not.toHaveBeenCalled();
  });

  it("updates organization seats immediately via core", async () => {
    updateOrganizationSubscriptionSeatsMock.mockResolvedValue({
      data: { seats: 9 },
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
    expect(updateOrganizationSubscriptionSeatsMock).toHaveBeenCalledWith(
      "org-1",
      9,
    );
    expect(invalidatePrivateSidebarChromeMock).toHaveBeenCalledWith({
      userId: "user-1",
      organizationId: "org-1",
    });
  });

  it("maps enterprise exclusivity errors from core seat updates", async () => {
    const { CoreApiRequestError } = await import("@/lib/clients/core.client");
    updateOrganizationSubscriptionSeatsMock.mockRejectedValue(
      new CoreApiRequestError("Self-serve subscriptions are not available.", {
        kind: CORE_API_ERROR_KINDS.SUBSCRIPTION_CHANGE_NOT_ALLOWED,
        status: 400,
      }),
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

  it("maps seats below assigned members to bad input with core message", async () => {
    const { CoreApiRequestError } = await import("@/lib/clients/core.client");
    updateOrganizationSubscriptionSeatsMock.mockRejectedValue(
      new CoreApiRequestError(
        "Purchased seats (3) must be at least 4 to cover all assigned members",
        {
          kind: CORE_API_ERROR_KINDS.SUBSCRIPTION_SEATS_BELOW_ASSIGNED,
          status: 400,
        },
      ),
    );

    const { CommonErrorCode } = await import("@/lib/actions/errors");
    const { updateOrganizationSubscriptionSeats } = await import("../action");

    const result = await updateOrganizationSubscriptionSeats({
      session: organizationSession,
      organizationId: "org-1",
      seats: 3,
    });

    expect(result).toEqual({
      error: {
        code: CommonErrorCode.BAD_INPUT,
        message:
          "Purchased seats (3) must be at least 4 to cover all assigned members",
      },
      ok: false,
    });
  });

  it("maps organization_role_forbidden to owner/admin copy", async () => {
    const { CoreApiRequestError } = await import("@/lib/clients/core.client");
    updateOrganizationSubscriptionSeatsMock.mockRejectedValue(
      new CoreApiRequestError("You must be OWNER, ADMIN", {
        kind: CORE_API_ERROR_KINDS.ORGANIZATION_ROLE_FORBIDDEN,
        status: 403,
      }),
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

  it("maps organization_membership_required with core message", async () => {
    const { CoreApiRequestError } = await import("@/lib/clients/core.client");
    updateOrganizationSubscriptionSeatsMock.mockRejectedValue(
      new CoreApiRequestError("You are not a member of this organization", {
        kind: CORE_API_ERROR_KINDS.ORGANIZATION_MEMBERSHIP_REQUIRED,
        status: 403,
      }),
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
        message: "You are not a member of this organization",
      },
      ok: false,
    });
  });

  it("maps organization_not_found kind to owner/admin copy regardless of message", async () => {
    const { CoreApiRequestError } = await import("@/lib/clients/core.client");
    updateOrganizationSubscriptionSeatsMock.mockRejectedValue(
      new CoreApiRequestError("Some reworded organization error", {
        kind: CORE_API_ERROR_KINDS.ORGANIZATION_NOT_FOUND,
      }),
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

  it("maps legacy 404 responses without kind to owner/admin copy", async () => {
    const { CoreApiRequestError } = await import("@/lib/clients/core.client");
    updateOrganizationSubscriptionSeatsMock.mockRejectedValue(
      new CoreApiRequestError("Organization not found", {
        status: 404,
      }),
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

  it("maps unauthenticated core responses via toCoreApiActionError", async () => {
    const { CoreApiRequestError } = await import("@/lib/clients/core.client");
    updateOrganizationSubscriptionSeatsMock.mockRejectedValue(
      new CoreApiRequestError("Unauthorized", {
        status: 401,
      }),
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
        message: "Unauthorized",
      },
      ok: false,
    });
  });

  it("maps unexpected core errors as internal server errors", async () => {
    const { CoreApiRequestError } = await import("@/lib/clients/core.client");
    updateOrganizationSubscriptionSeatsMock.mockRejectedValue(
      new CoreApiRequestError("Unexpected core failure", {
        status: 500,
      }),
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
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
        message: "Unexpected core failure",
      },
      ok: false,
    });
  });

  it("maps missing active subscription to bad input with core message", async () => {
    const { CoreApiRequestError } = await import("@/lib/clients/core.client");
    updateOrganizationSubscriptionSeatsMock.mockRejectedValue(
      new CoreApiRequestError(
        "An active organization subscription is required before updating seats.",
        {
          kind: CORE_API_ERROR_KINDS.SUBSCRIPTION_NOT_ACTIVE,
          status: 400,
        },
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
