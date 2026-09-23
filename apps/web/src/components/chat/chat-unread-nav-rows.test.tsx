import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/../messages/en.json";
import type { ChatRoom } from "@/lib/clients/generated/core";
import { makeRoom } from "./__tests__/chat-room-fixtures";
import { ChatUnreadNavRows } from "./chat-unread-nav-rows";

const { markAllActionMock, notifyMock } = vi.hoisted(() => ({
  markAllActionMock: vi.fn(),
  notifyMock: vi.fn(),
}));

vi.mock("@/app/chat/actions", () => ({
  markAllChatUnreadReadAction: (...args: unknown[]) =>
    markAllActionMock(...args),
}));

vi.mock("@/components/chat/organization-chat-events", () => ({
  notifyOrganizationChatRoomsChanged: (...args: unknown[]) =>
    notifyMock(...args),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

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

function renderRows(
  rooms: ChatRoom[],
  filter: {
    unreadOnly?: boolean;
    onUnreadOnlyChange?: (unreadOnly: boolean) => void;
  } = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ChatUnreadNavRows
        rooms={rooms}
        currentUserId="user-1"
        dismissSheetOnNavigate={false}
        unreadOnly={filter.unreadOnly ?? false}
        onUnreadOnlyChange={filter.onUnreadOnlyChange ?? vi.fn()}
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
  vi.clearAllMocks();
  markAllActionMock.mockResolvedValue({ ok: true, value: null });
  navigation.pathname = "/chat/rooms/room-1";
  sidebarMock.state = "expanded";
});

describe("ChatUnreadNavRows", () => {
  it("links to the Threads view", () => {
    renderRows([]);

    expect(threadsLink()).toHaveAttribute("href", "/chat/threads");
  });

  it("toggles the All unreads filter rather than navigating", async () => {
    const onUnreadOnlyChange = vi.fn();
    renderRows([], { onUnreadOnlyChange });

    const toggle = screen.getByRole("button", { name: "All unreads" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(toggle);

    expect(onUnreadOnlyChange).toHaveBeenCalledWith(true);
  });

  it("offers Mark all as read only while the filter is on", async () => {
    const rooms = [
      makeRoom({ id: "channel", unreadCount: 2, channelUnreadCount: 2 }),
      makeRoom({
        id: "threads",
        unreadCount: 1,
        channelUnreadCount: 0,
        threadUnreadCount: 1,
        unreadThreadCount: 1,
        unreadThreads: [unreadThread("t1")],
      }),
      makeRoom({ id: "read", channelUnreadCount: 0 }),
    ];
    const { unmount } = renderRows(rooms);
    expect(
      screen.queryByRole("button", { name: "Mark all as read" }),
    ).toBeNull();
    unmount();

    renderRows(rooms, { unreadOnly: true });
    expect(
      screen.getByRole("button", { name: /^All unreads/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(
      screen.getByRole("button", { name: "Mark all as read" }),
    );

    await waitFor(() =>
      expect(notifyMock).toHaveBeenCalledWith({ collections: ["active"] }),
    );
    expect(markAllActionMock).toHaveBeenCalledWith([
      { roomId: "channel", readRoom: true, lookThreads: false },
      { roomId: "threads", readRoom: false, lookThreads: true },
    ]);
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
