import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getMyMembersWithOrganizationsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/services/user.service", () => ({
  userService: {
    getMyMembersWithOrganizations: getMyMembersWithOrganizationsMock,
  },
}));

describe("hasCurrentUserSocialBetaAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("allows any membership in the utxo AG workspace", async () => {
    getMyMembersWithOrganizationsMock.mockResolvedValue([
      { organization: { slug: "other" } },
      { organization: { slug: "utxo" } },
    ]);

    const { hasCurrentUserSocialBetaAccess } = await import(
      "./social-beta-access.server"
    );

    await expect(hasCurrentUserSocialBetaAccess()).resolves.toBe(true);
  });

  it("fails closed when memberships cannot be loaded", async () => {
    getMyMembersWithOrganizationsMock.mockRejectedValue(
      new Error("Core unavailable"),
    );

    const { hasCurrentUserSocialBetaAccess } = await import(
      "./social-beta-access.server"
    );

    await expect(hasCurrentUserSocialBetaAccess()).resolves.toBe(false);
  });
});
