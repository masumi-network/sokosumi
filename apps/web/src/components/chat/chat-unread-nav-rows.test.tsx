import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/../messages/en.json";
import type { ChatRoom } from "@/lib/clients/generated/core";
import { makeRoom } from "./__tests__/chat-room-fixtures";
import { ChatUnreadNavRows } from "./chat-unread-nav-rows";

const { navigation, sidebarMock } = vi.hoisted(() => ({
  navigation: { pathname: "/chat/rooms/room-1" },
  sidebarMock: {
    state: "expanded" as "expanded" | "collapsed",
    isMobile: false,
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    "aria-current": ariaCurrent,
  }: {
    children: ReactNode;
    href: string;
    "aria-current"?: "page";
  }) => (
    <a href={href} aria-current={ariaCurrent}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/ui/sidebar", async () => ({
  ...(await vi.importActual<typeof import("@/components/ui/sidebar")>(
    "@/components/ui/sidebar",
  )),
  SidebarMenuButton: ({
    children,
    asChild,
  }: {
    children: ReactNode;
    asChild?: boolean;
  }) =>
    asChild === true && isValidElement(children) ? children : <>{children}</>,
  useSidebar: () => sidebarMock,
  SidebarMenu: ({ children }: { children: ReactNode }) => <ul>{children}</ul>,
  SidebarMenuItem: ({ children }: { children: ReactNode }) => (
    <li>{children}</li>
  ),
  SidebarRailSelectionBar: () => <span data-testid="rail-selection-bar" />,
}));

vi.mock("@/components/ui/sheet", () => ({
  SheetClose: ({
    children,
    asChild,
  }: {
    children: ReactNode;
    asChild?: boolean;
  }) =>
    asChild === true && isValidElement(children) ? children : <>{children}</>,
}));

// Content inline rather than on hover: when the card opens belongs to the
// primitive. These rows decide whether there is a card and what it holds.
vi.mock("@/components/ui/hover-card", () => ({
  HoverCard: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  HoverCardTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  HoverCardContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="rail-flyout-content">{children}</div>
  ),
}));

function unreadThread(id: string, unreadMentionCount = 0) {
  return {
    parentMessageId: id,
    firstUnreadReplyId: `${id}-reply`,
    parentContent: `Thread ${id}`,
    unreadReplyCount: 2,
    unreadMentionCount,
  };
}

function renderRows(rooms: ChatRoom[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ChatUnreadNavRows
        rooms={rooms}
        currentUserId="user-1"
        dismissSheetOnNavigate={false}
      />
    </NextIntlClientProvider>,
  );
}

function threadsLink() {
  const link = screen
    .getAllByRole("link")
    .find((candidate) => candidate.getAttribute("href") === "/chat/threads");
  if (!link) throw new Error("no Threads link");
  return link;
}

beforeEach(() => {
  navigation.pathname = "/chat/rooms/room-1";
  sidebarMock.state = "expanded";
});

describe("ChatUnreadNavRows", () => {
  it("links to the Threads and All unreads views", () => {
    renderRows([]);

    expect(threadsLink()).toHaveAttribute("href", "/chat/threads");
    expect(screen.getByRole("link", { name: "All unreads" })).toHaveAttribute(
      "href",
      "/chat/unreads",
    );
  });

  it("counts unread Threads across rooms, not their replies", () => {
    const { container } = renderRows([
      makeRoom({
        id: "a",
        unreadThreadCount: 2,
        threadUnreadCount: 7,
        unreadThreads: [unreadThread("a1"), unreadThread("a2")],
      }),
      makeRoom({
        id: "b",
        unreadThreadCount: 1,
        threadUnreadCount: 1,
        unreadThreads: [unreadThread("b1")],
      }),
    ]);

    expect(
      container.querySelector('[data-slot="unread-threads-count"]'),
    ).toHaveTextContent("3");
    expect(threadsLink()).toHaveTextContent("3 unread threads");
  });

  it("draws the @ pill when a Thread names the reader", () => {
    const { container } = renderRows([
      makeRoom({
        unreadThreadCount: 2,
        unreadThreads: [unreadThread("a1", 1), unreadThread("a2")],
      }),
    ]);

    const count = container.querySelector('[data-slot="unread-threads-count"]');
    expect(
      count?.querySelector('[data-slot="mention-pill"]'),
    ).toHaveTextContent("1");
    expect(threadsLink()).toHaveTextContent("1 mention, 2 unread threads");
  });

  it("shows no count when nothing is unread, or only in a muted room", () => {
    const { container } = renderRows([
      makeRoom({
        unreadThreadCount: 3,
        unreadThreads: [unreadThread("a1")],
        mutedAt: new Date("2026-09-01T00:00:00.000Z"),
      }),
    ]);

    expect(
      container.querySelector('[data-slot="unread-threads-count"]'),
    ).toBeNull();
  });

  it("lists the Threads with their rooms in the collapsed rail's flyout", () => {
    sidebarMock.state = "collapsed";
    renderRows([
      makeRoom({
        id: "a",
        name: "sokosumi",
        unreadThreadCount: 7,
        unreadThreads: [unreadThread("a1")],
      }),
    ]);

    const flyout = screen.getByTestId("rail-flyout-content");
    const row = within(flyout).getByRole("link", { name: /Thread a1/ });
    expect(row).toHaveAttribute("href", "/chat/rooms/a?message=a1-reply");
    expect(row).toHaveTextContent("#sokosumi");
    expect(
      within(flyout).getByRole("link", { name: "6 more unread threads" }),
    ).toHaveAttribute("href", "/chat/threads");
  });

  it("marks the entry the reader is on", () => {
    navigation.pathname = "/chat/threads";
    renderRows([]);

    expect(threadsLink()).toHaveAttribute("aria-current", "page");
  });
});
