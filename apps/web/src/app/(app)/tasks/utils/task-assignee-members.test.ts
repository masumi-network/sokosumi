import { expectConsole } from "@sokosumi/utils/test-console";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listTaskAssigneeMemberOptions } from "./task-assignee-members";

const { getOrganizationMembersMock, getSessionMock } = vi.hoisted(() => ({
  getOrganizationMembersMock: vi.fn(),
  getSessionMock: vi.fn(),
}));

vi.mock("@/lib/services/user.service", () => ({
  userService: {
    getOrganizationMembers: (...args: unknown[]) =>
      getOrganizationMembersMock(...args),
  },
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

describe("listTaskAssigneeMemberOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOrganizationMembersMock.mockResolvedValue([]);
    getSessionMock.mockResolvedValue(null);
  });

  it("returns org members when the workspace has an organization", async () => {
    getOrganizationMembersMock.mockResolvedValue([
      {
        id: "m_1",
        user: {
          id: "user_1",
          name: "Amy",
          email: "amy@example.com",
          image: null,
        },
      },
    ]);

    const options = await listTaskAssigneeMemberOptions("org_1");

    expect(getOrganizationMembersMock).toHaveBeenCalledWith("org_1");
    expect(options).toMatchObject([{ id: "user_1", kind: "user" }]);
  });

  it("falls back to the session user for personal workspaces", async () => {
    getSessionMock.mockResolvedValue({
      user: { id: "user_1", name: "Me", email: "me@example.com", image: null },
    });

    const options = await listTaskAssigneeMemberOptions(null);

    expect(getOrganizationMembersMock).not.toHaveBeenCalled();
    expect(options).toMatchObject([{ id: "user_1", kind: "user" }]);
  });

  it("returns no options without an organization or session", async () => {
    await expect(listTaskAssigneeMemberOptions(null)).resolves.toEqual([]);
  });

  it("logs a failed member read and falls back to the session user", async () => {
    const logged = expectConsole(
      "error",
      "Failed to load organization members for assignee picker",
    );
    getOrganizationMembersMock.mockRejectedValue(
      new Error("Core answered 503"),
    );
    getSessionMock.mockResolvedValue({
      user: { id: "user_1", name: "Me", email: "me@example.com", image: null },
    });

    const options = await listTaskAssigneeMemberOptions("org_1");

    expect(options).toMatchObject([{ id: "user_1", kind: "user" }]);
    expect(logged).toHaveLength(1);
    expect(logged[0]?.[1]).toMatchObject({ organizationId: "org_1" });
  });

  // A prerender hands the session read a promise that rejects when it ends.
  // That is Next's signal, not a Core outage, and must reach the boundary.
  it("rethrows a prerender's hanging promise rejection without logging", async () => {
    const hanging = Object.assign(
      new Error(
        "During prerendering, cookies() rejects when the prerender is complete.",
      ),
      { digest: "HANGING_PROMISE_REJECTION" },
    );
    getOrganizationMembersMock.mockRejectedValue(hanging);
    getSessionMock.mockResolvedValue({
      user: { id: "user_1", name: "Me", email: "me@example.com", image: null },
    });

    await expect(listTaskAssigneeMemberOptions("org_1")).rejects.toBe(hanging);
    expect(getSessionMock).not.toHaveBeenCalled();
  });
});
