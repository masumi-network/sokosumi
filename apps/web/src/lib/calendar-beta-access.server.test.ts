import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getMyMembersWithOrganizationsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/services", () => ({
  userService: {
    getMyMembersWithOrganizations: getMyMembersWithOrganizationsMock,
  },
}));

describe("hasCurrentUserCalendarBetaAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("allows any membership in the utxo AG workspace", async () => {
    getMyMembersWithOrganizationsMock.mockResolvedValue([
      { organization: { slug: "other" } },
      { organization: { slug: "utxo" } },
    ]);

    const { hasCurrentUserCalendarBetaAccess } = await import(
      "./calendar-beta-access.server"
    );

    await expect(hasCurrentUserCalendarBetaAccess()).resolves.toBe(true);
  });

  it("fails closed when memberships cannot be loaded", async () => {
    getMyMembersWithOrganizationsMock.mockRejectedValue(
      new Error("Core unavailable"),
    );

    const { hasCurrentUserCalendarBetaAccess } = await import(
      "./calendar-beta-access.server"
    );

    await expect(hasCurrentUserCalendarBetaAccess()).resolves.toBe(false);
  });
});
