import { act, render, screen, waitFor } from "@testing-library/react";
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
  }: {
    children: ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} className={className}>
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

vi.mock("@/components/ui/sidebar", () => ({
  SidebarMenuButton: ({
    children,
    asChild,
    tooltip,
  }: {
    children: ReactNode;
    asChild?: boolean;
    tooltip?: string;
  }) => (
    <div data-testid="sidebar-menu-button" data-tooltip={tooltip}>
      {asChild && isValidElement(children) ? children : <div>{children}</div>}
    </div>
  ),
  SidebarMenuItem: ({ children }: { children: ReactNode }) => (
    <li>{children}</li>
  ),
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
  it("wraps any room leading icon in a min-w-5 / h-5 alignment slot", () => {
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
    expect(slot?.getAttribute("data-slot")).toBe("room-leading");
    // min-w-5 aligns single icons; width may grow for multi-avatar stacks.
    expect(slot?.className).toContain("min-w-5");
    expect(slot?.className).toContain("h-5");
    expect(slot?.className).toContain("shrink-0");
    expect(slot?.className).toContain("items-center");
    expect(slot?.className).toContain("justify-center");

    // Slot is a direct child of the room link so every room type shares the same column.
    const link = container.querySelector('a[href="/chat/rooms/room-1"]');
    expect(link?.firstElementChild).toBe(slot);
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
    // Padding drops and the mark centres: the collapsed button keeps its own
    // `p-3!`, which `px-0!` outranks because Tailwind orders it later.
    expect(link?.className).toContain(
      "group-data-[collapsible=icon]:justify-center",
    );
    expect(link?.className).toContain("group-data-[collapsible=icon]:px-0!");
    // The menu button clips its content for name truncation. Collapsed, the
    // 24px tile's corner mark hangs 6px below it inside a 32px button, so the
    // clip has to lift there or the lock and globe lose their bottom.
    expect(link?.className).toContain(
      "group-data-[collapsible=icon]:overflow-visible",
    );

    const slot = screen.getByTestId("custom-leading").parentElement;
    expect(slot?.className).toContain("group-data-[collapsible=icon]:h-6");
    expect(slot?.className).toContain("group-data-[collapsible=icon]:min-w-6");

    // The name must stay in the accessible name (the tooltip adds none) while
    // taking no flex space, so `sr-only`, never `hidden`. The spacer would
    // otherwise pull the mark off centre on touch.
    const name = screen.getByText("general");
    expect(name.parentElement?.parentElement?.className).toContain(
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
  it("hides the pin glyph and room menu when the sidebar collapses", () => {
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

    const cluster = container.querySelector('[data-slot="room-trailing"]');
    expect(cluster).not.toBeNull();
    // Pin glyph and the room menu both live in this one cluster.
    expect(cluster?.querySelector("svg.lucide-pin")).not.toBeNull();
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

  it("keeps the pin in the same size slot as the room menu", () => {
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

    const pin = container.querySelector("svg.lucide-pin");
    const box = pin?.parentElement;
    expect(box).not.toBeNull();
    expect(box?.className.split(" ").includes("md:size-7")).toBe(true);
    expect(box?.className).not.toContain("[@media(hover:hover)]:size-4");
  });

  // The hole is sized to the glyph, not the button's 28px box: `size-4` ends
  // the name 8px clear of the `…`. A row that shows something at rest holds it
  // open in every state; a plain row opens it with the button.
  const GLYPH_HOLE = "[@media(hover:hover)]:size-4";
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
    ["pinned", { starredAt: new Date("2026-09-01T00:00:00.000Z") }, false],
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

  it.each([
    ["pinned", new Date("2026-09-01T00:00:00.000Z")],
    ["unpinned", null],
  ])(
    "holds one spacer width on a %s row with a mention badge, so the badge sits beside the menu and never moves",
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

      const tokens =
        container
          .querySelector('[data-slot="room-trailing-spacer"]')
          ?.className.split(" ") ?? [];
      expect(tokens).toContain("[@media(hover:hover)]:size-3");
      expect(tokens).not.toContain(GLYPH_HOLE);
      expect(tokens).not.toContain(NO_HOLE);
      for (const token of HOLE_ON_INTERACTION) {
        expect(tokens).not.toContain(token);
      }
    },
  );
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
    expect(screen.queryByText("· 4")).toBeNull();
  });

  it("shows the unread message count when the reader opted in", () => {
    renderRow(makeRoom({ unreadCount: 4 }));

    expect(screen.getByText("· 4")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("4 unread messages").className).toContain(
      "sr-only",
    );
  });

  // The count has no unbolded variant, so it has to match the name it sits
  // beside rather than merely being bold on its own.
  it("draws the count at the same unread weight as the room name", () => {
    renderRow(makeRoom({ unreadCount: 4 }));

    const count = screen.getByText("4 unread messages").parentElement;
    const name = screen.getByText("general");

    for (const className of [count?.className, name.className]) {
      expect(className).toContain("font-semibold");
      expect(className).toContain("text-foreground");
    }
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
  it("keeps bold, badge, and count on the room the reader has open", () => {
    renderRow(makeRoom({ unreadCount: 4, unreadMentionCount: 2 }), true);

    expect(screen.getByText("general").className).toContain("font-semibold");
    expect(screen.getByText("2 mentions")).toBeInTheDocument();
    expect(screen.getByText("4 unread messages")).toBeInTheDocument();
  });

  it("caps a very loud room so the row cannot reflow", () => {
    renderRow(makeRoom({ unreadCount: 1234 }));

    expect(screen.getByText("· 99+")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("More than 99 unread messages")).toBeVisible();
  });

  // Collapsed to icons, the row is a 20px glyph with no room for either
  // number. Hiding both is the decided behaviour, not an oversight.
  it("hides the count with the mention badge when the sidebar collapses", () => {
    renderRow(makeRoom({ unreadCount: 4, unreadMentionCount: 2 }));

    for (const text of ["4 unread messages", "2 mentions"]) {
      expect(screen.getByText(text).parentElement?.className).toContain(
        "group-data-[collapsible=icon]:hidden",
      );
    }
  });

  // The regression guard: a mention and unread messages on one row, each
  // number saying its own thing. The badge must keep counting mentions.
  it("shows a mention badge and a message count without either changing", () => {
    renderRow(makeRoom({ unreadCount: 9, unreadMentionCount: 2 }));

    expect(screen.getByText("2 mentions")).toBeInTheDocument();
    expect(screen.getByText("2")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("9 unread messages")).toBeInTheDocument();
    expect(screen.getByText("· 9")).toHaveAttribute("aria-hidden", "true");
  });

  // The badge announced a hardcoded English `aria-label` before SOK-1042, so a
  // German or Spanish reader heard English and one mention read "1 mentions".
  it("announces the mention badge through a translated string", () => {
    renderRow(makeRoom({ unreadCount: 0, unreadMentionCount: 3 }));

    expect(screen.getByText("3 mentions").className).toContain("sr-only");
    expect(screen.queryByLabelText(/mentions/)).toBeNull();
  });

  // One cap for both numbers on this row.
  it("caps the mention badge at the same ceiling as the message count", () => {
    renderRow(makeRoom({ unreadCount: 1234, unreadMentionCount: 1234 }));

    expect(screen.getByText("99+")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("· 99+")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("More than 99 mentions")).toBeInTheDocument();
    expect(screen.getByText("More than 99 unread messages")).toBeVisible();
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
