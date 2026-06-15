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
    updateOrganizationSubscriptionSeatsMock.mockRejectedValue(
      new MockCoreApiRequestError(
        "Self-serve subscriptions are not available.",
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
        message: "Self-serve subscriptions are not available.",
      },
      ok: false,
    });
  });

  it("maps unauthorized immediate seat update errors", async () => {
    updateOrganizationSubscriptionSeatsMock.mockRejectedValue(
      new MockCoreApiRequestError("You must be owner, admin", {
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

  it("maps missing organization to unauthorized seat update errors", async () => {
    updateOrganizationSubscriptionSeatsMock.mockRejectedValue(
      new MockCoreApiRequestError("Organization not found", {
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

  it("maps bad request immediate seat update errors", async () => {
    updateOrganizationSubscriptionSeatsMock.mockRejectedValue(
      new MockCoreApiRequestError(
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
