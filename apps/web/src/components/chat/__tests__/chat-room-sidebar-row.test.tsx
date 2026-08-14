import { render, screen, waitFor } from "@testing-library/react";
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
import type { ChatRoom } from "@/lib/clients/generated/core";

const { leaveRoomActionMock, replaceMock, refreshMock, notifyMock } =
  vi.hoisted(() => ({
    leaveRoomActionMock: vi.fn(),
    replaceMock: vi.fn(),
    refreshMock: vi.fn(),
    notifyMock: vi.fn(),
  }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
    refresh: refreshMock,
  }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("next-intl", () => ({
  useTranslations:
    (_namespace?: string) => (key: string, values?: Record<string, string>) => {
      const translations: Record<string, string> = {
        leave: "Leave channel",
        leaveConfirmTitle: `Leave ${values?.name ?? ""}?`,
        leaveConfirmDescription: `Leave description for ${values?.name ?? ""}`,
        leaveConfirm: "Leave channel",
        leaveSuccess: `You left ${values?.name ?? ""}.`,
        cancel: "Cancel",
        markUnread: "Mark as unread",
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
import { ChatRoomSidebarRow } from "../chat-room-sidebar-row";

function makeUser(id: string) {
  return {
    id,
    name: `User ${id}`,
    email: `${id}@example.com`,
    image: null,
    presence: "offline" as const,
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
    pinnedAt: null,
    mutedAt: null,
    markedUnread: false,
    myAccess: "member",
    userMembers: [makeUser("user-1"), makeUser("user-2")],
    coworkerMembers: [],
    ...overrides,
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
    expect(replaceMock).toHaveBeenCalledWith("/");
    expect(refreshMock).toHaveBeenCalled();
  });
});
