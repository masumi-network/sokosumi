import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(),
}));
vi.mock("@/app/components/private-sidebar-cache", () => ({
  invalidatePrivateSidebarChrome: vi.fn(),
}));

const getSessionMock = vi.fn();
vi.mock("@/lib/auth/auth.server", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

const getActiveOrganizationMock = vi.fn();
const getMyMemberInOrganizationMock = vi.fn();
vi.mock("@/lib/services", () => ({
  userService: {
    getActiveOrganization: (...args: unknown[]) =>
      getActiveOrganizationMock(...args),
    getMyMemberInOrganization: (...args: unknown[]) =>
      getMyMemberInOrganizationMock(...args),
  },
  chatRoomService: {},
}));

const listCoworkersMock = vi.fn();
vi.mock("@/lib/services/coworker.service", () => ({
  coworkerService: {
    listCoworkers: (...args: unknown[]) => listCoworkersMock(...args),
  },
}));

const loadOrganizationMembersMock = vi.fn();
vi.mock("@/app/chat/load-organization-members", () => ({
  loadOrganizationMembers: (...args: unknown[]) =>
    loadOrganizationMembersMock(...args),
}));

import { loadChatComposeRosterAction } from "../actions";

describe("loadChatComposeRosterAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({
      user: { id: "user-self" },
      session: { activeOrganizationId: "org-1" },
    });
    getActiveOrganizationMock.mockResolvedValue({
      id: "org-1",
      name: "Acme",
    });
    getMyMemberInOrganizationMock.mockResolvedValue({
      role: "member",
    });
    loadOrganizationMembersMock.mockResolvedValue({
      members: [],
      failed: false,
    });
    listCoworkersMock.mockResolvedValue([]);
  });

  it("returns an error DTO when roster services throw", async () => {
    listCoworkersMock.mockRejectedValue(new Error("coworkers down"));

    await expect(loadChatComposeRosterAction()).resolves.toEqual({
      ok: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "coworkers down",
      },
    });
  });

  it("keeps member Core failures as membersLoadFailed instead of an action error", async () => {
    loadOrganizationMembersMock.mockResolvedValue({
      members: [],
      failed: true,
    });

    await expect(loadChatComposeRosterAction()).resolves.toEqual({
      ok: true,
      value: {
        currentUserId: "user-self",
        organizationName: "Acme",
        hasOrganization: true,
        canCreateExternal: false,
        members: [],
        coworkers: [],
        membersLoadFailed: true,
      },
    });
  });
});
