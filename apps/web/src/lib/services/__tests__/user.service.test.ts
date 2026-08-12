import type { Session } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

export {};

vi.mock("server-only", () => ({}));

const getSessionMock = vi.fn();
const getMyMembersWithOrganizationsMock = vi.fn();
const getMyMemberInOrganizationMock = vi.fn();
const getOrganizationByIdMock = vi.fn();
const updateCurrentUserViaCoreMock = vi.fn();

vi.mock("@/lib/clients/core.client", () => {
  class CoreApiRequestError extends Error {
    details?: unknown;
    status?: number;

    constructor(
      message: string,
      options?: { details?: unknown; status?: number },
    ) {
      super(message);
      this.name = "CoreApiRequestError";
      this.details = options?.details;
      this.status = options?.status;
    }
  }

  return {
    CoreApiRequestError,
    coreClient: {
      getMyMembersWithOrganizations: (...args: unknown[]) =>
        getMyMembersWithOrganizationsMock(...args),
      getMyMemberInOrganization: (...args: unknown[]) =>
        getMyMemberInOrganizationMock(...args),
      getOrganizationById: (...args: unknown[]) =>
        getOrganizationByIdMock(...args),
    },
  };
});

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("@/lib/auth/core-auth-http.server", () => ({
  updateCurrentUserViaCore: (...args: unknown[]) =>
    updateCurrentUserViaCoreMock(...args),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

describe("user.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getActiveOrganization", () => {
    it("returns the organization from Core for the active organization id", async () => {
      getSessionMock.mockResolvedValue({
        session: { activeOrganizationId: "org-1" },
        user: { id: "user-1" },
      });
      const organization = { id: "org-1", name: "Org", slug: "org" };
      getOrganizationByIdMock.mockResolvedValue({ data: organization });

      const { userService } = await import("../user.service");
      const result = await userService.getActiveOrganization();

      expect(getOrganizationByIdMock).toHaveBeenCalledWith("org-1");
      expect(result).toEqual(organization);
    });

    it("returns null when there is no session", async () => {
      getSessionMock.mockResolvedValue(null);

      const { userService } = await import("../user.service");
      const result = await userService.getActiveOrganization();

      expect(getOrganizationByIdMock).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it("returns null when the session has no active organization", async () => {
      getSessionMock.mockResolvedValue({
        session: { activeOrganizationId: null },
        user: { id: "user-1" },
      });

      const { userService } = await import("../user.service");
      const result = await userService.getActiveOrganization();

      expect(getOrganizationByIdMock).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it("returns null when Core does not know the organization (404 -> null)", async () => {
      getSessionMock.mockResolvedValue({
        session: { activeOrganizationId: "org-gone" },
        user: { id: "user-1" },
      });
      getOrganizationByIdMock.mockResolvedValue(null);

      const { userService } = await import("../user.service");
      const result = await userService.getActiveOrganization();

      expect(result).toBeNull();
    });

    it("returns null when the user is no longer a member (Core 403)", async () => {
      const { CoreApiRequestError } = await import("@/lib/clients/core.client");
      getSessionMock.mockResolvedValue({
        session: { activeOrganizationId: "org-stale" },
        user: { id: "user-1" },
      });
      getOrganizationByIdMock.mockRejectedValue(
        new CoreApiRequestError("Forbidden", { status: 403 }),
      );

      const { userService } = await import("../user.service");
      const result = await userService.getActiveOrganization();

      expect(result).toBeNull();
    });

    it("rethrows unexpected Core errors", async () => {
      const { CoreApiRequestError } = await import("@/lib/clients/core.client");
      getSessionMock.mockResolvedValue({
        session: { activeOrganizationId: "org-1" },
        user: { id: "user-1" },
      });
      getOrganizationByIdMock.mockRejectedValue(
        new CoreApiRequestError("Boom", { status: 500 }),
      );

      const { userService } = await import("../user.service");

      await expect(userService.getActiveOrganization()).rejects.toThrow("Boom");
    });
  });

  describe("getMyMembersWithOrganizations", () => {
    it("returns the memberships from Core for the session user", async () => {
      getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
      const members = [
        { id: "member-1", organizationId: "org-1", role: "owner" },
      ];
      getMyMembersWithOrganizationsMock.mockResolvedValue({ data: members });

      const { userService } = await import("../user.service");
      const result = await userService.getMyMembersWithOrganizations();

      expect(getMyMembersWithOrganizationsMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual(members);
    });

    it("returns an empty array when there is no session", async () => {
      getSessionMock.mockResolvedValue(null);

      const { userService } = await import("../user.service");
      const result = await userService.getMyMembersWithOrganizations();

      expect(getMyMembersWithOrganizationsMock).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe("getMyMemberInOrganization", () => {
    it("returns the membership record from Core", async () => {
      getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
      const member = { id: "member-1", organizationId: "org-1", role: "admin" };
      getMyMemberInOrganizationMock.mockResolvedValue({ data: member });

      const { userService } = await import("../user.service");
      const result = await userService.getMyMemberInOrganization("org-1");

      expect(getMyMemberInOrganizationMock).toHaveBeenCalledWith("org-1");
      expect(result).toEqual(member);
    });

    it("returns null when Core reports the user is not a member", async () => {
      getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
      getMyMemberInOrganizationMock.mockResolvedValue(null);

      const { userService } = await import("../user.service");
      const result = await userService.getMyMemberInOrganization("org-1");

      expect(result).toBeNull();
    });

    it("returns null when there is no session", async () => {
      getSessionMock.mockResolvedValue(null);

      const { userService } = await import("../user.service");
      const result = await userService.getMyMemberInOrganization("org-1");

      expect(getMyMemberInOrganizationMock).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  describe("showOnboarding", () => {
    // Minimal session double narrowed to the fields showOnboarding reads.
    const session = {
      session: { id: "session-1" },
      user: { id: "user-1", onboardingCompleted: false },
    } as Session;

    it("returns false when onboarding is already completed", async () => {
      const { userService } = await import("../user.service");
      const result = await userService.showOnboarding({
        ...session,
        user: { id: "user-1", onboardingCompleted: true },
      } as Session);

      expect(getMyMembersWithOrganizationsMock).not.toHaveBeenCalled();
      expect(updateCurrentUserViaCoreMock).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it("returns true when onboarding is incomplete, even if the user already has a membership", async () => {
      // Invite-join and create-organization both produce memberships before the
      // profile/plan steps finish. Membership must not auto-complete.
      const { userService } = await import("../user.service");
      const result = await userService.showOnboarding(session);

      expect(getMyMembersWithOrganizationsMock).not.toHaveBeenCalled();
      expect(updateCurrentUserViaCoreMock).not.toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it("returns false when there is no session or user", async () => {
      const { userService } = await import("../user.service");

      expect(await userService.showOnboarding(null as unknown as Session)).toBe(
        false,
      );
      expect(
        await userService.showOnboarding({
          session: { id: "session-1" },
        } as Session),
      ).toBe(false);
    });
  });
});
