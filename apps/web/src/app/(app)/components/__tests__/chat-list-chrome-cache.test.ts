import { beforeEach, describe, expect, it, vi } from "vitest";

const listRoomsMock = vi.fn();
const listArchivedRoomsMock = vi.fn();
const getMyMembersWithOrganizationsMock = vi.fn();

vi.mock("@/lib/services", () => ({
  chatRoomService: {
    listRooms: (...args: unknown[]) => listRoomsMock(...args),
    listArchivedRooms: (...args: unknown[]) => listArchivedRoomsMock(...args),
  },
  userService: {
    getMyMembersWithOrganizations: (...args: unknown[]) =>
      getMyMembersWithOrganizationsMock(...args),
  },
}));

const EMPTY_PAGE = { rooms: [], nextCursor: null };

describe("loadChatListChromeData", () => {
  beforeEach(() => {
    listRoomsMock.mockReset();
    listArchivedRoomsMock.mockReset();
    getMyMembersWithOrganizationsMock.mockReset();
    listRoomsMock.mockResolvedValue({
      rooms: [{ id: "room-1" }],
      nextCursor: "next",
    });
    listArchivedRoomsMock.mockResolvedValue({
      rooms: [{ id: "archived-1" }],
      nextCursor: null,
    });
    getMyMembersWithOrganizationsMock.mockResolvedValue([
      { organizationId: "org-1", role: "owner" },
    ]);
  });

  it("issues one rooms + archived + members fetch per loadChatListChromeData call", async () => {
    // Proves the shared body is a single fan-out, not N service calls per field.
    // In-request SSR dedupe of sidebar+page is Next private-cache runtime (not
    // exercisable here); dual call-site wiring is locked by the contract tests.
    const { loadChatListChromeData } = await import("../private-sidebar-cache");

    const result = await loadChatListChromeData("org-1");

    expect(listRoomsMock).toHaveBeenCalledTimes(1);
    expect(listRoomsMock).toHaveBeenCalledWith();
    expect(listArchivedRoomsMock).toHaveBeenCalledTimes(1);
    expect(getMyMembersWithOrganizationsMock).toHaveBeenCalledTimes(1);
    expect(result.chatRoomsPage.rooms).toEqual([{ id: "room-1" }]);
    expect(result.archivedChatRoomsPage.rooms).toEqual([{ id: "archived-1" }]);
    expect(result.members).toEqual([
      { organizationId: "org-1", role: "owner" },
    ]);
  });

  it("skips archived rooms Core fetch when no active organization", async () => {
    const { loadChatListChromeData } = await import("../private-sidebar-cache");

    const result = await loadChatListChromeData(null);

    expect(listRoomsMock).toHaveBeenCalledTimes(1);
    expect(listArchivedRoomsMock).not.toHaveBeenCalled();
    expect(getMyMembersWithOrganizationsMock).toHaveBeenCalledTimes(1);
    expect(result.archivedChatRoomsPage).toEqual(EMPTY_PAGE);
  });

  it("returns empty pages when room fetches fail", async () => {
    listRoomsMock.mockRejectedValueOnce(new Error("rooms down"));
    listArchivedRoomsMock.mockRejectedValueOnce(new Error("archived down"));
    getMyMembersWithOrganizationsMock.mockRejectedValueOnce(
      new Error("members down"),
    );
    const { loadChatListChromeData } = await import("../private-sidebar-cache");

    const result = await loadChatListChromeData("org-1");

    expect(result.chatRoomsPage).toEqual(EMPTY_PAGE);
    expect(result.archivedChatRoomsPage).toEqual(EMPTY_PAGE);
    expect(result.members).toEqual([]);
  });
});

describe("chat list chrome single-source composition contract", () => {
  it("sidebar and chats page both call getPrivateCachedChatListChrome", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const dir = dirname(fileURLToPath(import.meta.url));
    const sidebar = readFileSync(
      join(dir, "../private-cached-app-sidebar.tsx"),
      "utf8",
    );
    const chatsPage = readFileSync(
      join(dir, "../../chat/chats/page.tsx"),
      "utf8",
    );

    expect(sidebar).toMatch(/getPrivateCachedChatListChrome/);
    expect(chatsPage).toMatch(/getPrivateCachedChatListChrome/);
    // Page must not re-issue raw listRooms / listArchived / members after the
    // shared private-cache slice owns that cold composition work.
    expect(chatsPage).not.toMatch(/chatRoomService\s*\.\s*listRooms\s*\(/);
    expect(chatsPage).not.toMatch(
      /chatRoomService\s*\.\s*listArchivedRooms\s*\(/,
    );
    expect(chatsPage).not.toMatch(
      /userService\s*\.\s*getMyMembersWithOrganizations\s*\(/,
    );
  });

  it("private cache loader tags user/org like sidebar chrome", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const source = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../private-sidebar-cache.ts",
      ),
      "utf8",
    );

    expect(source).toMatch(/"use cache: private"/);
    expect(source).toMatch(/privateSidebarUserTag/);
    expect(source).toMatch(/privateSidebarOrgTag/);
    expect(source).toMatch(/function getPrivateCachedChatListChrome/);
  });
});
