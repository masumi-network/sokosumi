import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  approveHermesConfirmationMock,
  MockCoreApiRequestError,
  toCoreApiActionErrorMock,
} = vi.hoisted(() => {
  class MockCoreApiRequestError extends Error {
    status?: number;

    constructor(message: string, options?: { status?: number }) {
      super(message);
      this.name = "CoreApiRequestError";
      this.status = options?.status;
    }
  }

  return {
    approveHermesConfirmationMock: vi.fn(),
    MockCoreApiRequestError,
    toCoreApiActionErrorMock: vi.fn(),
  };
});

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    <TParams extends Record<string, unknown>, TResult>(
      handler: (params: TParams) => Promise<TResult>,
    ) =>
    async (params: TParams) =>
      await handler({
        ...params,
        session: {
          user: { id: "user-1", email: "ada@example.com" },
          session: { activeOrganizationId: null },
        },
      } as TParams),
}));

vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError: MockCoreApiRequestError,
  coreClient: {
    approveHermesConfirmation: (...args: unknown[]) =>
      approveHermesConfirmationMock(...args),
  },
  toCoreApiActionError: (...args: unknown[]) =>
    toCoreApiActionErrorMock(...args),
}));

import { approveHermesConfirmationAction } from "@/lib/actions/hermes";

describe("approveHermesConfirmationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    approveHermesConfirmationMock.mockResolvedValue({
      data: {
        status: "approved",
        result: null,
        error: null,
      },
    });
  });

  it("forwards the organization override used by task and job confirmations", async () => {
    const result = await approveHermesConfirmationAction({
      confirmationId: "conf_1",
      organizationId: "org-1",
    });

    expect(result.ok).toBe(true);
    expect(approveHermesConfirmationMock).toHaveBeenCalledWith("conf_1", {
      overrides: { organizationId: "org-1" },
    });
  });

  it("forwards explicit personal scope", async () => {
    const result = await approveHermesConfirmationAction({
      confirmationId: "conf_1",
      organizationId: null,
    });

    expect(result.ok).toBe(true);
    expect(approveHermesConfirmationMock).toHaveBeenCalledWith("conf_1", {
      overrides: { organizationId: null },
    });
  });

  it("omits overrides when organizationId is not provided", async () => {
    const result = await approveHermesConfirmationAction({
      confirmationId: "conf_1",
    });

    expect(result.ok).toBe(true);
    expect(approveHermesConfirmationMock).toHaveBeenCalledWith(
      "conf_1",
      undefined,
    );
  });
});
