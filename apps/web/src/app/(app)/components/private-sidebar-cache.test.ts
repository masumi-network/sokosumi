import { beforeEach, describe, expect, it, vi } from "vitest";

const updateTagMock = vi.fn();
const getMyCreditsMock = vi.fn();
const listRoomsMock = vi.fn();
const listArchivedRoomsMock = vi.fn();
const getMyMembersMock = vi.fn();

vi.mock("next/cache", () => ({
  updateTag: (...args: unknown[]) => updateTagMock(...args),
  cacheLife: () => undefined,
  cacheTag: () => undefined,
}));

vi.mock("@/lib/services/chat-room.service", () => ({
  chatRoomService: {
    listRooms: () => listRoomsMock(),
    listArchivedRooms: () => listArchivedRoomsMock(),
  },
}));

vi.mock("@/lib/services/user.service", () => ({
  userService: {
    getMyMembersWithOrganizations: () => getMyMembersMock(),
  },
}));

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    getMyCredits: (...args: unknown[]) => getMyCreditsMock(...args),
  },
}));

describe("private-sidebar-cache", () => {
  beforeEach(() => {
    updateTagMock.mockReset();
    getMyCreditsMock.mockReset();
    listRoomsMock.mockReset();
    listArchivedRoomsMock.mockReset();
    getMyMembersMock.mockReset();
  });

  it("builds stable user and org tags", async () => {
    const { privateSidebarOrgTag, privateSidebarUserTag } = await import(
      "./private-sidebar-cache"
    );

    expect(privateSidebarUserTag("user-1")).toBe("app-sidebar-user-user-1");
    expect(privateSidebarOrgTag("org-1")).toBe("app-sidebar-org-org-1");
  });

  it("invalidates user tag and current + previous org tags", async () => {
    const { invalidatePrivateSidebarChrome } = await import(
      "./private-sidebar-cache"
    );

    invalidatePrivateSidebarChrome({
      userId: "user-1",
      organizationId: "org-new",
      previousOrganizationId: "org-old",
    });

    expect(updateTagMock).toHaveBeenCalledWith("app-sidebar-user-user-1");
    expect(updateTagMock).toHaveBeenCalledWith("app-sidebar-org-org-new");
    expect(updateTagMock).toHaveBeenCalledWith("app-sidebar-org-org-old");
  });

  it("skips duplicate previous org when unchanged", async () => {
    const { invalidatePrivateSidebarChrome } = await import(
      "./private-sidebar-cache"
    );

    invalidatePrivateSidebarChrome({
      userId: "user-1",
      organizationId: "org-1",
      previousOrganizationId: "org-1",
    });

    expect(updateTagMock).toHaveBeenCalledTimes(2);
    expect(updateTagMock).toHaveBeenCalledWith("app-sidebar-user-user-1");
    expect(updateTagMock).toHaveBeenCalledWith("app-sidebar-org-org-1");
  });

  it("returns null when credits fetch fails", async () => {
    getMyCreditsMock.mockRejectedValueOnce(new Error("boom"));
    const { getCachedMyCredits } = await import("./private-sidebar-cache");

    await expect(getCachedMyCredits()).resolves.toBeNull();
  });

  describe("loadSidebarChatList", () => {
    const args = { userId: "user-1", activeOrganizationId: "org-1" };
    const room = { id: "room-1" };
    const archived = { id: "room-archived" };

    it("returns the rooms while archived rooms and members are still being read", async () => {
      let finishRooms: (page: unknown) => void = () => undefined;
      listRoomsMock.mockReturnValue(
        new Promise((resolve) => {
          finishRooms = resolve;
        }),
      );
      let finishArchived: (page: unknown) => void = () => undefined;
      listArchivedRoomsMock.mockReturnValue(
        new Promise((resolve) => {
          finishArchived = resolve;
        }),
      );
      getMyMembersMock.mockResolvedValue([
        { organizationId: "org-1", role: "admin" },
      ]);
      const { loadSidebarChatList } = await import("./private-sidebar-cache");

      const pending = loadSidebarChatList(args);
      // Both reads start beside the rooms, not after them.
      expect(listArchivedRoomsMock).toHaveBeenCalledTimes(1);
      expect(getMyMembersMock).toHaveBeenCalledTimes(1);

      finishRooms({ rooms: [room], nextCursor: null });
      const list = await pending;
      expect(list.rooms).toEqual([room]);

      finishArchived({ rooms: [archived], nextCursor: null });
      await expect(list.deferred).resolves.toEqual({
        archivedRooms: [archived],
        isOrgOwnerOrAdmin: true,
      });
    });

    it("returns the rooms when the cached archived read fails, and leaves the failure to the list", async () => {
      listRoomsMock.mockResolvedValue({ rooms: [room], nextCursor: null });
      const failure = new Error("boom");
      // A synchronous throw passes the service's own fail-soft, as a failure
      // of the cache layer does.
      listArchivedRoomsMock.mockImplementation(() => {
        throw failure;
      });
      const unhandled = vi.fn();
      process.on("unhandledRejection", unhandled);
      try {
        const { loadSidebarChatList } = await import("./private-sidebar-cache");

        const list = await loadSidebarChatList(args);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(list.rooms).toEqual([room]);
        expect(unhandled).not.toHaveBeenCalled();
        await expect(list.deferred).rejects.toBe(failure);
      } finally {
        process.off("unhandledRejection", unhandled);
      }
    });

    it("grants the admin controls only for a role in the active workspace", async () => {
      listRoomsMock.mockResolvedValue({ rooms: [], nextCursor: null });
      listArchivedRoomsMock.mockResolvedValue({ rooms: [], nextCursor: null });
      getMyMembersMock.mockResolvedValue([
        { organizationId: "org-other", role: "owner" },
        { organizationId: "org-1", role: "member" },
      ]);
      const { loadSidebarChatList } = await import("./private-sidebar-cache");

      const list = await loadSidebarChatList(args);

      await expect(list.deferred).resolves.toMatchObject({
        isOrgOwnerOrAdmin: false,
      });
    });
  });
});
