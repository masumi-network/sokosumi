import type { ChatRoom } from "@sokosumi/core-client";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import {
  type ComponentProps,
  cloneElement,
  isValidElement,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/../messages/en.json";
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

// Every prop through, as the real link does: the row's flyout handlers,
// `aria-expanded` and its ref ride on it.
vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: { children: ReactNode } & ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock("@/components/ui/sidebar", async () => ({
  ...(await vi.importActual<typeof import("@/components/ui/sidebar")>(
    "@/components/ui/sidebar",
  )),
  // The primitive's `cn` merge, reduced to the part these rows rely on: the
  // row's own classes land on the element it renders. Its rail tooltip
  // lands there as data-tooltip.
  SidebarMenuButton: ({
    children,
    asChild,
    className,
    tooltip,
  }: {
    children: ReactNode;
    asChild?: boolean;
    className?: string;
    tooltip?: string;
  }) =>
    asChild === true && isValidElement<{ className?: string }>(children) ? (
      cloneElement(children, {
        className: [children.props.className, className]
          .filter(Boolean)
          .join(" "),
        ...(tooltip ? { "data-tooltip": tooltip } : {}),
      })
    ) : (
      <>{children}</>
    ),
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
        dismissSheetOnNavigate={false}
        unreadOnly={filter.unreadOnly ?? false}
        onUnreadOnlyChange={filter.onUnreadOnlyChange ?? vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

/** The one Catch up row. */
function catchUpRow() {
  return screen.getByTestId("chat-catch-up-row");
}

beforeEach(() => {
  vi.clearAllMocks();
  sidebarMock.isMobile = false;
  markAllActionMock.mockResolvedValue({ ok: true, value: null });
  navigation.pathname = "/chat/rooms/room-1";
  sidebarMock.state = "expanded";
});

describe("ChatUnreadNavRows", () => {
  it("is one link to Catch up, which holds the overview and the Threads", () => {
    renderRows([makeRoom({ unreadThreadCount: 1 })]);

    expect(catchUpRow()).toHaveAttribute("href", "/chat/catch-up");
    expect(screen.queryByRole("link", { name: /Threads/ })).toBeNull();
  });

  it("leads with what needs the reader, over the Threads count", () => {
    const { container } = renderRows([
      makeRoom({ id: "a", unreadNeedsYouCount: 2 }),
      makeRoom({
        id: "b",
        unreadThreadCount: 1,
        unreadThreads: [unreadThread("b1")],
      }),
    ]);

    expect(
      container.querySelector('[data-slot="catch-up-count"]'),
    ).toHaveTextContent("2");
    expect(catchUpRow()).toHaveTextContent("2 messages need you");
  });

  it("toggles the All unreads filter rather than navigating", async () => {
    const onUnreadOnlyChange = vi.fn();
    renderRows([], { onUnreadOnlyChange });

    const toggle = screen.getByRole("button", { name: "Unreads" });
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
    const toggle = screen.getByRole("button", { name: "Unreads" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    // A mode, not the page the reader is on: tinted, never the grey fill.
    expect(toggle).toHaveAttribute("data-filter-on", "true");
    expect(toggle.className).toContain("bg-primary-quaternary");
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
      container.querySelector('[data-slot="catch-up-count"]'),
    ).toHaveTextContent("3");
    expect(catchUpRow()).toHaveTextContent("3 unread threads");
  });

  it("draws the @ pill when a Thread names the reader", () => {
    const { container } = renderRows([
      makeRoom({
        unreadThreadCount: 2,
        unreadThreads: [unreadThread("a1", 1), unreadThread("a2")],
      }),
    ]);

    const count = container.querySelector('[data-slot="catch-up-count"]');
    expect(
      count?.querySelector('[data-slot="mention-pill"]'),
    ).toHaveTextContent("1");
    expect(catchUpRow()).toHaveTextContent("1 mention, 2 unread threads");
  });

  it("shows no count when nothing is unread, or only in a muted room", () => {
    const { container } = renderRows([
      makeRoom({
        unreadThreadCount: 3,
        unreadThreads: [unreadThread("a1")],
        mutedAt: new Date("2026-09-01T00:00:00.000Z"),
      }),
    ]);

    expect(container.querySelector('[data-slot="catch-up-count"]')).toBeNull();
  });

  it("marks the entry the reader is on", () => {
    sidebarMock.isMobile = true;
    navigation.pathname = "/chat/catch-up";
    renderRows([]);

    expect(catchUpRow()).toHaveAttribute("aria-current", "page");
  });

  describe("keyboard shortcut (SOK-1201)", () => {
    const originalNavigator = global.navigator;

    function mockUserAgent(userAgent: string) {
      Object.defineProperty(global, "navigator", {
        value: { userAgent },
        configurable: true,
      });
    }

    afterEach(() => {
      Object.defineProperty(global, "navigator", {
        value: originalNavigator,
        configurable: true,
      });
    });

    function pressUnreadsShortcut(modifiers: {
      metaKey?: boolean;
      ctrlKey?: boolean;
      shiftKey?: boolean;
      altKey?: boolean;
      repeat?: boolean;
    }) {
      const event = new KeyboardEvent("keydown", {
        key: "U",
        bubbles: true,
        cancelable: true,
        ...modifiers,
      });
      const preventDefault = vi.spyOn(event, "preventDefault");
      window.dispatchEvent(event);
      return preventDefault;
    }

    it("toggles the filter with ⌘⇧U on Apple platforms", () => {
      mockUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      );
      const onUnreadOnlyChange = vi.fn();
      renderRows([], { onUnreadOnlyChange });

      expect(screen.getByRole("button", { name: "Unreads" })).toHaveAttribute(
        "aria-keyshortcuts",
        "Meta+Shift+U",
      );
      expect(screen.getByRole("button", { name: "Unreads" })).toHaveAttribute(
        "title",
        "Unreads (⌘⇧U)",
      );
      const preventDefault = pressUnreadsShortcut({
        metaKey: true,
        shiftKey: true,
      });

      expect(onUnreadOnlyChange).toHaveBeenCalledWith(true);
      expect(preventDefault).toHaveBeenCalled();
    });

    it("takes Ctrl+Shift+U, not the ⌘ form, on other platforms", () => {
      mockUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      );
      const onUnreadOnlyChange = vi.fn();
      renderRows([], { onUnreadOnlyChange });

      expect(screen.getByRole("button", { name: "Unreads" })).toHaveAttribute(
        "aria-keyshortcuts",
        "Control+Shift+U",
      );
      pressUnreadsShortcut({ metaKey: true, shiftKey: true });
      expect(onUnreadOnlyChange).not.toHaveBeenCalled();

      pressUnreadsShortcut({ ctrlKey: true, shiftKey: true });
      expect(onUnreadOnlyChange).toHaveBeenCalledWith(true);
    });

    it("turns the filter off from the keyboard too", () => {
      mockUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      );
      const onUnreadOnlyChange = vi.fn();
      renderRows([], { unreadOnly: true, onUnreadOnlyChange });

      pressUnreadsShortcut({ metaKey: true, shiftKey: true });
      expect(onUnreadOnlyChange).toHaveBeenCalledWith(false);
    });

    it("stands down while typing, without shift, with alt or on repeat", () => {
      mockUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      );
      const onUnreadOnlyChange = vi.fn();
      renderRows([], { onUnreadOnlyChange });

      // ⌘U alone stays the browser's and the composer's.
      pressUnreadsShortcut({ metaKey: true });
      pressUnreadsShortcut({ metaKey: true, shiftKey: true, altKey: true });
      pressUnreadsShortcut({ metaKey: true, shiftKey: true, repeat: true });
      expect(onUnreadOnlyChange).not.toHaveBeenCalled();

      // The composer's case: the event an editable target received.
      const input = document.createElement("input");
      document.body.append(input);
      input.focus();
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "U",
          bubbles: true,
          cancelable: true,
          metaKey: true,
          shiftKey: true,
        }),
      );
      input.remove();
      expect(onUnreadOnlyChange).not.toHaveBeenCalled();
    });

    it("stays unbound below the mobile breakpoint", () => {
      mockUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      );
      sidebarMock.isMobile = true;
      const onUnreadOnlyChange = vi.fn();
      renderRows([], { onUnreadOnlyChange });

      expect(
        screen.getByRole("button", { name: "Unreads" }),
      ).not.toHaveAttribute("aria-keyshortcuts");
      pressUnreadsShortcut({ metaKey: true, shiftKey: true });
      expect(onUnreadOnlyChange).not.toHaveBeenCalled();
    });
  });
});
