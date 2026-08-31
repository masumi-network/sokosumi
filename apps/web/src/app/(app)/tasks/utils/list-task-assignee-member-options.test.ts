import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getSessionMock = vi.fn();
const getOrganizationMembersMock = vi.fn();

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("@/lib/services/user.service", () => ({
  userService: {
    getOrganizationMembers: (...args: unknown[]) =>
      getOrganizationMembersMock(...args),
  },
}));

import { listTaskAssigneeMemberOptions } from "./list-task-assignee-member-options";

describe("listTaskAssigneeMemberOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty list when there is no session", async () => {
    getSessionMock.mockResolvedValue(null);

    await expect(listTaskAssigneeMemberOptions()).resolves.toEqual([]);
    expect(getOrganizationMembersMock).not.toHaveBeenCalled();
  });

  it("returns the signed-in user in a personal workspace", async () => {
    getSessionMock.mockResolvedValue({
      user: {
        id: "user-1",
        name: "Ada",
        email: "ada@example.com",
        image: null,
      },
      session: { activeOrganizationId: null },
    });

    await expect(listTaskAssigneeMemberOptions()).resolves.toEqual([
      { id: "user-1", name: "Ada", image: null },
    ]);
    expect(getOrganizationMembersMock).not.toHaveBeenCalled();
  });

  it("returns organization members in an org workspace", async () => {
    getSessionMock.mockResolvedValue({
      user: { id: "user-1", name: "Ada", image: null },
      session: { activeOrganizationId: "org-1" },
    });
    getOrganizationMembersMock.mockResolvedValue([
      {
        user: { id: "user-1", name: "Ada", image: null },
      },
      {
        user: {
          id: "user-2",
          name: "Grace",
          image: "https://example.com/g.png",
        },
      },
    ]);

    await expect(listTaskAssigneeMemberOptions()).resolves.toEqual([
      { id: "user-1", name: "Ada", image: null },
      {
        id: "user-2",
        name: "Grace",
        image: "https://example.com/g.png",
      },
    ]);
    expect(getOrganizationMembersMock).toHaveBeenCalledWith("org-1");
  });

  it("falls back to the signed-in user when org members fail to load", async () => {
    getSessionMock.mockResolvedValue({
      user: { id: "user-1", name: "Ada", image: null },
      session: { activeOrganizationId: "org-1" },
    });
    getOrganizationMembersMock.mockRejectedValue(new Error("boom"));

    await expect(listTaskAssigneeMemberOptions()).resolves.toEqual([
      { id: "user-1", name: "Ada", image: null },
    ]);
  });
});
