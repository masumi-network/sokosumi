import { render } from "@testing-library/react";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { vi } from "vitest";
import type {
  ChatRoom,
  ChatRoomInvitation,
} from "@/lib/clients/generated/core";
import {
  CHAT_UNREADS_FILTER_BOOT_ATTRIBUTE,
  serializeChatUnreadsFilterCookie,
} from "@/lib/ui-preferences/chat-unreads-filter";

import { OrganizationChatList } from "../organization-chat-list.client";

/** The route the list reads, so a test can open a room. Reset per test.
 *  Selection is the optimistic highlight, which moves before the route. */
const { harnessPathname, harnessSelection } = vi.hoisted(() => ({
  harnessPathname: { current: "/chat" },
  harnessSelection: { current: null as string | null },
}));

const {
  acceptInvitationMock,
  listRoomsMock,
  listArchivedMock,
  listPendingMock,
  reorderPinnedMock,
} = vi.hoisted(() => ({
  acceptInvitationMock: vi.fn(),
  listRoomsMock: vi.fn(),
  listArchivedMock: vi.fn(),
  listPendingMock: vi.fn(),
  reorderPinnedMock: vi.fn(),
}));

export {
  acceptInvitationMock,
  harnessPathname,
  harnessSelection,
  listArchivedMock,
  listPendingMock,
  listRoomsMock,
  reorderPinnedMock,
};

vi.mock("@/app/chat/components/room-cache-provider", () => ({
  useRoomSelection: () => harnessSelection.current,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => harnessPathname.current,
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/app/chat/actions", () => ({
  acceptChatRoomInvitationAction: (
    ...args: Parameters<typeof acceptInvitationMock>
  ) => acceptInvitationMock(...args),
  declineChatRoomInvitationAction: vi.fn(),
  deleteRoomAction: vi.fn(),
  restoreRoomAction: vi.fn(),
}));

vi.mock("@/app/chat/components/browse-channels-dialog", () => ({
  BrowseChannelsDialog: () => null,
}));

vi.mock("@/app/chat/components/create-channel-dialog", () => ({
  CreateChannelDialog: () => (
    <button type="button" aria-label="App.Channels.createChannel">
      +
    </button>
  ),
}));

vi.mock("@/app/chat/components/create-direct-dialog", () => ({
  CreateDirectDialog: () => (
    <button type="button" aria-label="App.Channels.Draft.title">
      +
    </button>
  ),
}));

vi.mock("@/app/chat/components/room-helpers", () => ({
  getRoomDisplayName: () => "room",
}));

vi.mock("../chat-room-sidebar-row", () => ({
  ChatRoomSidebarRow: ({
    label,
    reorderHandle,
    itemProps,
  }: {
    label: string;
    reorderHandle?: ReactNode;
    itemProps?: ComponentProps<"li">;
  }) => (
    <li {...itemProps} data-testid="room-row">
      <span>{label}</span>
      {reorderHandle}
    </li>
  ),
  RailAttentionPill: () => null,
}));

// A marker, not the rows: what they count belongs to
// `chat-unread-nav-rows.test.tsx`. The list decides where they stand and
// what the All unreads filter does to the sections, so the marker keeps the
// toggle.
vi.mock("../chat-unread-nav-rows", () => ({
  ChatUnreadNavRows: ({
    unreadOnly,
    onUnreadOnlyChange,
  }: {
    unreadOnly: boolean;
    onUnreadOnlyChange: (unreadOnly: boolean) => void;
  }) => (
    <li data-testid="chat-unread-nav-rows">
      <button
        type="button"
        aria-pressed={unreadOnly}
        onClick={() => onUnreadOnlyChange(!unreadOnly)}
      >
        All unreads
      </button>
    </li>
  ),
}));

vi.mock("../pending-invitation-rail-button", () => ({
  PendingInvitationRailButton: ({
    roomName,
    label,
    acceptButtonId,
  }: {
    roomName: string;
    label: string;
    acceptButtonId: string;
  }) => (
    <span
      data-testid="rail-invitation"
      data-room-name={roomName}
      data-label={label}
      data-accept-button-id={acceptButtonId}
    />
  ),
}));

vi.mock("../direct-room-avatar-stack", () => ({
  DirectRoomAvatarStack: () => null,
}));

vi.mock("../organization-chat-list.actions", () => ({
  listOrganizationChatRoomsAction: (
    ...args: Parameters<typeof listRoomsMock>
  ) => listRoomsMock(...args),
  reorderPinnedOrganizationChatRoomsAction: (
    ...args: Parameters<typeof reorderPinnedMock>
  ) => reorderPinnedMock(...args),
  listOrganizationArchivedChatRoomsAction: vi.fn(async () => ({
    ok: true,
    value: { rooms: [], nextCursor: null },
  })),
}));

vi.mock("../fetch-sidebar-room-collection", () => ({
  fetchSidebarRoomCollection: async (collection: string) => {
    const result =
      collection === "active"
        ? await listRoomsMock()
        : collection === "invitations"
          ? await listPendingMock()
          : ((await listArchivedMock()) ?? {
              ok: true,
              value: { rooms: [], nextCursor: null },
            });
    return result.ok ? result.value : null;
  },
}));

vi.mock("@/components/ui/sheet", () => ({
  SheetClose: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// The real module under the overrides, so `SidebarRowSlot` — the shared
// leading slot every row sits its mark in — is the one the app ships.
vi.mock("@/components/ui/sidebar", async () => ({
  ...(await vi.importActual<typeof import("@/components/ui/sidebar")>(
    "@/components/ui/sidebar",
  )),
  // The section header's rail square, as a bare marker: its children repeat
  // the title the expanded heading already renders, which would double every
  // `getByText`. `chat-sidebar-section-header.test.tsx` covers the square.
  SidebarMenuButton: ({ tooltip }: { tooltip?: string }) => (
    <span data-testid="section-rail-button" data-tooltip={tooltip} />
  ),
  SidebarGroup: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarGroupContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  // Props through, so a section's own marker (`data-slot`) reaches the DOM.
  SidebarMenu: ({
    children,
    ...props
  }: { children: ReactNode } & ComponentProps<"ul">) => (
    <ul {...props}>{children}</ul>
  ),
  SidebarMenuItem: ({ children }: { children: ReactNode }) => (
    <li>{children}</li>
  ),
  // The list reads it to expand the sidebar from Archived's rail square;
  // there is no provider around these renders.
  useSidebar: () => ({ setOpen: vi.fn() }),
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  AlertDialogAction: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AlertDialogCancel: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AlertDialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  AlertDialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogTitle: ({ children }: { children: ReactNode }) => (
    <h2>{children}</h2>
  ),
}));

vi.mock("@/components/ui/collapsible", () => ({
  Collapsible: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CollapsibleContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  CollapsibleTrigger: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

export const emptyRooms: ChatRoom[] = [];

export interface OrganizationChatListHarnessOptions {
  rooms?: ChatRoom[];
  archivedRooms?: ChatRoom[];
  pendingInvitations?: ChatRoomInvitation[];
  organizationId?: string | null;
  paintOnly?: boolean;
}

export function emptyListResult(rooms: ChatRoom[] = []) {
  return {
    ok: true as const,
    value: { rooms, nextCursor: null },
  };
}

export function makeRoom(
  overrides: Partial<ChatRoom> & Pick<ChatRoom, "id" | "kind" | "myAccess">,
): ChatRoom {
  return {
    organizationId: "org-1",
    organizationName: "Acme",
    name: overrides.id,
    slug: overrides.kind === "channel" ? overrides.id : null,
    isSelfDirect: false,
    isGroupDirect: false,
    groupName: null,
    directKey: null,
    topic: null,
    discoverability: overrides.kind === "channel" ? "public" : null,
    createdByUserId: "user-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    unreadCount: 0,
    unreadMentionCount: 0,
    starredAt: null,
    mutedAt: null,
    markedUnread: false,
    userMembers: [],
    coworkerMembers: [],
    ...overrides,
    sokoBotMembers: overrides.sokoBotMembers ?? [],
  };
}

export function makeInvitation(
  overrides: Partial<ChatRoomInvitation> = {},
): ChatRoomInvitation {
  return {
    id: "inv-1",
    roomId: "ext-1",
    roomName: "Partners",
    organizationId: "org-1",
    organizationName: "Acme",
    email: "guest@example.com",
    status: "pending",
    inviter: { id: "user-2", name: "Ada" },
    expiresAt: new Date("2026-02-01T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

export function resetOrganizationChatListMocks() {
  // The Unreads filter is remembered in a cookie; one test's choice must not
  // open the next test's list.
  document.cookie = serializeChatUnreadsFilterCookie(false);
  document.documentElement.removeAttribute(CHAT_UNREADS_FILTER_BOOT_ATTRIBUTE);
  harnessPathname.current = "/chat";
  harnessSelection.current = null;
  acceptInvitationMock.mockReset();
  listRoomsMock.mockReset();
  listArchivedMock.mockReset();
  listPendingMock.mockReset();
  reorderPinnedMock.mockReset();
  listRoomsMock.mockResolvedValue(emptyListResult());
  listArchivedMock.mockResolvedValue(emptyListResult());
  listPendingMock.mockResolvedValue({ ok: true, value: [] });
  acceptInvitationMock.mockResolvedValue({
    ok: true,
    value: makeInvitation(),
  });
}

export function createOrganizationChatList({
  rooms = emptyRooms,
  archivedRooms = emptyRooms,
  pendingInvitations,
  organizationId = "org-1",
  paintOnly = false,
}: OrganizationChatListHarnessOptions = {}): ReactElement {
  return (
    <OrganizationChatList
      rooms={rooms}
      archivedRooms={archivedRooms}
      {...(pendingInvitations === undefined ? {} : { pendingInvitations })}
      currentUserId="user-1"
      organizationId={organizationId}
      canDeleteArchivedRooms={false}
      dismissSheetOnNavigate={false}
      paintOnly={paintOnly}
    />
  );
}

export function renderOrganizationChatList(
  options?: OrganizationChatListHarnessOptions,
) {
  return render(createOrganizationChatList(options));
}
