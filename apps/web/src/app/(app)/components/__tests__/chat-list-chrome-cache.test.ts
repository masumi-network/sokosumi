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
      nextCursor: null,
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
    const { loadChatListChromeData } = await import(
      "@/app/components/private-sidebar-cache"
    );

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
    const { loadChatListChromeData } = await import(
      "@/app/components/private-sidebar-cache"
    );

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
    const { loadChatListChromeData } = await import(
      "@/app/components/private-sidebar-cache"
    );

    const result = await loadChatListChromeData("org-1");

    expect(result.chatRoomsPage).toEqual(EMPTY_PAGE);
    expect(result.archivedChatRoomsPage).toEqual(EMPTY_PAGE);
    expect(result.members).toEqual([]);
  });
});

describe("loadMembershipVisibleRooms progressive paint", () => {
  beforeEach(() => {
    listRoomsMock.mockReset();
    listArchivedRoomsMock.mockReset();
    getMyMembersWithOrganizationsMock.mockReset();
  });

  it("resolves room row labels without calling archived or members", async () => {
    listRoomsMock.mockResolvedValue({
      rooms: [{ id: "room-1", name: "Plan.Net Studios x NMKR" }],
      nextCursor: null,
    });
    // Hang forever — proves rooms paint path does not await these.
    listArchivedRoomsMock.mockReturnValue(new Promise(() => {}));
    getMyMembersWithOrganizationsMock.mockReturnValue(new Promise(() => {}));

    const { loadMembershipVisibleRooms } = await import(
      "@/app/components/private-sidebar-cache"
    );

    const roomsPage = await loadMembershipVisibleRooms();

    expect(roomsPage.rooms).toEqual([
      { id: "room-1", name: "Plan.Net Studios x NMKR" },
    ]);
    expect(listRoomsMock).toHaveBeenCalledTimes(1);
    expect(listArchivedRoomsMock).not.toHaveBeenCalled();
    expect(getMyMembersWithOrganizationsMock).not.toHaveBeenCalled();
  });
});

describe("chat list chrome single-source composition contract", () => {
  it("sidebar shares private chrome slices; chats page awaits rooms first", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const dir = dirname(fileURLToPath(import.meta.url));
    const sidebar = readFileSync(
      join(dir, "../private-cached-app-sidebar.tsx"),
      "utf8",
    );
    const chatsPage = readFileSync(join(dir, "../../chat/page.tsx"), "utf8");
    const cacheSource = readFileSync(
      join(dir, "../private-sidebar-cache.ts"),
      "utf8",
    );

    expect(sidebar).toMatch(/getPrivateCachedChatListChrome/);
    // Chats awaits membership rooms, then Suspense-streams archived+members.
    expect(chatsPage).toMatch(/getPrivateCachedMembershipVisibleRooms/);
    expect(chatsPage).toMatch(/getPrivateCachedChatListArchivedAndMembers/);
    expect(chatsPage).toMatch(/<Suspense/);
    // Page must not re-issue raw listRooms / listArchived / members after the
    // shared private-cache slices own that cold composition work.
    expect(chatsPage).not.toMatch(/chatRoomService\s*\.\s*listRooms\s*\(/);
    expect(chatsPage).not.toMatch(
      /chatRoomService\s*\.\s*listArchivedRooms\s*\(/,
    );
    expect(chatsPage).not.toMatch(
      /userService\s*\.\s*getMyMembersWithOrganizations\s*\(/,
    );
    // Composer still exists for sidebar/header; rooms + deferred are separate
    // private-cache entries with the same tags (SOK-779).
    expect(cacheSource).toMatch(
      /function getPrivateCachedMembershipVisibleRooms/,
    );
    expect(cacheSource).toMatch(
      /function getPrivateCachedChatListArchivedAndMembers/,
    );
    expect(cacheSource).toMatch(/function getPrivateCachedChatListChrome/);
  });

  it("header workspace switcher reads members from getPrivateCachedChatListChrome", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const headerProfile = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../header/header-profile-section.tsx",
      ),
      "utf8",
    );

    expect(headerProfile).toMatch(/getPrivateCachedChatListChrome/);
    expect(headerProfile).not.toMatch(
      /userService\s*\.\s*getMyMembersWithOrganizations\s*\(/,
    );

    const deferredAccount = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../sidebar-deferred-account.tsx",
      ),
      "utf8",
    );
    expect(deferredAccount).toMatch(/getPrivateCachedChatListChrome/);
    expect(deferredAccount).not.toMatch(
      /userService\s*\.\s*getMyMembersWithOrganizations\s*\(/,
    );
  });

  it("header Notification Center sits outside the members Suspense", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const headerProfile = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../header/header-profile-section.tsx",
      ),
      "utf8",
    );

    expect(headerProfile).toMatch(/HeaderNotificationBell/);
    expect(headerProfile).toMatch(
      /<Suspense[\s\S]*HeaderProfileSectionInner[\s\S]*<\/Suspense>\s*<HeaderNotificationBell/,
    );

    const fallback = headerProfile.slice(
      headerProfile.indexOf("function HeaderProfileSectionSkeleton"),
      headerProfile.indexOf("export default function HeaderProfileSection"),
    );
    expect(fallback).toMatch(/size-4/);
    expect(fallback).not.toMatch(/size-8/);
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
    expect(source).toMatch(/function getPrivateCachedMembershipVisibleRooms/);
    expect(source).toMatch(
      /function getPrivateCachedChatListArchivedAndMembers/,
    );
  });
});
