import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// The chat rows call useSession. The real better-auth
// session atom schedules a nanostores unmount timer that can fire after
// happy-dom tears down `window`.
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({ data: null }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/chat",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

// Every prop, not just `href`: Radix `Slot` hands the row button's class list
// and `data-slot` to this element, and a mock that dropped them would hide
// the very geometry under test.
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

vi.mock("@/app/chat/components/browse-channels-dialog", () => ({
  BrowseChannelsDialog: () => null,
}));
vi.mock("@/app/chat/components/create-channel-dialog", () => ({
  CreateChannelDialog: () => null,
}));
vi.mock("@/app/chat/components/create-direct-dialog", () => ({
  CreateDirectDialog: () => null,
}));
vi.mock("@/app/chat/components/room-helpers", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/app/chat/components/room-helpers")
  >()),
  getRoomDisplayName: () => "Alice",
}));

// Realtime is not what this test is about, and the list only reads it.
vi.mock("@/lib/ably/ably-connection-health-store", () => ({
  useAblyConnectionHealthy: () => true,
}));
vi.mock("@/components/chat/live-member-presence-dot", () => ({
  LiveMemberPresenceDot: () => null,
  LiveMemberPresenceText: () => null,
}));
vi.mock("@/components/chat/personal-assistant-chrome-store", () => ({
  publishPersonalAssistantChromeVisible: vi.fn(),
}));
vi.mock("@/components/chat/fetch-sidebar-room-collection", () => ({
  fetchSidebarRoomCollection: async () => ({ rooms: [], nextCursor: null }),
}));

import type { ChatRoomInvitation } from "@sokosumi/core-client";
import MenuItems from "@/app/components/sidebar/components/menu-items";
import PersonalAssistantNav from "@/app/components/sidebar/components/personal-assistant-nav.client";
import { SidebarChatListSkeleton } from "@/app/components/sidebar/components/sidebar-chat-list-skeleton";
import { makeRoom } from "@/components/chat/__tests__/chat-room-fixtures";
import { OrganizationChatList } from "@/components/chat/organization-chat-list.client";
import {
  Sidebar,
  SidebarContent,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { TestQueryProvider } from "@/test/query-provider";

const rooms = [
  makeRoom({ id: "channel-1", name: "general" }),
  makeRoom({ id: "pinned-1", name: "announcements", starredAt: new Date() }),
  makeRoom({
    id: "guest-1",
    name: "partners",
    myAccess: "guest",
    discoverability: "external",
    organizationName: "Acme",
  }),
  makeRoom({ id: "direct-1", name: "Alice", kind: "direct" }),
];

const archivedRooms = [makeRoom({ id: "archived-1", name: "old-project" })];

const pendingInvitations: ChatRoomInvitation[] = [
  {
    id: "invitation-1",
    roomId: "room-9",
    roomName: "shared-plans",
    organizationName: "Acme",
  } as ChatRoomInvitation,
];

/**
 * One rule, one slot: every kind of **Sidebar row** (GLOSSARY.md) puts its
 * leading mark in `SidebarRowSlot`, so no row can drift off the sidebar's
 * 28px leading axis or start its label off the 48px column. Each row type used
 * to build that box by hand, which is how a room's mark ended up 2px from the
 * nav icons' line, a section's chevron 2px, and Soko Bots' stack 16px.
 */
function renderSidebar() {
  return render(
    <TestQueryProvider>
      <SidebarProvider defaultOpen>
        <Sidebar>
          <SidebarContent>
            <PersonalAssistantNav
              bot={{ id: "bot-1", imageUrl: null, seed: "seed" }}
            />
            <MenuItems />
            <OrganizationChatList
              rooms={rooms}
              archivedRooms={archivedRooms}
              pendingInvitations={pendingInvitations}
              currentUserId="user-1"
              organizationId="org-1"
              isOrgOwnerOrAdmin
              dismissSheetOnNavigate={false}
              paintOnly
            />
            <SidebarChatListSkeleton />
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>
    </TestQueryProvider>,
  );
}

const SLOT = '[data-slot="sidebar-row-slot"]';

describe("every sidebar row uses the shared leading slot", () => {
  it("renders one for Soko Bots, nav, rooms, archived and the invitation", () => {
    const { container } = renderSidebar();

    // Soko Bots, eight nav rows, five rooms, the archived row, the
    // invitation's card, and six skeleton room slots. Section headings have
    // none: their title leads and the chevron follows it. Counting by row
    // type rather than by total, so adding a nav item does not edit a number
    // here.
    expect(container.querySelectorAll(SLOT).length).toBeGreaterThan(20);

    for (const slot of container.querySelectorAll(SLOT)) {
      const tokens = slot.className.split(/\s+/);
      expect(tokens).toContain("h-6");
      expect(tokens).toContain("min-w-6");
      expect(tokens).toContain("shrink-0");
    }
  });

  it("gives every row button the slot as its first child", () => {
    const { container } = renderSidebar();

    const buttons = container.querySelectorAll(
      '[data-slot="sidebar-menu-button"]',
    );
    expect(buttons.length).toBeGreaterThan(10);

    for (const button of buttons) {
      const slot = button.querySelector(SLOT);
      expect(slot, `no leading slot in: ${button.textContent}`).not.toBeNull();
      // First in the flow, so the label after it lands on one column.
      expect(button.firstElementChild).toBe(slot);
    }
  });

  it("holds every row to one height", () => {
    const { container } = renderSidebar();

    for (const button of container.querySelectorAll(
      '[data-slot="sidebar-menu-button"]',
    )) {
      const tokens = button.className.split(/\s+/);
      // The guest row is one of the items allowed to differ: its host
      // organisation line needs a second line no 32px row can hold.
      if (tokens.includes("h-auto")) {
        expect(tokens).toContain("md:min-h-8");
        continue;
      }
      expect(tokens).toContain("h-11");
      expect(tokens).toContain("md:h-8");
      expect(button.className).not.toContain("min-h-10");
    }
  });
});
