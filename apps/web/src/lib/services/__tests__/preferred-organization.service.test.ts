import { beforeEach, describe, expect, it, vi } from "vitest";

export {};

vi.mock("server-only", () => ({}));

const getMemberByUserIdAndOrganizationIdMock = vi.fn();
const getUserByIdMock = vi.fn();
const setMyPreferredOrganizationMock = vi.fn();

vi.mock("@sokosumi/database/repositories", () => ({
  memberRepository: {
    getMemberByUserIdAndOrganizationId: (...args: unknown[]) =>
      getMemberByUserIdAndOrganizationIdMock(...args),
  },
  userRepository: {
    getUserById: (...args: unknown[]) => getUserByIdMock(...args),
  },
}));

const mockPrisma = {};
vi.mock("@/lib/db/prisma", () => ({
  __esModule: true,
  default: mockPrisma,
}));

vi.mock("@/lib/clients/core.client", () => {
  class CoreApiRequestError extends Error {
    details?: unknown;
    status?: number;
    kind?: string;

    constructor(
      message: string,
      options?: { details?: unknown; status?: number; kind?: string },
    ) {
      super(message);
      this.name = "CoreApiRequestError";
      this.details = options?.details;
      this.status = options?.status;
      this.kind = options?.kind;
    }
  }

  return {
    CoreApiRequestError,
    coreClient: {
      setMyPreferredOrganization: (...args: unknown[]) =>
        setMyPreferredOrganizationMock(...args),
    },
  };
});

describe("preferredOrganizationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the preferred organization for a new session when membership is still valid", async () => {
    getUserByIdMock.mockResolvedValue({
      id: "user-1",
      preferredOrganizationId: "org-1",
    });
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({
      id: "member-1",
    });

    const { preferredOrganizationService } = await import(
      "../preferred-organization.service"
    );
    const result =
      await preferredOrganizationService.resolveActiveOrganizationIdForSession(
        "user-1",
      );

    expect(result).toBe("org-1");
    expect(getUserByIdMock).toHaveBeenCalled();
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

    const { preferredOrganizationService } = await import(
      "../preferred-organization.service"
    );
    const result =
      await preferredOrganizationService.resolveActiveOrganizationIdForSession(
        "user-1",
      );

    expect(result).toBeNull();
    expect(getMemberByUserIdAndOrganizationIdMock).not.toHaveBeenCalled();
  });

  it("returns null for a stale preferred organization when membership was removed", async () => {
    getUserByIdMock.mockResolvedValue({
      id: "user-1",
      preferredOrganizationId: "org-1",
    });
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue(null);

    const { preferredOrganizationService } = await import(
      "../preferred-organization.service"
    );
    const result =
      await preferredOrganizationService.resolveActiveOrganizationIdForSession(
        "user-1",
      );

    expect(result).toBeNull();
    expect(getMemberByUserIdAndOrganizationIdMock).toHaveBeenCalledWith(
      "user-1",
      "org-1",
      mockPrisma,
    );
  });

  it("persists a personal workspace preference via core", async () => {
    setMyPreferredOrganizationMock.mockResolvedValue({
      data: { organizationId: null },
    });

    const { preferredOrganizationService } = await import(
      "../preferred-organization.service"
    );
    const result =
      await preferredOrganizationService.persistPreferredOrganizationId(null);

    expect(result).toEqual({
      ok: true,
      organizationId: null,
    });
    expect(setMyPreferredOrganizationMock).toHaveBeenCalledWith(null);
  });

  it("persists an organization preference via core", async () => {
    setMyPreferredOrganizationMock.mockResolvedValue({
      data: { organizationId: "org-1" },
    });

    const { preferredOrganizationService } = await import(
      "../preferred-organization.service"
    );
    const result =
      await preferredOrganizationService.persistPreferredOrganizationId(
        "org-1",
      );

    expect(result).toEqual({
      ok: true,
      organizationId: "org-1",
    });
    expect(setMyPreferredOrganizationMock).toHaveBeenCalledWith("org-1");
  });

  it("rejects persisting when core reports a missing membership", async () => {
    const { CoreApiRequestError } = await import("@/lib/clients/core.client");
    setMyPreferredOrganizationMock.mockRejectedValue(
      new CoreApiRequestError("Forbidden", {
        status: 403,
        kind: "organization_membership_required",
      }),
    );

    const { preferredOrganizationService } = await import(
      "../preferred-organization.service"
    );
    const result =
      await preferredOrganizationService.persistPreferredOrganizationId(
        "org-1",
      );

    expect(result).toEqual({
      ok: false,
      organizationId: null,
    });
  });

  it("rethrows unexpected core errors", async () => {
    const { CoreApiRequestError } = await import("@/lib/clients/core.client");
    setMyPreferredOrganizationMock.mockRejectedValue(
      new CoreApiRequestError("Internal Server Error", { status: 500 }),
    );

    const { preferredOrganizationService } = await import(
      "../preferred-organization.service"
    );

    await expect(
      preferredOrganizationService.persistPreferredOrganizationId("org-1"),
    ).rejects.toThrow("Internal Server Error");
  });
});
