import { beforeEach, describe, expect, it, vi } from "vitest";

export {};

vi.mock("server-only", () => ({}));

const getSessionMock = vi.fn();
const getMyJobsMock = vi.fn();
const getMyMembersWithOrganizationsMock = vi.fn();
const getMyMemberInOrganizationMock = vi.fn();
const getOrganizationByIdMock = vi.fn();
const getOrganizationStripeCustomerMock = vi.fn();
const getOrganizationMembersMock = vi.fn();

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    getMyJobs: (...args: unknown[]) => getMyJobsMock(...args),
    getMyMembersWithOrganizations: (...args: unknown[]) =>
      getMyMembersWithOrganizationsMock(...args),
    getMyMemberInOrganization: (...args: unknown[]) =>
      getMyMemberInOrganizationMock(...args),
    getOrganizationById: (...args: unknown[]) =>
      getOrganizationByIdMock(...args),
    getOrganizationStripeCustomer: (...args: unknown[]) =>
      getOrganizationStripeCustomerMock(...args),
    getOrganizationMembers: (...args: unknown[]) =>
      getOrganizationMembersMock(...args),
  },
}));

vi.mock("@/lib/auth/utils", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("@/lib/auth/auth", () => ({
  auth: {
    api: {
      updateUser: vi.fn(),
    },
  },
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

describe("user.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only owned jobs for the active context", async () => {
    getSessionMock.mockResolvedValue({
      user: { id: "user-1" },
      session: { activeOrganizationId: "org-1" },
    });
    const coreJob = {
      agentId: "agent-1",
      userId: "user-1",
      jobType: "PAID",
      status: "COMPLETED",
      credits: 0,
      user: { id: "user-1", name: "User One", image: null },
      workspace: {
        id: "workspace-1",
        organizationId: "org-1",
        organization: {
          id: "org-1",
          name: "Org One",
          slug: "org-one",
        },
      },
    };
    getMyJobsMock.mockResolvedValue({
      data: [
        {
          ...coreJob,
          id: "job-2",
          createdAt: "2026-02-13T10:00:00.000Z",
          updatedAt: "2026-02-13T10:00:00.000Z",
        },
        {
          ...coreJob,
          id: "job-1",
          createdAt: "2026-02-12T10:00:00.000Z",
          updatedAt: "2026-02-12T10:00:00.000Z",
        },
      ],
    });

    const { userService } = await import("../user.service");
    const result = await userService.getMyJobs("agent-1");

    expect(getMyJobsMock).toHaveBeenCalledTimes(1);
    expect(getMyJobsMock).toHaveBeenCalledWith("agent-1");
    expect(result.map((job) => job.id)).toEqual(["job-2", "job-1"]);
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

  describe("getActiveOrganization", () => {
    it("returns organization with member count from Core", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1" },
        session: { activeOrganizationId: "org-1" },
      });
      getOrganizationByIdMock.mockResolvedValue({
        data: {
          id: "org-1",
          name: "Org One",
          slug: "org-one",
          logo: null,
          metadata: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      });
      getOrganizationStripeCustomerMock.mockResolvedValue({
        data: { stripeCustomerId: "cus_123" },
      });
      getOrganizationMembersMock.mockResolvedValue({
        data: [{ id: "member-1" }, { id: "member-2" }, { id: "member-3" }],
      });

      const { userService } = await import("../user.service");
      const result = await userService.getActiveOrganization();

      expect(getOrganizationMembersMock).toHaveBeenCalledWith("org-1");
      expect(result).toMatchObject({
        id: "org-1",
        stripeCustomerId: "cus_123",
        _count: { members: 3 },
      });
    });

    it("returns null when there is no active organization", async () => {
      getSessionMock.mockResolvedValue({
        user: { id: "user-1" },
        session: { activeOrganizationId: null },
      });

      const { userService } = await import("../user.service");
      const result = await userService.getActiveOrganization();

      expect(getOrganizationByIdMock).not.toHaveBeenCalled();
      expect(result).toBeNull();
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
});
