export {};

jest.mock("server-only", () => ({}));

const getMemberByUserIdAndOrganizationIdMock = jest.fn();
const getUserByIdMock = jest.fn();
const updatePreferredOrganizationIdMock = jest.fn();

jest.mock("@sokosumi/database/repositories", () => ({
  memberRepository: {
    getMemberByUserIdAndOrganizationId: (...args: unknown[]) =>
      getMemberByUserIdAndOrganizationIdMock(...args),
  },
  userRepository: {
    getUserById: (...args: unknown[]) => getUserByIdMock(...args),
    updatePreferredOrganizationId: (...args: unknown[]) =>
      updatePreferredOrganizationIdMock(...args),
  },
}));

const mockPrisma = {} as {
  $transaction: (callback: (tx: unknown) => unknown) => Promise<unknown>;
};
mockPrisma.$transaction = (callback) => Promise.resolve(callback(mockPrisma));
jest.mock("@/lib/db/prisma", () => ({
  __esModule: true,
  default: mockPrisma,
}));

describe("preferredOrganizationService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("resolves the preferred organization for a new session when membership is still valid", async () => {
    getUserByIdMock.mockResolvedValue({
      id: "user-1",
      preferredOrganizationId: "org-1",
    });
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({
      id: "member-1",
    });

    const { preferredOrganizationService } =
      await import("../preferred-organization.service");
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

    const { preferredOrganizationService } =
      await import("../preferred-organization.service");
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

    const { preferredOrganizationService } =
      await import("../preferred-organization.service");
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

  it("persists a personal workspace preference without checking membership", async () => {
    updatePreferredOrganizationIdMock.mockResolvedValue({
      id: "user-1",
      preferredOrganizationId: null,
    });

    const { preferredOrganizationService } =
      await import("../preferred-organization.service");
    const result =
      await preferredOrganizationService.persistPreferredOrganizationId(
        "user-1",
        null,
      );

    expect(result).toEqual({
      ok: true,
      organizationId: null,
    });
    expect(getMemberByUserIdAndOrganizationIdMock).not.toHaveBeenCalled();
    expect(updatePreferredOrganizationIdMock).toHaveBeenCalledWith(
      "user-1",
      null,
      mockPrisma,
    );
  });

  it("persists an organization preference when the user is a member", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({
      id: "member-1",
    });
    updatePreferredOrganizationIdMock.mockResolvedValue({
      id: "user-1",
      preferredOrganizationId: "org-1",
    });

    const { preferredOrganizationService } =
      await import("../preferred-organization.service");
    const result =
      await preferredOrganizationService.persistPreferredOrganizationId(
        "user-1",
        "org-1",
      );

    expect(result).toEqual({
      ok: true,
      organizationId: "org-1",
    });
    expect(getMemberByUserIdAndOrganizationIdMock).toHaveBeenCalledWith(
      "user-1",
      "org-1",
      mockPrisma,
    );
    expect(updatePreferredOrganizationIdMock).toHaveBeenCalledWith(
      "user-1",
      "org-1",
      mockPrisma,
    );
  });

  it("rejects persisting an organization preference when the user is not a member", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue(null);

    const { preferredOrganizationService } =
      await import("../preferred-organization.service");
    const result =
      await preferredOrganizationService.persistPreferredOrganizationId(
        "user-1",
        "org-1",
      );

    expect(result).toEqual({
      ok: false,
      organizationId: null,
    });
    expect(updatePreferredOrganizationIdMock).not.toHaveBeenCalled();
  });
});
