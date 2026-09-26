import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// ProjectsMenuItem and the chat rows call useSession. The real better-auth
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
import type { ChatRoomInvitation } from "@/lib/clients/generated/core";
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
 * One rule, one slot: every kind of **Sidebar row** (CONTEXT.md) puts its
 * leading mark in `SidebarRowSlot`, so no row can drift off the sidebar's
 * 28px leading axis or start its label off the 48px column. Each row type used
 * to build that box by hand, which is how a room's mark ended up 2px from the
 * nav icons' line, a section's chevron 2px, and Soko Bots' stack 16px.
 *
 * One render answers both states: expanded and collapsed are pure CSS on the
 * same markup, so a slot that is right here is right on the rail too.
 */
function renderSidebar() {
  return render(
    <TestQueryProvider>
      <SidebarProvider defaultOpen>
        <Sidebar collapsible="icon">
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
              canDeleteArchivedRooms
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
  it("renders one for Soko Bots, nav, headings, rooms, archived and the invitation", () => {
    const { container } = renderSidebar();

    // Soko Bots, eight nav rows, four section headings (Pinned, Channels,
    // External, Direct Messages) twice over — the titled row and its rail
    // square — Archived's titled row, five rooms, the archived row, the
    // invitation's card and its rail button, and eight skeleton slots — two
    // section headings and six rooms. Counting
    // by row type rather than by total, so adding a nav item does not edit a
    // number here.
    expect(container.querySelectorAll(SLOT).length).toBeGreaterThan(20);

    for (const slot of container.querySelectorAll(SLOT)) {
      const tokens = slot.className.split(/\s+/);
      expect(tokens).toContain("h-6");
      expect(tokens).toContain("min-w-6");
      expect(tokens).toContain("shrink-0");
      // A slot that changed with the sidebar's state would be a mark that
      // moves on a toggle, which is the whole thing this rule forbids.
      expect(slot.className).not.toContain("group-data-[collapsible=icon]:");
    }
  });

  it("renders a rail square per section, Archived included", () => {
    const { container } = renderSidebar();

    // Every section keeps a square on the rail or the sections below it jump
    // on a toggle, and each square's mark uses the same slot as the rows it
    // heads. Named rather than counted: the `> 20` total above would not dent
    // if a section lost its square, and Archived is the one that only just
    // got one — its rows never reach the rail, so nothing else there would
    // hold its heading's place.
    const squares = [
      ...container.querySelectorAll('[data-slot="section-rail-header"]'),
    ];
    expect(squares.map((square) => square.textContent?.trim())).toContain(
      "archivedChannels",
    );
    // Pinned, Channels, External, Archived, Direct Messages.
    expect(squares).toHaveLength(5);
    for (const square of squares) {
      expect(
        square.querySelector(SLOT),
        square.textContent ?? "",
      ).not.toBeNull();
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

  it("holds every row to one height in both states", () => {
    const { container } = renderSidebar();

    for (const button of container.querySelectorAll(
      '[data-slot="sidebar-menu-button"]',
    )) {
      const tokens = button.className.split(/\s+/);
      // The guest row is one of the three items allowed to differ: its host
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
