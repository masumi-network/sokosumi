import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  useFormatter: () => ({ relativeTime: () => "2h ago" }),
  useNow: () => new Date(),
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
vi.mock("@/lib/project-scope-list.client", () => ({
  fetchScopeList: async () => ({ projects: [], nextCursor: null }),
}));

import { type ChatRoomInvitation, SokoBotStatus } from "@sokosumi/core-client";
import { SidebarProjectScope } from "@/app/components/project-scope/sidebar-project-scope";
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
            <SidebarProjectScope />
            <PersonalAssistantNav
              bot={{
                id: "bot-1",
                imageUrl: null,
                seed: "seed",
                name: "Mo",
                status: SokoBotStatus.RUNNING,
                lastActivityAt: null,
              }}
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

const SRC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

function listSources(dir: string): { file: string; text: string }[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".tsx") && !name.includes(".test."))
    .map((name) => ({
      file: name,
      text: readFileSync(path.join(dir, name), "utf8"),
    }));
}

/** Every list that draws sidebar rows: the App chrome's and the chat list. */
const SIDEBAR_LIST_SOURCES = [
  ...listSources(path.join(SRC_ROOT, "app/(app)/components")),
  ...listSources(path.join(SRC_ROOT, "components/chat")),
];

const SLOT = '[data-slot="sidebar-row-slot"]';
// Not `data-slot`: a Popover trigger wrapping a row (as the project picker
// once did) renames that to `popover-trigger`, and the row would drop out
// unseen.
const ROW = '[data-sidebar="menu-button"]';

describe("every sidebar row uses the shared leading slot", () => {
  it("renders one for Soko Bots, nav, rooms, archived and the invitation", () => {
    const { container } = renderSidebar();

    // Soko Bots, the nav rows, five rooms, the archived row, the
    // invitation's card, and six skeleton room slots. Section headings have
    // none: their title leads and the chevron follows it, the project title
    // titles the nav rather than standing in it, and New task is the
    // header's button, not a row. Counting by row type rather than by
    // total, so adding a nav item does not edit a number here.
    expect(container.querySelectorAll(SLOT).length).toBeGreaterThanOrEqual(20);

    for (const slot of container.querySelectorAll(SLOT)) {
      const tokens = slot.className.split(/\s+/);
      expect(tokens).toContain("h-6");
      expect(tokens).toContain("min-w-6");
      expect(tokens).toContain("shrink-0");
    }
  });

  it("gives every row button the slot as its first child", () => {
    const { container } = renderSidebar();

    const buttons = container.querySelectorAll(ROW);
    expect(buttons.length).toBeGreaterThan(10);

    for (const button of buttons) {
      const slot = button.querySelector(SLOT);
      expect(slot, `no leading slot in: ${button.textContent}`).not.toBeNull();
      // First in the flow, so the label after it lands on one column.
      expect(button.firstElementChild).toBe(slot);
    }
  });

  it("holds every row to the primitive's height, and no list to its own", () => {
    const { container } = renderSidebar();
    const ROW_HEIGHT = ["h-11", "min-h-11", "md:h-7", "md:min-h-7"];
    // A two-line row (a guest room's host organisation line, the live Soko
    // Bot row) asks the primitive for `lines={2}`, which
    // marks it `data-row-lines` and releases the height down to the floor.
    // A list that wrote a height of its own, one line or two, fails here.
    const TWO_LINE_HEIGHT = ["h-auto", "min-h-11", "md:h-auto", "md:min-h-7"];
    let twoLineRows = 0;

    for (const button of container.querySelectorAll(ROW)) {
      const heights = button.className
        .split(/\s+/)
        .filter((token) => /^(md:)?(min-)?h-/.test(token))
        .sort();
      if (button.getAttribute("data-row-lines") === "2") {
        twoLineRows += 1;
        expect(heights, button.textContent ?? "").toEqual(
          [...TWO_LINE_HEIGHT].sort(),
        );
        // Both lines sit inside the element that takes the hover, so the
        // highlight covers the whole row and not just its first line.
        expect(button.className).toContain("hover:bg-sidebar-accent");
        continue;
      }
      expect(heights, button.textContent ?? "").toEqual([...ROW_HEIGHT].sort());
    }
    expect(twoLineRows).toBeGreaterThanOrEqual(2);
  });

  // The project scope titles the nav rather than standing in it, so it is
  // the one control in the list that is not a row: no slot, no row height.
  // A row primitive here would put its name on the 48px column, not the
  // title's 16px.
  it("keeps the project title out of the rows it titles", () => {
    const { container } = renderSidebar();
    const title = container.querySelector(
      '[data-testid="project-scope-sidebar-title"]',
    );

    expect(title).not.toBeNull();
    expect(title?.matches(ROW)).toBe(false);
    expect(title?.querySelector(SLOT)).toBeNull();
  });

  it("leaves a two-line row's height to the primitive's `lines`", () => {
    // The render above cannot tell a primitive's class from one a list
    // copied, so read the lists: none that draws a row writes the released
    // height or the marker itself.
    const offenders = SIDEBAR_LIST_SOURCES.filter(
      ({ text }) =>
        text.includes("SidebarMenuButton") &&
        /data-row-lines=|md:h-auto/.test(text),
    ).map(({ file }) => file);

    expect(SIDEBAR_LIST_SOURCES.length).toBeGreaterThan(10);
    expect(offenders).toEqual([]);
  });

  it("lets the slot size every row icon, so no list sets its own", () => {
    const { container } = renderSidebar();
    const icons = container.querySelectorAll(`${SLOT} > svg`);
    expect(icons.length).toBeGreaterThan(10);

    for (const icon of icons) {
      const sizes = (icon.getAttribute("class") ?? "")
        .split(/\s+/)
        .filter((token) => /^(md:)?(size|w|h)-/.test(token));
      expect(sizes, icon.getAttribute("class") ?? "").toEqual([]);
    }
  });
});
