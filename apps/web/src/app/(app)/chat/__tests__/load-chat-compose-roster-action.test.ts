import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(
    async () => (key: string) =>
      key === "personalAssistantBadge" ? "Personal assistant" : key,
  ),
}));
vi.mock("@/app/components/private-sidebar-cache", () => ({
  invalidatePrivateSidebarChrome: vi.fn(),
}));

const getSessionMock = vi.fn();
vi.mock("@/lib/auth/auth.server", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

const createRoomMock = vi.fn();
const getActiveOrganizationMock = vi.fn();
const getMyMemberInOrganizationMock = vi.fn();
vi.mock("@/lib/services/user.service", () => ({
  userService: {
    getActiveOrganization: (...args: unknown[]) =>
      getActiveOrganizationMock(...args),
    getMyMemberInOrganization: (...args: unknown[]) =>
      getMyMemberInOrganizationMock(...args),
  },
}));
vi.mock("@/lib/services/chat-room.service", () => ({
  chatRoomService: {
    createRoom: (...args: unknown[]) => createRoomMock(...args),
  },
}));

const listCoworkersMock = vi.fn();
vi.mock("@/lib/services/coworker.service", () => ({
  coworkerService: {
    listCoworkers: (...args: unknown[]) => listCoworkersMock(...args),
  },
}));

const getMineMock = vi.fn();
vi.mock("@/lib/services/soko-bot.service", () => ({
  sokoBotService: {
    getMine: (...args: unknown[]) => getMineMock(...args),
  },
}));

const loadOrganizationMembersMock = vi.fn();
vi.mock("@/app/chat/load-organization-members", () => ({
  loadOrganizationMembers: (...args: unknown[]) =>
    loadOrganizationMembersMock(...args),
}));

import {
  createDirectRoomAction,
  loadChatComposeRosterAction,
} from "../actions";

describe("loadChatComposeRosterAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({
      user: {
        id: "user-self",
        name: "Ada",
        image: "https://example.com/ada.png",
      },
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
    getMineMock.mockResolvedValue(null);
  });

  it("forwards self-only creation through the existing Core service without an organization", async () => {
    getActiveOrganizationMock.mockResolvedValue(null);
    createRoomMock.mockResolvedValue({ id: "self-room", isSelfDirect: true });
    await expect(
      createDirectRoomAction({ memberUserIds: ["user-self"] }),
    ).resolves.toMatchObject({
      ok: true,
      value: { id: "self-room", isSelfDirect: true },
    });
    expect(createRoomMock).toHaveBeenCalledWith({
      kind: "direct",
      memberUserIds: ["user-self"],
      coworkerIds: [],
      sokoBotIds: [],
    });
    createRoomMock.mockRejectedValueOnce(new Error("Core unavailable"));
    await expect(
      createDirectRoomAction({ memberUserIds: ["user-self"] }),
    ).resolves.toMatchObject({
      ok: false,
      error: { message: "Core unavailable" },
    });
  });

  it.each(["coworkers", "organization", "membership"])(
    "keeps session identity available when %s fails",
    async (service) => {
      const failingService =
        service === "coworkers"
          ? listCoworkersMock
          : service === "organization"
            ? getActiveOrganizationMock
            : getMyMemberInOrganizationMock;
      failingService.mockRejectedValueOnce(new Error("roster down"));
      await expect(loadChatComposeRosterAction()).resolves.toMatchObject({
        ok: true,
        value: {
          currentUserId: "user-self",
          currentUserName: "Ada",
          currentUserImage: "https://example.com/ada.png",
          members: [],
          membersLoadFailed: true,
        },
      });
    },
  );

  it("returns self identity without an active organization", async () => {
    getActiveOrganizationMock.mockResolvedValue(null);
    await expect(loadChatComposeRosterAction()).resolves.toMatchObject({
      ok: true,
      value: {
        currentUserId: "user-self",
        currentUserName: "Ada",
        hasOrganization: false,
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
        currentUserName: "Ada",
        currentUserImage: "https://example.com/ada.png",
        organizationName: "Acme",
        hasOrganization: true,
        canCreateExternal: false,
        members: [],
        coworkers: [],
        sokoBots: [],
        membersLoadFailed: true,
      },
    });
  });
});
