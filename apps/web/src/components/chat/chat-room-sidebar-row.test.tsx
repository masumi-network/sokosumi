import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  cloneElement,
  createContext,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useContext,
  useState,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_CHATS_LIST_PATH,
  chatRoomEditHref,
} from "@/app/chat/utils/chat-route-base";
import type { ChatRoom } from "@/lib/clients/generated/core";
import { makeRoom, makeUser } from "./__tests__/chat-room-fixtures";
import { DirectRoomAvatarStack } from "./direct-room-avatar-stack";

const {
  leaveRoomActionMock,
  replaceMock,
  pushMock,
  refreshMock,
  notifyMock,
  showRoomUnreadCountMock,
  roomSearchParams,
} = vi.hoisted(() => ({
  leaveRoomActionMock: vi.fn(),
  replaceMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  notifyMock: vi.fn(),
  showRoomUnreadCountMock: vi.fn(() => false),
  roomSearchParams: { current: new URLSearchParams() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: pushMock,
    refresh: refreshMock,
  }),
  useSearchParams: () => roomSearchParams.current,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    className,
    tabIndex,
  }: {
    children: ReactNode;
    href: string;
    className?: string;
    tabIndex?: number;
  }) => (
    <a href={href} className={className} tabIndex={tabIndex}>
      {children}
    </a>
  ),
}));

// The row's two numbers and the rail pill's two states resolve by full key
// path, so a typo in the namespace fails here instead of passing on a bare key
// that happens to match. The real
// catalog and the real ICU plurals are bound in
// `__tests__/chat-room-sidebar-row-messages.test.tsx`.
vi.mock("next-intl", () => ({
  useTranslations:
    (namespace?: string) =>
    (key: string, values?: Record<string, string | number>) => {
      const catalogKeys: Record<string, string> = {
        "App.Channels.RoomUnread.unreadMessages": `${values?.count ?? ""} unread messages`,
        "App.Channels.RoomUnread.unreadMessagesCapped": `More than ${values?.max ?? ""} unread messages`,
        "App.Channels.RoomMentions.mentions": `${values?.count ?? ""} mentions`,
        "App.Channels.RoomMentions.mentionsCapped": `More than ${values?.max ?? ""} mentions`,
        "App.Channels.RoomUnread.railUnread": "Unread",
        "App.Channels.RoomMentions.railMention": "Mentions you",
      };
      const catalogValue = catalogKeys[`${namespace ?? ""}.${key}`];
      if (catalogValue !== undefined) {
        return catalogValue;
      }

      const translations: Record<string, string> = {
        leave: "Leave channel",
        leaveConfirmTitle: `Leave ${values?.name ?? ""}?`,
        leaveConfirmDescription: `Leave description for ${values?.name ?? ""}`,
        leaveConfirm: "Leave channel",
        leaveSuccess: `You left ${values?.name ?? ""}.`,
        cancel: "Cancel",
        markUnread: "Mark as unread",
        editChannel: "Edit channel",
        pin: "Pin",
        unpin: "Unpin",
        mute: "Mute",
        unmute: "Unmute",
        roomMenu: `Chat actions for ${values?.name ?? ""}`,
        actionFailed: "Could not update this chat. Try again.",
      };
      return translations[key] ?? key;
    },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/app/chat/actions", () => ({
  leaveRoomAction: (...args: unknown[]) => leaveRoomActionMock(...args),
}));

vi.mock("@/components/chat/use-show-room-unread-count", () => ({
  useShowRoomUnreadCount: () => showRoomUnreadCountMock(),
}));

vi.mock("@/components/chat/organization-chat-events", () => ({
  notifyOrganizationChatRoomsChanged: (...args: unknown[]) =>
    notifyMock(...args),
}));

vi.mock("@/components/chat/organization-chat-list.actions", () => ({
  markOrganizationChatRoomUnreadAction: vi.fn(),
  muteOrganizationChatRoomAction: vi.fn(),
  pinOrganizationChatRoomAction: vi.fn(),
  unmuteOrganizationChatRoomAction: vi.fn(),
  unpinOrganizationChatRoomAction: vi.fn(),
}));

vi.mock("@/components/ui/sheet", () => ({
  SheetClose: ({
    children,
    asChild,
  }: {
    children: ReactNode;
    asChild?: boolean;
  }) => (asChild && isValidElement(children) ? children : <>{children}</>),
}));

// Expanded unless a test collapses it. The row asks only to choose between its
// name tooltip and the unread threads flyout.
const sidebarMock = vi.hoisted(() => ({
  state: "expanded" as "expanded" | "collapsed",
  isMobile: false,
}));

// Content inline rather than on hover: when the card opens belongs to the
// primitive. This row decides whether there is a card and what it holds.
vi.mock("@/components/ui/hover-card", () => ({
  HoverCard: ({ children }: { children: ReactNode }) => (
    <div data-testid="rail-flyout">{children}</div>
  ),
  HoverCardTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  HoverCardContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="rail-flyout-content">{children}</div>
  ),
}));

// The real module under the overrides, so `SidebarRowSlot` — the shared
// leading slot every row sits its mark in — is the one the app ships.
vi.mock("@/components/ui/sidebar", async () => ({
  ...(await vi.importActual<typeof import("@/components/ui/sidebar")>(
    "@/components/ui/sidebar",
  )),
  // `className` rides the wrapper: the row's height is what this component
  // decides and the real primitive merges, so a mock that swallowed it would
  // leave the one exception to the row height rule untested.
  SidebarMenuButton: ({
    children,
    asChild,
    tooltip,
    className,
  }: {
    children: ReactNode;
    asChild?: boolean;
    tooltip?: string;
    className?: string;
  }) => (
    <div
      data-testid="sidebar-menu-button"
      data-tooltip={tooltip}
      className={className}
    >
      {asChild && isValidElement(children) ? children : <div>{children}</div>}
    </div>
  ),
  SidebarMenuItem: ({ children }: { children: ReactNode }) => (
    <li>{children}</li>
  ),
  useSidebar: () => sidebarMock,
  // A marker, not the real bar: what it looks like belongs to the primitive
  // that owns it, and `sidebar-rail-selection.test.tsx` pins that. This row
  // only decides when it is there.
  SidebarRailSelectionBar: () => <span data-testid="rail-selection-bar" />,
}));

vi.mock("@/components/ui/dropdown-menu", () => {
  interface DropdownMenuContextValue {
    open: boolean;
    setOpen: (open: boolean) => void;
  }

  const DropdownMenuContext = createContext<DropdownMenuContextValue | null>(
    null,
  );

  function DropdownMenu({ children }: { children: ReactNode }) {
    const [open, setOpen] = useState(false);
    return (
      <DropdownMenuContext.Provider value={{ open, setOpen }}>
        <div>{children}</div>
      </DropdownMenuContext.Provider>
    );
  }

  function DropdownMenuTrigger({
    children,
    asChild,
  }: {
    children: ReactNode;
    asChild?: boolean;
  }) {
    const context = useContext(DropdownMenuContext);
    if (!context) return null;

    const handleClick = () => {
      context.setOpen(!context.open);
    };

    if (asChild && isValidElement(children)) {
      return cloneElement(children as ReactElement<{ onClick?: () => void }>, {
        onClick: handleClick,
      });
    }

    return (
      <button type="button" onClick={handleClick}>
        {children}
      </button>
    );
  }

  function DropdownMenuContent({ children }: { children: ReactNode }) {
    const context = useContext(DropdownMenuContext);
    if (!context?.open) return null;
    return <div>{children}</div>;
  }

  function DropdownMenuItem({
    children,
    onSelect,
    disabled,
  }: {
    children: ReactNode;
    onSelect?: () => void;
    disabled?: boolean;
  }) {
    return (
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          onSelect?.();
        }}
      >
        {children}
      </button>
    );
  }

  function DropdownMenuSeparator() {
    return <div data-slot="dropdown-menu-separator" />;
  }

  return {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
  };
});

vi.mock("@/components/ui/alert-dialog", () => {
  function AlertDialog({
    open,
    children,
  }: {
    open: boolean;
    children: ReactNode;
  }) {
    return open ? <div role="alertdialog">{children}</div> : null;
  }

  function Passthrough({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }

  function AlertDialogAction({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode;
    onClick?: (event: { preventDefault: () => void }) => void;
    disabled?: boolean;
  }) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          onClick?.({
            preventDefault: () => undefined,
          })
        }
      >
        {children}
      </button>
    );
  }

  function AlertDialogCancel({
    children,
    disabled,
  }: {
    children: ReactNode;
    disabled?: boolean;
  }) {
    return (
      <button type="button" disabled={disabled}>
        {children}
      </button>
    );
  }

  return {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent: Passthrough,
    AlertDialogDescription: ({ children }: { children: ReactNode }) => (
      <p>{children}</p>
    ),
    AlertDialogFooter: Passthrough,
    AlertDialogHeader: Passthrough,
    AlertDialogTitle: ({ children }: { children: ReactNode }) => (
      <h2>{children}</h2>
    ),
  };
});

import { toast } from "sonner";
import { ChatRoomSidebarRow } from "./chat-room-sidebar-row";
import { markOrganizationChatRoomUnreadAction } from "./organization-chat-list.actions";
import {
  applyRoomReadOverlays,
  beginRoomAttentionChange,
  beginRoomAttentionRefresh,
  clearRoomReadOverlays,
  reconcileRoomAttention,
  rememberRoomRead,
  settleRoomAttentionChange,
} from "./room-read-overlay";

async function openRoomMenu(label = "general") {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: `Chat actions for ${label}` }),
  );
  return user;
}

describe("ChatRoomSidebarRow tooltip", () => {
  it("names the room on the sidebar button so the collapsed rail can show it", () => {
    render(
      <ChatRoomSidebarRow
        room={makeRoom()}
        href="/chat/rooms/room-1"
        label="general"
        isActive={false}
        leading={<span />}
        onRoomUpdated={vi.fn()}
      />,
    );

    expect(screen.getByTestId("sidebar-menu-button")).toHaveAttribute(
      "data-tooltip",
      "general",
    );
  });
});

describe("ChatRoomSidebarRow leading slot", () => {
  it("wraps any room leading icon in the shared 24px slot", () => {
    const { container } = render(
      <ChatRoomSidebarRow
        room={makeRoom()}
        href="/chat/rooms/room-1"
        label="general"
        isActive={false}
        leading={<span data-testid="custom-leading">#</span>}
        onRoomUpdated={vi.fn()}
      />,
    );

    const leading = screen.getByTestId("custom-leading");
    const slot = leading.parentElement;
    expect(slot).not.toBeNull();
    // The slot the sidebar primitive owns, not a box this row builds: one
    // size in both states, so the mark cannot resize or slide on a toggle.
    expect(slot?.getAttribute("data-slot")).toBe("sidebar-row-slot");
    const tokens = slot?.className.split(" ") ?? [];
    expect(tokens).toContain("h-6");
    expect(tokens).toContain("min-w-6");
    expect(tokens).toContain("shrink-0");
    expect(tokens).toContain("items-center");
    expect(tokens).toContain("justify-center");
    expect(slot?.className).not.toContain("group-data-[collapsible=icon]:");

    // Slot is a direct child of the room link so every room type shares the same column.
    const link = container.querySelector('a[href="/chat/rooms/room-1"]');
    expect(link?.firstElementChild).toBe(slot);
  });
});

describe("ChatRoomSidebarRow row height", () => {
  function heightTokens(props: { subtitle?: string }) {
    const { container } = render(
      <ChatRoomSidebarRow
        room={makeRoom()}
        href="/chat/rooms/room-1"
        label="general"
        isActive={false}
        leading={<span data-testid="custom-leading">#</span>}
        onRoomUpdated={vi.fn()}
        {...props}
      />,
    );
    // The primitive merges this onto the row's own classes; the mock keeps it
    // on the wrapper so the row's own decision is what is asserted.
    return (
      container
        .querySelector('[data-testid="sidebar-menu-button"]')
        ?.className.split(/\s+/)
        .filter(Boolean) ?? []
    );
  }

  it("adds nothing to the row primitive's height on an ordinary room", () => {
    // `h-11 md:h-8` lives on `sidebarMenuButtonVariants`, pinned by
    // `ui/__tests__/sidebar-rail-selection.test.tsx`. A room row used to
    // restate it here, which is how the two could drift apart.
    expect(heightTokens({})).toEqual([]);
  });

  it("lets a guest row grow for its host organisation line, at both sizes", () => {
    const tokens = heightTokens({ subtitle: "Hosted by Acme" });
    // One of the three items allowed to differ between states. `md:h-auto`
    // matters as much as `h-auto`: the row primitive's height is `h-11
    // md:h-8`, and lifting only the unprefixed one leaves the desktop row
    // pinned at 32px with the second line clipped by its `overflow-hidden`.
    expect(tokens).toContain("h-auto");
    expect(tokens).toContain("md:h-auto");
    expect(tokens).toContain("min-h-11");
    expect(tokens).toContain("md:min-h-8");
    expect(tokens).not.toContain("h-11");
    expect(tokens).not.toContain("md:h-8");
  });
});

describe("ChatRoomSidebarRow collapsed rail", () => {
  it("centres a 24px leading mark and keeps the name for assistive tech", () => {
    const { container } = render(
      <ChatRoomSidebarRow
        room={makeRoom()}
        href="/chat/rooms/room-1"
        label="general"
        isActive={false}
        leading={<span data-testid="custom-leading">#</span>}
        onRoomUpdated={vi.fn()}
      />,
    );

    const link = container.querySelector('a[href="/chat/rooms/room-1"]');
    // The menu button clips its content for name truncation. Collapsed, the
    // 20px tile's corner mark hangs 4px below it inside a 32px button, so the
    // clip has to lift there or the lock and globe lose their bottom.
    expect(link?.className).toContain(
      "group-data-[collapsible=icon]:overflow-visible",
    );
    // Dropping the padding and centring the mark is the row primitive's job
    // now; `ui/__tests__/sidebar-rail-selection.test.tsx` pins it there.
    expect(link?.className).not.toContain("px-3");

    const slot = screen.getByTestId("custom-leading").parentElement;
    expect(slot?.className).toContain("min-w-6");

    // The name must stay in the accessible name (the tooltip adds none) while
    // taking no flex space at rest, so the shared label class, never `hidden`.
    // The spacer would otherwise pull the mark off centre on touch.
    const name = screen.getByText("general");
    expect(name.parentElement?.className.split(/\s+/)).toContain(
      "group-data-[collapsible=icon]:max-w-0",
    );
    expect(name.parentElement?.className.split(/\s+/)).not.toContain(
      "group-data-[collapsible=icon]:sr-only",
    );
    expect(
      container.querySelector('[data-slot="room-trailing-spacer"]')?.className,
    ).toContain("group-data-[collapsible=icon]:hidden");
  });

  // The rail attention pill: the one cue left once bold, count, and badge hide.
  function renderRail(
    room: Partial<ChatRoom>,
    options: { isActive?: boolean; leading?: ReactNode } = {},
  ) {
    const { container } = render(
      <ChatRoomSidebarRow
        room={makeRoom(room)}
        href="/chat/rooms/room-1"
        label="general"
        isActive={options.isActive ?? false}
        leading={options.leading ?? <span>#</span>}
        onRoomUpdated={vi.fn()}
      />,
    );
    return container.querySelector('[data-slot="room-rail-attention"]');
  }

  it("shows the unread pill for an unread room, in the collapsed rail only", () => {
    const pill = renderRail({ unreadCount: 3 });
    expect(pill?.getAttribute("data-variant")).toBe("unread");
    // Rendered always, shown only collapsed, like the channel tile.
    expect(pill?.className).toContain("hidden");
    expect(pill?.className).toContain("group-data-[collapsible=icon]:block");
    // 6px unread, on the rail's edge outside the link's overflow clip.
    expect(pill?.className).toContain("h-1.5");
    expect(pill?.className).toContain("-left-2");
    expect(
      document.querySelector('a[href="/chat/rooms/room-1"]')?.contains(pill),
    ).toBe(false);
    // The state is announced inside the link, collapsed only.
    const text = screen.getByText("Unread");
    expect(text.className).toContain("sr-only");
    expect(text.className).toContain("hidden");
    expect(text.className).toContain("group-data-[collapsible=icon]:block");
    expect(
      document.querySelector('a[href="/chat/rooms/room-1"]')?.contains(text),
    ).toBe(true);
  });

  it("shows the taller mention pill when the reader is mentioned", () => {
    const pill = renderRail({ unreadMentionCount: 2 });
    expect(pill?.getAttribute("data-variant")).toBe("mention");
    expect(pill?.className).toContain("h-2");
    expect(screen.getByText("Mentions you").className).toContain("sr-only");
  });

  it("shows exactly one pill, the mention one, when mention and unread meet", () => {
    const pill = renderRail({ unreadCount: 5, unreadMentionCount: 2 });
    expect(pill?.getAttribute("data-variant")).toBe("mention");
    expect(screen.queryByText("Unread")).toBeNull();
    expect(
      document.querySelectorAll('[data-slot="room-rail-attention"]'),
    ).toHaveLength(1);
  });

  it("shows the unread pill for a room the reader marked unread by hand", () => {
    expect(
      renderRail({ markedUnread: true })?.getAttribute("data-variant"),
    ).toBe("unread");
  });

  it("shows no pill for a read room", () => {
    expect(renderRail({})).toBeNull();
  });

  // ADR-0037: Thread replies stop marking the channel.
  it("shows no pill for a room whose only unread is in threads", () => {
    expect(
      renderRail({
        unreadCount: 3,
        channelUnreadCount: 0,
        threadUnreadCount: 3,
      }),
    ).toBeNull();
    expect(screen.queryByText("Unread")).toBeNull();
  });

  it("shows the mention pill when a thread reply names the reader", () => {
    const pill = renderRail({
      unreadCount: 1,
      channelUnreadCount: 0,
      threadUnreadCount: 1,
      unreadMentionCount: 1,
    });
    expect(pill?.getAttribute("data-variant")).toBe("mention");
  });

  it("shows no pill for a muted room however loud it is", () => {
    expect(
      renderRail({
        unreadCount: 9,
        unreadMentionCount: 4,
        markedUnread: true,
        mutedAt: new Date("2026-09-01T00:00:00.000Z"),
      }),
    ).toBeNull();
  });

  it("keeps the pill on the room the reader has open", () => {
    expect(
      renderRail({ unreadCount: 1 }, { isActive: true })?.getAttribute(
        "data-variant",
      ),
    ).toBe("unread");
  });

  // The pill belongs to the row, so a Direct gets it with no wiring of its
  // own, and it sits beside the real avatar stack rather than on it: the face
  // keeps its presence dot to itself.
  it("marks a Direct beside its avatar the same way as a Channel", () => {
    const room = makeRoom({ kind: "direct", unreadMentionCount: 1 });
    const pill = renderRail(room, {
      leading: <DirectRoomAvatarStack room={room} currentUserId="user-1" />,
    });
    expect(pill?.getAttribute("data-variant")).toBe("mention");
    const face = screen.getByTestId("dm-sidebar-avatar-user-2");
    expect(face).toBeInTheDocument();
    expect(face.parentElement?.contains(pill)).toBe(false);
  });
});

// The rail selection bar: the row's job is when it shows, not how it looks.
describe("ChatRoomSidebarRow unread threads", () => {
  const unreadThread = {
    parentMessageId: "550e8400-e29b-41d4-a716-446655440b01",
    firstUnreadReplyId: "550e8400-e29b-41d4-a716-446655440c01",
    parentContent: "Vendor-wide rollout",
    unreadReplyCount: 2,
  };

  function renderRoom(room: Partial<ChatRoom>) {
    render(
      <ChatRoomSidebarRow
        room={makeRoom(room)}
        href="/chat/rooms/room-1"
        label="general"
        isActive={false}
        leading={<span>#</span>}
        onRoomUpdated={vi.fn()}
      />,
    );
  }

  it("lists a room's unread threads under its row", () => {
    renderRoom({
      threadUnreadCount: 2,
      unreadThreadCount: 1,
      unreadThreads: [unreadThread],
    });

    expect(
      document.querySelector('[data-slot="room-thread-rows"]'),
    ).not.toBeNull();
    expect(screen.getByText("Vendor-wide rollout")).toBeInTheDocument();
  });

  // The trailing cluster is centred on its positioned ancestor. Were that the
  // whole item, the badge and the menu would land on the inset rows.
  it("keeps the row's trailing cluster off the inset thread rows", () => {
    renderRoom({
      threadUnreadCount: 2,
      unreadThreadCount: 1,
      unreadThreads: [unreadThread],
    });

    const main = document.querySelector('[data-slot="room-row-main"]');
    expect(
      main?.contains(document.querySelector('[data-slot="room-trailing"]')),
    ).toBe(true);
    expect(
      main?.contains(document.querySelector('[data-slot="room-thread-rows"]')),
    ).toBe(false);
  });

  it("lists nothing while the rows are being reordered", () => {
    render(
      <ChatRoomSidebarRow
        room={makeRoom({
          threadUnreadCount: 2,
          unreadThreadCount: 1,
          unreadThreads: [unreadThread],
        })}
        href="/chat/rooms/room-1"
        label="general"
        isActive={false}
        leading={<span>#</span>}
        onRoomUpdated={vi.fn()}
        reorderHandle={<button type="button">Move</button>}
      />,
    );

    expect(document.querySelector('[data-slot="room-thread-rows"]')).toBeNull();
  });

  it("lists nothing under a room with no unread thread", () => {
    renderRoom({ unreadCount: 2, channelUnreadCount: 2 });

    expect(document.querySelector('[data-slot="room-thread-rows"]')).toBeNull();
  });

  // Room mute outranks everything else a room can hold.
  it("lists nothing under a muted room", () => {
    renderRoom({
      mutedAt: new Date("2026-08-01T00:00:00.000Z"),
      threadUnreadCount: 2,
      unreadThreadCount: 1,
      unreadThreads: [unreadThread],
    });

    expect(document.querySelector('[data-slot="room-thread-rows"]')).toBeNull();
  });
});

// Two marks, and only two. A muted number says how much is unread, the same
// way for a channel, a Direct and a Thread. A primary `@` pill says the reader
// was named. Core counts every message toward the badge in a Direct of two,
// so that row is written to, not named, and draws the number.
describe("ChatRoomSidebarRow mention pill", () => {
  function renderRoom(room: Partial<ChatRoom>) {
    const { container } = render(
      <ChatRoomSidebarRow
        room={makeRoom(room)}
        href="/chat/rooms/room-1"
        label="general"
        isActive={false}
        leading={<span>#</span>}
        onRoomUpdated={vi.fn()}
      />,
    );
    return {
      pill: container.querySelector('[data-slot="room-mention-badge"]'),
      count: container.querySelector('[data-slot="room-unread-count"]'),
    };
  }

  it("marks a channel's mentions with an @ pill", () => {
    const { pill } = renderRoom({ kind: "channel", unreadMentionCount: 2 });

    expect(pill).toHaveTextContent("2");
    expect(pill?.querySelector('[data-slot="mention-glyph"]')).not.toBeNull();
  });

  it("marks a group Direct's mentions with an @ pill", () => {
    const { pill } = renderRoom({
      kind: "direct",
      unreadMentionCount: 2,
      userMembers: [makeUser("a"), makeUser("b"), makeUser("c")],
    });

    expect(pill?.querySelector('[data-slot="mention-glyph"]')).not.toBeNull();
  });

  it("shows a Direct of two the same muted number a channel gets", () => {
    showRoomUnreadCountMock.mockReturnValueOnce(true);
    const { pill, count } = renderRoom({
      kind: "direct",
      unreadCount: 5,
      channelUnreadCount: 5,
      unreadMentionCount: 5,
      userMembers: [makeUser("a"), makeUser("b")],
    });

    expect(pill).toBeNull();
    expect(count).toHaveTextContent("5");
    expect(screen.getByText("5 unread messages")).toBeInTheDocument();
    expect(screen.queryByText("5 mentions")).toBeNull();
  });

  it("draws the @ pill alone on a channel that also has unread messages", () => {
    const { pill, count } = renderRoom({
      kind: "channel",
      unreadCount: 4,
      channelUnreadCount: 3,
      unreadMentionCount: 1,
    });

    expect(pill).toHaveTextContent("1");
    expect(count).toBeNull();
  });

  // The pill shares a 28px hole with the row's menu, and the `@` takes its
  // share, so past nine it is the number that gives way, never the glyph.
  it("shows the exact mention count up to nine", () => {
    const { pill } = renderRoom({ kind: "channel", unreadMentionCount: 9 });

    expect(pill).toHaveTextContent("9");
    expect(pill).not.toHaveTextContent("9+");
  });

  it.each([10, 12, 120])("shows @ 9+ for %i mentions", (unreadMentionCount) => {
    const { pill } = renderRoom({ kind: "channel", unreadMentionCount });

    expect(pill).toHaveTextContent("9+");
    expect(pill?.querySelector('[data-slot="mention-glyph"]')).not.toBeNull();
  });

  it("announces a channel's and a group Direct's count as mentions", () => {
    renderRoom({
      kind: "direct",
      unreadMentionCount: 2,
      userMembers: [makeUser("a"), makeUser("b"), makeUser("c")],
    });

    expect(screen.getByText("2 mentions")).toBeInTheDocument();
  });
});

// The collapsed rail hides the inset rows, so the same rows ride a flyout
// beside the room's mark (ADR-0037).
describe("ChatRoomSidebarRow rail thread flyout", () => {
  const unreadThread = {
    parentMessageId: "550e8400-e29b-41d4-a716-446655440b01",
    firstUnreadReplyId: "550e8400-e29b-41d4-a716-446655440c01",
    parentContent: "Vendor-wide rollout",
    unreadReplyCount: 2,
  };
  const withUnreadThread = {
    threadUnreadCount: 2,
    unreadThreadCount: 1,
    unreadThreads: [unreadThread],
  };

  afterEach(() => {
    sidebarMock.state = "expanded";
    sidebarMock.isMobile = false;
  });

  function renderRoom(room: Partial<ChatRoom>) {
    render(
      <ChatRoomSidebarRow
        room={makeRoom(room)}
        href="/chat/rooms/room-1"
        label="general"
        isActive={false}
        leading={<span>#</span>}
        onRoomUpdated={vi.fn()}
      />,
    );
  }

  it("lists a room's unread threads beside its mark on the collapsed rail", () => {
    sidebarMock.state = "collapsed";
    renderRoom(withUnreadThread);

    const flyout = within(screen.getByTestId("rail-flyout-content"));
    expect(flyout.getByText("general")).toBeInTheDocument();
    expect(
      flyout.getByRole("link", { name: /Vendor-wide rollout/ }),
    ).toHaveAttribute(
      "href",
      "/chat/rooms/room-1?message=550e8400-e29b-41d4-a716-446655440c01",
    );
  });

  // Two floating layers on one hover would cover each other.
  it("stands in for the name tooltip rather than joining it", () => {
    sidebarMock.state = "collapsed";
    renderRoom(withUnreadThread);

    expect(screen.getByTestId("sidebar-menu-button")).not.toHaveAttribute(
      "data-tooltip",
    );
  });

  it("keeps the plain name tooltip for a room with no unread thread", () => {
    sidebarMock.state = "collapsed";
    renderRoom({ unreadCount: 2, channelUnreadCount: 2 });

    expect(screen.queryByTestId("rail-flyout")).toBeNull();
    expect(screen.getByTestId("sidebar-menu-button")).toHaveAttribute(
      "data-tooltip",
      "general",
    );
  });

  it("offers no flyout while the sidebar is expanded", () => {
    renderRoom(withUnreadThread);

    expect(screen.queryByTestId("rail-flyout")).toBeNull();
  });

  it("offers no flyout for a muted room", () => {
    sidebarMock.state = "collapsed";
    renderRoom({
      ...withUnreadThread,
      mutedAt: new Date("2026-08-01T00:00:00.000Z"),
    });

    expect(screen.queryByTestId("rail-flyout")).toBeNull();
  });

  // The phone sheet is never the rail. Its "collapsed" state is the sheet
  // being closed, and a hover card cannot open by touch anyway.
  it("offers no flyout on the phone sheet", () => {
    sidebarMock.state = "collapsed";
    sidebarMock.isMobile = true;
    renderRoom(withUnreadThread);

    expect(screen.queryByTestId("rail-flyout")).toBeNull();
    expect(screen.getByTestId("sidebar-menu-button")).toHaveAttribute(
      "data-tooltip",
      "general",
    );
  });

  // Reorder mode hides the inset rows so rows keep one height under the
  // pointer. The rail keeps that decision: reorder can start expanded and the
  // sidebar be collapsed with it still on.
  it("offers no flyout while the rows are being reordered", () => {
    sidebarMock.state = "collapsed";
    render(
      <ChatRoomSidebarRow
        room={makeRoom(withUnreadThread)}
        href="/chat/rooms/room-1"
        label="general"
        isActive={false}
        leading={<span>#</span>}
        onRoomUpdated={vi.fn()}
        reorderHandle={<button type="button">Move</button>}
      />,
    );

    expect(screen.queryByTestId("rail-flyout")).toBeNull();
  });
});

describe("ChatRoomSidebarRow rail selection bar", () => {
  function renderRow(
    room: Partial<ChatRoom>,
    options: { isActive?: boolean } = {},
  ) {
    render(
      <ChatRoomSidebarRow
        room={makeRoom(room)}
        href="/chat/rooms/room-1"
        label="general"
        isActive={options.isActive ?? false}
        leading={<span>#</span>}
        onRoomUpdated={vi.fn()}
      />,
    );
    return screen.queryByTestId("rail-selection-bar");
  }

  it("marks the room the reader has open", () => {
    expect(renderRow({}, { isActive: true })).toBeInTheDocument();
  });

  it("shows no selection mark on a room the reader does not have open", () => {
    expect(renderRow({})).toBeNull();
  });

  // The two marks sit on opposite edges precisely so this can happen without
  // either having to give way.
  it("marks an unread open room on both edges at once", () => {
    expect(
      renderRow({ unreadMentionCount: 2 }, { isActive: true }),
    ).toBeInTheDocument();
    expect(
      document
        .querySelector('[data-slot="room-rail-attention"]')
        ?.getAttribute("data-variant"),
    ).toBe("mention");
  });
});

describe("ChatRoomSidebarRow trailing cluster", () => {
  it("hides the muted glyph and room menu when the sidebar collapses", () => {
    const { container } = render(
      <ChatRoomSidebarRow
        room={makeRoom({ mutedAt: new Date("2026-09-01T00:00:00.000Z") })}
        href="/chat/rooms/room-1"
        label="general"
        isActive={false}
        leading={<span>#</span>}
        onRoomUpdated={vi.fn()}
      />,
    );

    const cluster = container.querySelector('[data-slot="room-trailing"]');
    expect(cluster).not.toBeNull();
    // Muted glyph and the room menu both live in this one cluster.
    expect(cluster?.querySelector("svg.lucide-bell-off")).not.toBeNull();
    expect(
      cluster?.contains(
        screen.getByRole("button", { name: "Chat actions for general" }),
      ),
    ).toBe(true);
    expect(cluster?.className).toContain(
      "group-data-[collapsible=icon]:hidden",
    );
  });

  it("gives the room menu a 44px touch target below md", () => {
    const { container } = render(
      <ChatRoomSidebarRow
        room={makeRoom()}
        href="/chat/rooms/room-1"
        label="general"
        isActive={false}
        leading={<span>#</span>}
        onRoomUpdated={vi.fn()}
      />,
    );

    // The box stays 32px; the pseudo-element carries it out to 44px.
    const menuTokens =
      container.querySelector("button")?.className.split(" ") ?? [];
    expect(menuTokens).toContain("size-8");
    expect(menuTokens).toContain("after:-inset-1.5");
    expect(menuTokens).toContain("md:after:hidden");
  });

  it("shows no glyph on a pinned row: the Pinned section already says so", () => {
    const { container } = render(
      <ChatRoomSidebarRow
        room={makeRoom({ starredAt: new Date("2026-09-01T00:00:00.000Z") })}
        href="/chat/rooms/room-1"
        label="general"
        isActive={false}
        leading={<span>#</span>}
        onRoomUpdated={vi.fn()}
      />,
    );

    expect(
      container.querySelector('[data-slot="room-trailing"] svg.lucide-pin'),
    ).toBeNull();
  });

  it("keeps the muted glyph in the same size slot as the room menu", () => {
    const { container } = render(
      <ChatRoomSidebarRow
        room={makeRoom({ mutedAt: new Date("2026-09-01T00:00:00.000Z") })}
        href="/chat/rooms/room-1"
        label="general"
        isActive={false}
        leading={<span>#</span>}
        onRoomUpdated={vi.fn()}
      />,
    );

    const glyph = container.querySelector("svg.lucide-bell-off");
    const box = glyph?.parentElement;
    expect(box).not.toBeNull();
    expect(box?.className.split(" ").includes("md:size-7")).toBe(true);
    expect(box?.className).not.toContain("[@media(hover:hover)]:size-4");
  });

  // The hole is sized to the glyph, not the button's 28px box: `size-4` ends
  // the name 8px clear of the `…`. A row that shows something at rest holds it
  // open in every state; a plain row opens it with the button.
  const GLYPH_HOLE = "[@media(hover:hover)]:size-4";
  // Touch shows the badge or the bell beside the menu, so the hole holds two
  // 32px boxes. The badge rides the bell's box, so one width serves both.
  const BADGE_AND_CONTROL_HOLE_TOUCH = "[@media(hover:none)]:w-16";
  const NO_HOLE = "[@media(hover:hover)]:size-0";
  const HOLE_ON_INTERACTION = [
    "[@media(hover:hover)]:group-hover/room-row:size-4",
    "[@media(hover:hover)]:group-focus-within/room-row:size-4",
    "[@media(hover:hover)]:group-has-[[data-state=open]]/room-row:size-4",
  ];

  function spacerTokens(container: HTMLElement) {
    return (
      container
        .querySelector('[data-slot="room-trailing-spacer"]')
        ?.className.split(" ") ?? []
    );
  }

  it.each([
    ["muted", { mutedAt: new Date("2026-09-01T00:00:00.000Z") }, false],
    ["open", {}, true],
  ])(
    "holds the hole open in every state on a %s row, so its name never moves",
    (_state, roomProps, isActive) => {
      const { container } = render(
        <ChatRoomSidebarRow
          room={makeRoom(roomProps)}
          href="/chat/rooms/room-1"
          label="Agent Test Channel"
          isActive={isActive}
          leading={<span>#</span>}
          onRoomUpdated={vi.fn()}
        />,
      );

      const tokens = spacerTokens(container);
      expect(tokens).toContain(GLYPH_HOLE);
      expect(tokens).not.toContain(NO_HOLE);
      // Nothing widens it further, so hovering the row is a no-op on the name.
      for (const token of HOLE_ON_INTERACTION) {
        expect(tokens).not.toContain(token);
      }
      expect(tokens.includes("md:size-7")).toBe(false);
    },
  );

  // The other half of the badge rule: no badge, no hole, full name width.
  it("keeps a plain row's full name width at rest and opens the hole with the button", () => {
    const { container } = render(
      <ChatRoomSidebarRow
        room={makeRoom()}
        href="/chat/rooms/room-1"
        label="Agent Building"
        isActive={false}
        leading={<span>#</span>}
        onRoomUpdated={vi.fn()}
      />,
    );

    // The button is `opacity-0` at rest, so an invisible button needs no hole.
    const tokens = spacerTokens(container);
    expect(tokens).toContain(NO_HOLE);
    expect(tokens).not.toContain(GLYPH_HOLE);
    for (const token of HOLE_ON_INTERACTION) {
      expect(tokens).toContain(token);
    }
    expect(tokens).not.toContain("[@media(hover:none)]:w-16");
  });

  it("opens a muted row's hole to the same width a plain row reaches on hover", () => {
    const { container, rerender } = render(
      <ChatRoomSidebarRow
        room={makeRoom({ mutedAt: new Date("2026-09-01T00:00:00.000Z") })}
        href="/chat/rooms/room-1"
        label="Agent Test Channel"
        isActive={false}
        leading={<span>#</span>}
        onRoomUpdated={vi.fn()}
      />,
    );

    expect(spacerTokens(container)).toContain(GLYPH_HOLE);
    expect(
      container.querySelector('[data-slot="room-trailing-spacer"]')?.className,
    ).toContain("[@media(hover:none)]:w-16");

    rerender(
      <ChatRoomSidebarRow
        room={makeRoom()}
        href="/chat/rooms/room-1"
        label="Agent Building"
        isActive={false}
        leading={<span>#</span>}
        onRoomUpdated={vi.fn()}
      />,
    );

    // Same 16px on both, so a plain row lands where an icon row already sits
    // rather than overshooting it.
    expect(spacerTokens(container)).toContain(
      "[@media(hover:hover)]:group-hover/room-row:size-4",
    );
  });

  // The badge stands in the menu's column and is out of flow, so the hole is
  // the only thing keeping the name off it. A badged row therefore holds the
  // hole open in every state, like a muted row and the open room: the name is
  // shortened once, by the hole the badge and the menu share, and it does not
  // move when they swap. It fails if a badged row ever rests at `size-0`,
  // which would run the name and its count under the badge.
  it.each([
    ["pinned", new Date("2026-09-01T00:00:00.000Z")],
    ["unpinned", null],
  ])(
    "shortens a %s row's name for its mention badge and holds it there",
    (_state, starredAt) => {
      const { container } = render(
        <ChatRoomSidebarRow
          room={makeRoom({
            starredAt,
            unreadCount: 2,
            unreadMentionCount: 2,
          })}
          href="/chat/rooms/room-1"
          label="Patrick Tobler"
          isActive={false}
          leading={<span>#</span>}
          onRoomUpdated={vi.fn()}
        />,
      );

      const tokens = spacerTokens(container);
      expect(tokens).toContain(GLYPH_HOLE);
      expect(tokens).not.toContain(NO_HOLE);
      // Nothing widens it further, so the crossfade moves no text.
      for (const token of HOLE_ON_INTERACTION) {
        expect(tokens).not.toContain(token);
      }
      // Touch has no hover, so the badge stays in flow beside the menu there
      // and the hole holds both.
      expect(tokens).toContain(BADGE_AND_CONTROL_HOLE_TOUCH);
    },
  );

  // Reorder mode's handle never fades, so there is nothing to crossfade with
  // and the badge stays in flow beside it.
  it("holds a badge and the reorder handle side by side", () => {
    const { container } = render(
      <ChatRoomSidebarRow
        room={makeRoom({
          starredAt: new Date("2026-09-01T00:00:00.000Z"),
          unreadCount: 2,
          unreadMentionCount: 2,
        })}
        href="/chat/rooms/room-1"
        label="Patrick Tobler"
        isActive={false}
        leading={<span>#</span>}
        onRoomUpdated={vi.fn()}
        reorderHandle={<button type="button">grip</button>}
      />,
    );

    const tokens = spacerTokens(container);
    expect(tokens).toContain("[@media(hover:hover)]:w-16");
    expect(tokens).not.toContain(GLYPH_HOLE);
    expect(tokens).not.toContain(NO_HOLE);
    expect(
      container
        .querySelector('[data-slot="room-mention-badge"]')
        ?.className.split(" "),
    ).not.toContain("[@media(hover:hover)]:absolute");
  });
});

// The badge shares the room menu's column and fades out as the menu fades in,
// which is what frees the width the name gets back. The number itself is
// decoration outside the link; `MentionAnnouncement` carries it to the reader.
describe("ChatRoomSidebarRow mention badge", () => {
  function renderBadgedRow(props?: { reorderHandle?: React.ReactNode }) {
    return render(
      <ChatRoomSidebarRow
        room={makeRoom({ unreadCount: 3, unreadMentionCount: 2 })}
        href="/chat/rooms/room-1"
        label="Patrick Tobler"
        isActive={false}
        leading={<span>#</span>}
        onRoomUpdated={vi.fn()}
        reorderHandle={props?.reorderHandle}
      />,
    );
  }

  it("draws the badge in the menu's column, not in the link", () => {
    const { container } = renderBadgedRow();

    const badge = container.querySelector('[data-slot="room-mention-badge"]');
    expect(badge?.textContent).toBe("2");
    expect(
      container.querySelector('[data-slot="room-trailing"]')?.contains(badge),
    ).toBe(true);
    expect(screen.getByRole("link").contains(badge)).toBe(false);
    // It never eats the menu button it covers at rest.
    expect(badge?.className.split(" ")).toContain("pointer-events-none");
  });

  it("fades the badge out on hover, focus and menu-open", () => {
    const { container } = renderBadgedRow();

    const tokens =
      container
        .querySelector('[data-slot="room-mention-badge"]')
        ?.className.split(" ") ?? [];
    expect(tokens).toContain("[@media(hover:hover)]:absolute");
    for (const token of [
      "[@media(hover:hover)]:group-hover/room-row:opacity-0",
      "[@media(hover:hover)]:group-focus-within/room-row:opacity-0",
      "group-has-[[data-state=open]]/room-row:opacity-0",
    ]) {
      expect(tokens).toContain(token);
    }
    // The swap reads as one move, and stills for a reader who asked for that.
    expect(tokens).toContain("motion-safe:transition-opacity");
  });

  it("fades the menu button in on the same terms", () => {
    renderBadgedRow();

    const tokens = screen
      .getByRole("button", { name: "Chat actions for Patrick Tobler" })
      .className.split(" ");
    expect(tokens).toContain("motion-safe:transition-opacity");
    expect(tokens).toContain("[@media(hover:hover)]:opacity-0");
    for (const token of [
      "[@media(hover:hover)]:group-hover/room-row:opacity-100",
      // Tabbing to the row reveals the menu, so it stays a keyboard target on
      // the same terms that fade the badge out.
      "[@media(hover:hover)]:group-focus-within/room-row:opacity-100",
      "data-[state=open]:opacity-100",
    ]) {
      expect(tokens).toContain(token);
    }
  });

  // The pill's width is a count, so positioning it by its own edge centres `2`
  // and leaves `99+` off-centre against the name. It rides the bell's box.
  it("centres the pill in the same box the muted bell uses", () => {
    const { container } = renderBadgedRow();

    const badge = container.querySelector('[data-slot="room-mention-badge"]');
    const tokens = badge?.className.split(" ") ?? [];
    expect(tokens).toContain("size-8");
    expect(tokens).toContain("md:size-7");
    expect(tokens).toContain("[@media(hover:hover)]:right-0");
    expect(tokens).not.toContain("[@media(hover:hover)]:right-1");
    // The pill is the inner element, so the box's width is not its width.
    expect(badge?.firstElementChild?.className).toContain("rounded-full");
  });

  // The badge is `aria-hidden` outside the link, so losing the announcement
  // would leave a screen reader with no mention at all on the row.
  it("keeps the mention in the link's accessible name", () => {
    renderBadgedRow();

    const announcement = screen.getByText("2 mentions");
    expect(announcement.className).toContain("sr-only");
    expect(screen.getByRole("link").contains(announcement)).toBe(true);
  });
});

describe("ChatRoomSidebarRow reorder mode", () => {
  function renderRow(reorderHandle?: React.ReactNode) {
    return render(
      <ChatRoomSidebarRow
        room={makeRoom({ starredAt: new Date("2026-09-01T00:00:00.000Z") })}
        href="/chat/rooms/room-1"
        label="general"
        isActive={false}
        leading={<span>#</span>}
        onRoomUpdated={vi.fn()}
        reorderHandle={reorderHandle}
      />,
    );
  }

  it("puts the handle where the room menu stands and rests the link", () => {
    const { container } = renderRow(<button type="button">grip</button>);

    const cluster = container.querySelector('[data-slot="room-trailing"]');
    expect(
      cluster?.contains(screen.getByRole("button", { name: "grip" })),
    ).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Chat actions for general" }),
    ).toBeNull();

    const link = screen.getByRole("link");
    expect(link.className.split(" ")).toContain("pointer-events-none");
    // The collapsed rail shows no handle, so its rows keep opening rooms.
    expect(link.className.split(" ")).toContain(
      "group-data-[collapsible=icon]:pointer-events-auto",
    );
    expect(link).toHaveAttribute("tabindex", "-1");
  });

  it("is an ordinary row outside reorder mode", () => {
    renderRow();

    expect(
      screen.getByRole("button", { name: "Chat actions for general" }),
    ).toBeInTheDocument();
    const link = screen.getByRole("link");
    expect(link.className.split(" ")).not.toContain("pointer-events-none");
    expect(link).not.toHaveAttribute("tabindex");
  });
});

describe("ChatRoomSidebarRow edit menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    roomSearchParams.current = new URLSearchParams();
  });

  // Both survive a failed assertion, which a restore inside a test does not.
  afterEach(() => {
    roomSearchParams.current = new URLSearchParams();
    window.history.replaceState({}, "", "/");
  });

  it("sends the reader to the channel with its edit dialog asked for", async () => {
    render(
      <ChatRoomSidebarRow
        room={makeRoom()}
        href="/chat/rooms/room-1"
        label="general"
        isActive={false}
        leading={<span>#</span>}
        onRoomUpdated={vi.fn()}
      />,
    );

    const user = await openRoomMenu();
    await user.click(screen.getByRole("menuitem", { name: "Edit channel" }));

    expect(pushMock).toHaveBeenCalledWith(chatRoomEditHref("room-1"));
  });

  // The room already on screen takes the parameter straight back off its URL,
  // so a pushed entry would leave Back doing nothing the reader can see.
  it("replaces rather than pushes for the channel already on screen", async () => {
    render(
      <ChatRoomSidebarRow
        room={makeRoom()}
        href="/chat/rooms/room-1"
        label="general"
        isActive
        leading={<span>#</span>}
        onRoomUpdated={vi.fn()}
      />,
    );

    const user = await openRoomMenu();
    await user.click(screen.getByRole("menuitem", { name: "Edit channel" }));

    expect(replaceMock).toHaveBeenCalledWith(chatRoomEditHref("room-1"), {
      scroll: false,
    });
    expect(pushMock).not.toHaveBeenCalled();
  });

  // The ask is added to what the active room's URL carries rather than
  // written over it.
  it("keeps what the active room's URL already carries", async () => {
    roomSearchParams.current = new URLSearchParams("notice=welcome");

    render(
      <ChatRoomSidebarRow
        room={makeRoom()}
        href="/chat/rooms/room-1"
        label="general"
        isActive
        leading={<span>#</span>}
        onRoomUpdated={vi.fn()}
      />,
    );

    const user = await openRoomMenu();
    await user.click(screen.getByRole("menuitem", { name: "Edit channel" }));

    expect(replaceMock).toHaveBeenCalledWith(
      "/chat/rooms/room-1?notice=welcome&edit=1",
      { scroll: false },
    );
  });

  // The router's query still names a message the room has spent until that
  // strip commits. Written back, it would leave the room waiting on a message
  // nobody spends again, with this ask stuck behind it.
  it("drops a message the room has not jumped to", async () => {
    roomSearchParams.current = new URLSearchParams("message=msg-1");

    render(
      <ChatRoomSidebarRow
        room={makeRoom()}
        href="/chat/rooms/room-1"
        label="general"
        isActive
        leading={<span>#</span>}
        onRoomUpdated={vi.fn()}
      />,
    );

    const user = await openRoomMenu();
    await user.click(screen.getByRole("menuitem", { name: "Edit channel" }));

    expect(replaceMock).toHaveBeenCalledWith(chatRoomEditHref("room-1"), {
      scroll: false,
    });
  });

  // The App Router writes history in an effect after the commit, so the
  // document lags the router's own query.
  it("reads the router's query rather than the document's", async () => {
    window.history.replaceState({}, "", "/chat/rooms/room-1?notice=welcome");
    roomSearchParams.current = new URLSearchParams();

    render(
      <ChatRoomSidebarRow
        room={makeRoom()}
        href="/chat/rooms/room-1"
        label="general"
        isActive
        leading={<span>#</span>}
        onRoomUpdated={vi.fn()}
      />,
    );

    const user = await openRoomMenu();
    await user.click(screen.getByRole("menuitem", { name: "Edit channel" }));

    expect(replaceMock).toHaveBeenCalledWith(chatRoomEditHref("room-1"), {
      scroll: false,
    });
  });

  // The dialog is for channels. A direct room's header shows a plain title.
  it("hides Edit channel for direct rooms", async () => {
    render(
      <ChatRoomSidebarRow
        room={makeRoom({ kind: "direct" })}
        href="/chat/rooms/room-1"
        label="Alice"
        isActive={false}
        leading={<span>#</span>}
        onRoomUpdated={vi.fn()}
      />,
    );

    await openRoomMenu("Alice");

    expect(
      screen.queryByRole("menuitem", { name: "Edit channel" }),
    ).not.toBeInTheDocument();
  });

  // A channel nobody may leave still opens its dialog from the same menu.
  it("offers Edit channel when Leave is hidden", async () => {
    render(
      <ChatRoomSidebarRow
        room={makeRoom({ userMembers: [makeUser("user-1")] })}
        href="/chat/rooms/room-1"
        label="general"
        isActive={false}
        leading={<span>#</span>}
        onRoomUpdated={vi.fn()}
      />,
    );

    await openRoomMenu();

    expect(
      screen.getByRole("menuitem", { name: "Edit channel" }),
    ).toBeInTheDocument();
  });
});

describe("ChatRoomSidebarRow leave menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    leaveRoomActionMock.mockResolvedValue({
      ok: true,
      value: { id: "room-1" },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("hides Leave for direct rooms", async () => {
    render(
      <ChatRoomSidebarRow
        room={makeRoom({
          kind: "direct",
          userMembers: [makeUser("user-1"), makeUser("user-2")],
        })}
        href="/chat/rooms/room-1"
        label="Alice"
        isActive={false}
        leading={<span>#</span>}
        onRoomUpdated={vi.fn()}
      />,
    );

    await openRoomMenu("Alice");

    expect(
      screen.queryByRole("menuitem", { name: /Leave channel/i }),
    ).not.toBeInTheDocument();
  });

  it("hides Leave when channel has only one userMember", async () => {
    render(
      <ChatRoomSidebarRow
        room={makeRoom({ userMembers: [makeUser("user-1")] })}
        href="/chat/rooms/room-1"
        label="general"
        isActive={false}
        leading={<span>#</span>}
        onRoomUpdated={vi.fn()}
      />,
    );

    await openRoomMenu();

    expect(
      screen.queryByRole("menuitem", { name: /Leave channel/i }),
    ).not.toBeInTheDocument();
  });

  it("shows Leave for channel with two or more userMembers", async () => {
    render(
      <ChatRoomSidebarRow
        room={makeRoom()}
        href="/chat/rooms/room-1"
        label="general"
        isActive={false}
        leading={<span>#</span>}
        onRoomUpdated={vi.fn()}
      />,
    );

    await openRoomMenu();

    expect(
      screen.getByRole("menuitem", { name: /Leave channel/i }),
    ).toBeInTheDocument();
  });

  it("opens leave confirm and leaves on confirm", async () => {
    render(
      <ChatRoomSidebarRow
        room={makeRoom()}
        href="/chat/rooms/room-1"
        label="general"
        isActive
        leading={<span>#</span>}
        onRoomUpdated={vi.fn()}
      />,
    );

    const user = await openRoomMenu();
    await user.click(screen.getByRole("menuitem", { name: /Leave channel/i }));

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Leave general?" }),
    ).toBeInTheDocument();

    const confirmButtons = screen.getAllByRole("button", {
      name: /Leave channel/i,
    });
    await user.click(confirmButtons[confirmButtons.length - 1]!);

    await waitFor(() => {
      expect(leaveRoomActionMock).toHaveBeenCalledWith("room-1");
    });
    expect(toast.success).toHaveBeenCalledWith("You left general.");
    expect(notifyMock).toHaveBeenCalledWith({ removedRoomId: "room-1" });
    expect(replaceMock).toHaveBeenCalledWith(CHAT_CHATS_LIST_PATH);
    expect(refreshMock).toHaveBeenCalled();
  });
});

describe("ChatRoomSidebarRow unread message count", () => {
  beforeEach(() => {
    showRoomUnreadCountMock.mockReturnValue(true);
  });

  afterEach(() => {
    showRoomUnreadCountMock.mockReturnValue(false);
  });

  function renderRow(room: ChatRoom, isActive = false) {
    return render(
      <ChatRoomSidebarRow
        room={room}
        href={`/chat/rooms/${room.id}`}
        label={room.name ?? room.id}
        isActive={isActive}
        leading={<span>#</span>}
        onRoomUpdated={vi.fn()}
      />,
    );
  }

  it("shows nothing extra when the reader has not opted in", () => {
    showRoomUnreadCountMock.mockReturnValue(false);
    renderRow(makeRoom({ unreadCount: 4 }));

    expect(screen.queryByText("4 unread messages")).toBeNull();
    expect(
      document.querySelector('[data-slot="room-unread-count"]'),
    ).toBeNull();
  });

  it("shows the unread message count when the reader opted in", () => {
    renderRow(makeRoom({ unreadCount: 4 }));

    expect(
      document.querySelector('[data-slot="room-unread-count"]'),
    ).toHaveTextContent("4");
    expect(screen.getByText("4 unread messages").className).toContain(
      "sr-only",
    );
  });

  it("shows no count on a room with nothing unread", () => {
    renderRow(makeRoom({ unreadCount: 0 }));

    expect(screen.queryByText(/unread messages/)).toBeNull();
  });

  it("shows no count on a muted room", () => {
    renderRow(makeRoom({ unreadCount: 4, mutedAt: new Date() }));

    expect(screen.queryByText(/unread messages/)).toBeNull();
  });

  // Opening a room does not read it, so the open row keeps the whole statement:
  // the bold name, the mention badge, and the count. It is pinned here rather
  // than in `room-attention.test.ts`, which no longer has an active flag to
  // pass.
  it("keeps bold and the badge on the room the reader has open", () => {
    renderRow(makeRoom({ unreadCount: 4, unreadMentionCount: 2 }), true);

    expect(screen.getByText("general").className).toContain("font-semibold");
    expect(screen.getByText("2 mentions")).toBeInTheDocument();
  });

  // One number per row, so the count takes the badge's own slot: the same
  // column, and the same crossfade with the row's menu. Muted, because it is
  // the one number on the sidebar that is not about the reader.
  it("draws the count in the badge's column, announced inside the link", () => {
    renderRow(makeRoom({ unreadCount: 4 }));

    const count = document.querySelector('[data-slot="room-unread-count"]');
    expect(count).toHaveAttribute("aria-hidden");
    expect(
      document
        .querySelector('[data-slot="room-trailing"]')
        ?.contains(count as Node),
    ).toBe(true);
    expect(
      document.querySelector('a[href="/chat/rooms/room-1"]'),
    ).toHaveTextContent("4 unread messages");
  });

  it("keeps bold and the count on the room the reader has open", () => {
    renderRow(makeRoom({ unreadCount: 4 }), true);

    expect(screen.getByText("general").className).toContain("font-semibold");
    expect(screen.getByText("4 unread messages")).toBeInTheDocument();
  });

  it("caps a very loud room so the row cannot reflow", () => {
    renderRow(makeRoom({ unreadCount: 1234 }));

    expect(
      document.querySelector('[data-slot="room-unread-count"]'),
    ).toHaveTextContent("99+");
    expect(screen.getByText("More than 99 unread messages")).toBeVisible();
  });

  // Collapsed to icons, the row is a 20px glyph with no room for either
  // number. Hiding both is the decided behaviour, not an oversight.
  it("hides the count when the sidebar collapses", () => {
    renderRow(makeRoom({ unreadCount: 4 }));

    // The count is a visible span wrapping its own announcement, so the rule
    // sits on the parent.
    expect(
      screen.getByText("4 unread messages").parentElement?.className,
    ).toContain("group-data-[collapsible=icon]:hidden");
  });

  it("hides the mention badge when the sidebar collapses", () => {
    renderRow(makeRoom({ unreadCount: 4, unreadMentionCount: 2 }));

    // The mention is announcement only.
    expect(screen.getByText("2 mentions").className).toContain(
      "group-data-[collapsible=icon]:hidden",
    );
  });

  // The regression guard: a mention and unread messages on one row. One
  // number per row, so the badge stands alone, and it must keep counting
  // mentions rather than turning into the message count it replaced.
  it("shows the mention badge alone on a row that also has unread messages", () => {
    renderRow(makeRoom({ unreadCount: 9, unreadMentionCount: 2 }));

    expect(screen.getByText("2 mentions")).toBeInTheDocument();
    expect(screen.getByText("2").closest("[aria-hidden]")).toHaveAttribute(
      "data-slot",
      "room-mention-badge",
    );
    expect(screen.queryByText("9 unread messages")).toBeNull();
    expect(
      document.querySelector('[data-slot="room-unread-count"]'),
    ).toBeNull();
  });

  // The badge announced a hardcoded English `aria-label` before SOK-1042, so a
  // German or Spanish reader heard English and one mention read "1 mentions".
  it("announces the mention badge through a translated string", () => {
    renderRow(makeRoom({ unreadCount: 0, unreadMentionCount: 3 }));

    expect(screen.getByText("3 mentions").className).toContain("sr-only");
    expect(screen.queryByLabelText(/mentions/)).toBeNull();
  });

  // What is announced is exact up to 99. What is drawn is not: the mention
  // badge carries an `@` in a 28px hole, so its number gives way at nine. The
  // message count, which a row shows instead of a badge, has the room for 99.
  it("caps the drawn mention badge lower than its announcement", () => {
    renderRow(makeRoom({ unreadCount: 1234, unreadMentionCount: 1234 }));

    expect(screen.getByText("9+").closest("[aria-hidden]")).toHaveAttribute(
      "data-slot",
      "room-mention-badge",
    );
    expect(screen.getByText("More than 99 mentions")).toBeInTheDocument();
  });

  // The pure-function seam never receives the room kind, so it cannot prove
  // these. They fail if anyone ever puts a kind gate on the count path.
  it("shows the count on a Direct", () => {
    renderRow(
      makeRoom({
        id: "direct-1",
        name: "Ada",
        kind: "direct",
        slug: null,
        directKey: "user-1:user-2",
        discoverability: null,
        unreadCount: 3,
      }),
    );

    expect(screen.getByText("3 unread messages")).toBeInTheDocument();
  });

  it("shows the count on a multi-human group Direct", () => {
    renderRow(
      makeRoom({
        id: "direct-2",
        name: "Ada, Grace, Alan",
        kind: "direct",
        slug: null,
        directKey: "user-1:user-2:user-3",
        discoverability: null,
        unreadCount: 6,
        userMembers: [
          makeUser("user-1"),
          makeUser("user-2"),
          makeUser("user-3"),
        ],
      }),
    );

    expect(screen.getByText("6 unread messages")).toBeInTheDocument();
  });

  it("shows the count on a coworker 1:1", () => {
    renderRow(
      makeRoom({
        id: "direct-3",
        name: "Scout",
        kind: "direct",
        slug: null,
        directKey: "user-1:coworker-1",
        discoverability: null,
        unreadCount: 2,
        userMembers: [makeUser("user-1")],
        coworkerMembers: [
          {
            id: "coworker-1",
            name: "Scout",
            slug: "scout",
            caption: null,
            image: null,
            presence: "offline",
          },
        ],
      }),
    );

    expect(screen.getByText("2 unread messages")).toBeInTheDocument();
  });

  it("shows the count on an External channel", () => {
    renderRow(
      makeRoom({
        id: "external-1",
        name: "partner-room",
        organizationName: "Partner Inc",
        myAccess: "guest",
        unreadCount: 5,
      }),
    );

    expect(screen.getByText("5 unread messages")).toBeInTheDocument();
  });
});

describe("ChatRoomSidebarRow Mark unread", () => {
  beforeEach(() => {
    clearRoomReadOverlays();
    vi.clearAllMocks();
  });

  it("supersedes a pending read and protects Mark unread while its action runs", async () => {
    const original = makeRoom();
    const oldRead = beginRoomAttentionChange(original);
    const response =
      Promise.withResolvers<
        Awaited<ReturnType<typeof markOrganizationChatRoomUnreadAction>>
      >();
    vi.mocked(markOrganizationChatRoomUnreadAction).mockReturnValue(
      response.promise,
    );
    const onRoomUpdated = vi.fn(rememberRoomRead);
    render(
      <ChatRoomSidebarRow
        room={original}
        href="/chat/rooms/room-1"
        label="general"
        isActive={false}
        leading={<span>#</span>}
        onRoomUpdated={onRoomUpdated}
      />,
    );
    const user = await openRoomMenu();
    await user.click(screen.getByRole("menuitem", { name: "Mark as unread" }));

    expect(settleRoomAttentionChange(original.id, oldRead, original)).toBe(
      false,
    );
    expect(
      reconcileRoomAttention([original], beginRoomAttentionRefresh())[0]
        ?.markedUnread,
    ).toBe(true);
    await act(async () =>
      response.resolve({
        ok: true,
        value: { ...original, markedUnread: true },
      }),
    );
    expect(applyRoomReadOverlays([original])[0]?.markedUnread).toBe(true);
  });

  it.each(["failed result", "rejected request"])(
    "restores attention after a %s",
    async (failure) => {
      const original = makeRoom();
      const response =
        Promise.withResolvers<
          Awaited<ReturnType<typeof markOrganizationChatRoomUnreadAction>>
        >();
      vi.mocked(markOrganizationChatRoomUnreadAction).mockReturnValue(
        response.promise,
      );
      const onRoomUpdated = vi.fn(rememberRoomRead);
      render(
        <ChatRoomSidebarRow
          room={original}
          href="/chat/rooms/room-1"
          label="general"
          isActive={false}
          leading={<span>#</span>}
          onRoomUpdated={onRoomUpdated}
        />,
      );
      const user = await openRoomMenu();
      await user.click(
        screen.getByRole("menuitem", { name: "Mark as unread" }),
      );
      const staleRequest = beginRoomAttentionRefresh();
      await act(async () => {
        if (failure === "failed result") {
          response.resolve({
            ok: false,
            error: { code: "INTERNAL_SERVER_ERROR", message: "fail" },
          });
        } else {
          response.reject(new Error("network unavailable"));
        }
      });

      expect(onRoomUpdated).toHaveBeenLastCalledWith(original);
      expect(
        applyRoomReadOverlays([{ ...original, markedUnread: true }])[0]
          ?.markedUnread,
      ).toBe(false);
      expect(
        reconcileRoomAttention(
          [{ ...original, markedUnread: true }],
          staleRequest,
        )[0]?.markedUnread,
      ).toBe(false);
      expect(toast.error).toHaveBeenCalledWith(
        "Could not update this chat. Try again.",
      );
    },
  );
  it("restores settled attention when Mark unread supersedes a read and fails", async () => {
    const original = makeRoom();
    const settled = { ...original, unreadCount: 2, unreadMentionCount: 1 };
    rememberRoomRead(settled);
    const pendingRead = beginRoomAttentionChange(original, settled);
    const response =
      Promise.withResolvers<
        Awaited<ReturnType<typeof markOrganizationChatRoomUnreadAction>>
      >();
    vi.mocked(markOrganizationChatRoomUnreadAction).mockReturnValue(
      response.promise,
    );
    const onRoomUpdated = vi.fn(rememberRoomRead);
    render(
      <ChatRoomSidebarRow
        room={original}
        href="/chat/rooms/room-1"
        label="general"
        isActive={false}
        leading={<span>#</span>}
        onRoomUpdated={onRoomUpdated}
      />,
    );
    const user = await openRoomMenu();
    await user.click(screen.getByRole("menuitem", { name: "Mark as unread" }));
    await act(async () => {
      response.resolve({
        ok: false,
        error: { code: "INTERNAL_SERVER_ERROR", message: "failed" },
      });
    });
    expect(settleRoomAttentionChange(original.id, pendingRead, null)).toBe(
      false,
    );
    expect(onRoomUpdated).toHaveBeenLastCalledWith(settled);
    expect(applyRoomReadOverlays([original])[0]).toEqual(settled);
  });
});
