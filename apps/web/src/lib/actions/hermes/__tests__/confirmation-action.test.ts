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

const SAMPLE_CONFIRMATION = {
  id: "conf_1",
  toolName: "sokosumi_create_task",
  summary: "Create task 'Weekly report'.",
  createdAt: "2026-07-17T12:00:00.000Z",
  referencedCoworkers: [],
  referencedOrganizations: [],
  organizationId: "org-1" as string | null,
  organizationName: "Org One" as string | null,
};

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
      confirmation: SAMPLE_CONFIRMATION,
    });

    expect(result.ok).toBe(true);
    expect(approveHermesConfirmationMock).toHaveBeenCalledWith("conf_1", {
      overrides: { organizationId: "org-1" },
      confirmation: {
        ...SAMPLE_CONFIRMATION,
        createdAt: new Date(SAMPLE_CONFIRMATION.createdAt),
      },
    });
  });

  it("forwards explicit personal scope", async () => {
    const result = await approveHermesConfirmationAction({
      confirmationId: "conf_1",
      organizationId: null,
      confirmation: SAMPLE_CONFIRMATION,
    });

    expect(result.ok).toBe(true);
    expect(approveHermesConfirmationMock).toHaveBeenCalledWith("conf_1", {
      overrides: { organizationId: null },
      confirmation: {
        ...SAMPLE_CONFIRMATION,
        createdAt: new Date(SAMPLE_CONFIRMATION.createdAt),
      },
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

  it("forwards the confirmation audit snapshot without overrides", async () => {
    const result = await approveHermesConfirmationAction({
      confirmationId: "conf_1",
      confirmation: SAMPLE_CONFIRMATION,
    });

    expect(result.ok).toBe(true);
    expect(approveHermesConfirmationMock).toHaveBeenCalledWith("conf_1", {
      confirmation: {
        ...SAMPLE_CONFIRMATION,
        createdAt: new Date(SAMPLE_CONFIRMATION.createdAt),
      },
    });
  });
});
