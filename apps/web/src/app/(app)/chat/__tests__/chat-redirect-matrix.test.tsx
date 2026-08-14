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

vi.mock("@/lib/hermes/beta-access", () => ({
  isHermesBetaAccessEmail: () => false,
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

vi.mock(
  "@/app/components/sidebar/components/personal-assistant-nav.client",
  () => ({
    default: () => null,
  }),
);

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

import ChatChatsLegacyPage from "@/app/chat/chats/page";
import ChatPage from "@/app/chat/page";

describe("SOK-795 chat redirect matrix", () => {
  beforeEach(() => {
    redirectMock.mockClear();
  });

  it("legacy /chat/chats always redirects to /chat preserving query", async () => {
    await expect(
      ChatChatsLegacyPage({
        searchParams: Promise.resolve({ foo: "1", bar: "2" }),
      }),
    ).rejects.toThrow("REDIRECT:/chat?foo=1&bar=2");
    expect(redirectMock).toHaveBeenCalledWith("/chat?foo=1&bar=2");
  });

  it("legacy /chat/chats with dm=new redirects to /chat?dm=new (not Welcome yet)", async () => {
    await expect(
      ChatChatsLegacyPage({
        searchParams: Promise.resolve({ dm: "new" }),
      }),
    ).rejects.toThrow("REDIRECT:/chat?dm=new");
  });

  it("bare /chat with dm=new redirects to Welcome", async () => {
    await expect(
      ChatPage({ searchParams: Promise.resolve({ dm: "new" }) }),
    ).rejects.toThrow("REDIRECT:/?dm=new");
  });

  it("bare /chat with create=channel redirects to Welcome", async () => {
    await expect(
      ChatPage({ searchParams: Promise.resolve({ create: "channel" }) }),
    ).rejects.toThrow("REDIRECT:/?create=channel");
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
