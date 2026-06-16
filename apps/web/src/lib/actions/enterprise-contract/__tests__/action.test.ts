import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

export {};

const listContractsMock = vi.fn();
const toCoreApiActionErrorMock = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSessionOrRedirect: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
}));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    (handler: (params: unknown) => Promise<unknown>) =>
    async (params: unknown) =>
      await handler(params),
}));

vi.mock("@/lib/clients/core.client", () => ({
  toCoreApiActionError: (...args: unknown[]) =>
    toCoreApiActionErrorMock(...args),
}));

vi.mock("@/lib/services/enterprise-contract-admin.service", () => ({
  enterpriseContractAdminService: {
    listContracts: (...args: unknown[]) => listContractsMock(...args),
  },
  parseEnterpriseContractActivationBlockedError: vi.fn(() => null),
}));

describe("enterprise contract actions", () => {
  const adminSession = {
    user: {
      id: "admin-1",
      role: "admin",
    },
  } as never;

  const memberSession = {
    user: {
      id: "user-1",
      role: "user",
    },
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    toCoreApiActionErrorMock.mockImplementation((error: unknown) => ({
      code: "INTERNAL_SERVER_ERROR",
      message: error instanceof Error ? error.message : "Unexpected error",
    }));
  });

  it("returns UNAUTHORIZED when a signed-in non-admin invokes list action", async () => {
    const { listEnterpriseContractsAction } = await import("../action");
    const { CommonErrorCode } = await import("@/lib/actions/errors");

    const result = await listEnterpriseContractsAction({
      session: memberSession,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected error result");
    }

    expect(result.error.code).toBe(CommonErrorCode.UNAUTHORIZED);
    expect(result.error.message).toBe("Admin access required");
    expect(listContractsMock).not.toHaveBeenCalled();
    expect(toCoreApiActionErrorMock).not.toHaveBeenCalled();
  });

  it("lists contracts for admin sessions", async () => {
    listContractsMock.mockResolvedValue([{ id: "contract-1" }]);

    const { listEnterpriseContractsAction } = await import("../action");

    const result = await listEnterpriseContractsAction({
      session: adminSession,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected success result");
    }

    expect(result.data).toEqual([{ id: "contract-1" }]);
    expect(listContractsMock).toHaveBeenCalledOnce();
  });
});
