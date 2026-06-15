import { beforeEach, describe, expect, it, vi } from "vitest";

export {};

vi.mock("server-only", () => ({}));

const updateOrganizationSubscriptionSeatsMock = vi.fn();
const getEnvSecretsMock = vi.fn();

vi.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => getEnvSecretsMock(),
}));

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => ({
    NEXT_PUBLIC_NETWORK: "mainnet",
  }),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@/lib/services", () => ({
  userService: {},
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
    getEnvSecretsMock.mockReturnValue({
      CORE_APP_BASE_URL: "https://core.example.com",
    });
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
  });

  it("maps enterprise exclusivity errors from core seat updates", async () => {
    const { CoreApiRequestError } = await import("@/lib/clients/core.client");
    updateOrganizationSubscriptionSeatsMock.mockRejectedValue(
      new CoreApiRequestError("Self-serve subscriptions are not available.", {
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

  it("maps organization_role_forbidden to owner/admin copy", async () => {
    const { CoreApiRequestError } = await import("@/lib/clients/core.client");
    updateOrganizationSubscriptionSeatsMock.mockRejectedValue(
      new CoreApiRequestError("You must be OWNER, ADMIN", {
        kind: "organization_role_forbidden",
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
        kind: "organization_membership_required",
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
        kind: "organization_not_found",
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

  it("maps bad request immediate seat update errors", async () => {
    const { CoreApiRequestError } = await import("@/lib/clients/core.client");
    updateOrganizationSubscriptionSeatsMock.mockRejectedValue(
      new CoreApiRequestError(
        "An active organization subscription is required before updating seats.",
        { status: 400 },
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
