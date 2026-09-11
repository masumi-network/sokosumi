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
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// The row's two numbers are checked against the real English catalog: the mock
// resolves them by full key path and throws when that path is not in `en.json`.
// So a typo in either half of the path fails here, and so does a path the
// catalog never had. The plain strings below stand in for ICU output.
vi.mock("next-intl", async () => {
  const en = (await import("@/messages/en.json")).default;

  function catalogHas(path: string): boolean {
    return (
      path.split(".").reduce<unknown>((node, segment) => {
        return typeof node === "object" && node !== null
          ? (node as Record<string, unknown>)[segment]
          : undefined;
      }, en) !== undefined
    );
  }

  return {
    useTranslations:
      (namespace?: string) =>
      (key: string, values?: Record<string, string | number>) => {
        const path = `${namespace ?? ""}.${key}`;
        const numbers: Record<string, string> = {
          "App.Channels.RoomUnread.unreadMessages": `${values?.count ?? ""} unread messages`,
          "App.Channels.RoomUnread.unreadMessagesCapped": `More than ${values?.max ?? ""} unread messages`,
          "App.Channels.RoomMentions.mentions": `${values?.count ?? ""} mentions`,
          "App.Channels.RoomMentions.mentionsCapped": `More than ${values?.max ?? ""} mentions`,
        };

        if (namespace?.startsWith("App.Channels.Room") === true) {
          if (!catalogHas(path)) {
            throw new Error(`en.json has no message at ${path}`);
          }
          const number = numbers[path];
          if (number !== undefined) {
            return number;
          }
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
  };
});

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
  }: {
    children: ReactNode;
    asChild?: boolean;
  }) =>
    asChild && isValidElement(children) ? children : <div>{children}</div>,
  SidebarMenuItem: ({ children }: { children: ReactNode }) => (
    <li>{children}</li>
  ),
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

function makeUser(id: string, access: "member" | "guest" = "member") {
  return {
    id,
    name: `User ${id}`,
    email: `${id}@example.com`,
    image: null,
    presence: "offline" as const,
    access,
  };
}

function makeRoom(overrides: Partial<ChatRoom> = {}): ChatRoom {
  return {
    id: "room-1",
    organizationId: "org-1",
    organizationName: null,
    name: "general",
    slug: "general",
    kind: "channel",
    directKey: null,
    topic: null,
    discoverability: "public",
    createdByUserId: "user-1",
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    unreadCount: 0,
    unreadMentionCount: 0,
    starredAt: null,
    mutedAt: null,
    markedUnread: false,
    myAccess: "member",
    userMembers: [makeUser("user-1"), makeUser("user-2")],
    coworkerMembers: [],
    ...overrides,
    sokoBotMembers: overrides.sokoBotMembers ?? [],
  };
}

async function openRoomMenu(label = "general") {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: `Chat actions for ${label}` }),
  );
  return user;
}

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

  it("shows no count on the room the reader has open", () => {
    renderRow(makeRoom({ unreadCount: 4 }), true);

    expect(screen.queryByText(/unread messages/)).toBeNull();
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
