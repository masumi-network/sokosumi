import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

vi.mock("next/server", () => ({
  connection: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/app/components/private-sidebar-cache", () => ({
  getPrivateCachedMembershipVisibleRooms: vi.fn().mockResolvedValue({
    rooms: [],
    nextCursor: null,
  }),
  getPrivateCachedChatListArchivedAndMembers: vi.fn().mockResolvedValue({
    archivedChatRoomsPage: { rooms: [], nextCursor: null },
    members: [],
  }),
}));

vi.mock("@/app/components/sidebar/components/personal-assistant-nav", () => ({
  default: () => null,
}));

vi.mock("@/components/chat/organization-chat-list.client", () => ({
  OrganizationChatList: () => null,
}));

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarSeparator: () => null,
}));

vi.mock("@/app/chat/components/chat-desktop-home-redirect.client", () => ({
  ChatDesktopHomeRedirect: () => null,
}));

import ChatPage from "@/app/chat/page";

describe("SOK-795 chat redirect matrix", () => {
  beforeEach(() => {
    redirectMock.mockClear();
  });

  it("bare /chat with retired compose queries stays on the list", async () => {
    const dm = await ChatPage({
      searchParams: Promise.resolve({ dm: "new" }),
    });
    expect(redirectMock).not.toHaveBeenCalled();
    expect(dm).toBeTruthy();

    redirectMock.mockClear();
    const create = await ChatPage({
      searchParams: Promise.resolve({ create: "channel" }),
    });
    expect(redirectMock).not.toHaveBeenCalled();
    expect(create).toBeTruthy();
  });

  it("bare /chat with notice redirects to Welcome preserving query", async () => {
    await expect(
      ChatPage({
        searchParams: Promise.resolve({ notice: "room-unavailable" }),
      }),
    ).rejects.toThrow("REDIRECT:/?notice=room-unavailable");
  });

  it("bare /chat without draft/notice does not redirect (list)", async () => {
    const result = await ChatPage({
      searchParams: Promise.resolve({}),
    });
    expect(redirectMock).not.toHaveBeenCalled();
    expect(result).toBeTruthy();
  });
});
