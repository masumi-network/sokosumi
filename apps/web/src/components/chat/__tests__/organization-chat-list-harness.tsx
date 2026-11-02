import type { ChatRoom, ChatRoomInvitation } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import {
  type ComponentProps,
  createContext,
  type ReactElement,
  type ReactNode,
  use,
} from "react";
import { vi } from "vitest";
import { OrganizationChatList } from "@/components/chat/organization-chat-list.client";
import { rememberPinnedRooms } from "@/components/chat/remembered-pinned-rooms";
import { OtherWorkspaceRoomsLive } from "@/components/chat/use-other-workspace-rooms";
import {
  CHAT_UNREADS_FILTER_BOOT_ATTRIBUTE,
  serializeChatUnreadsFilterCookie,
} from "@/lib/ui-preferences/chat-unreads-filter";

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
  listElsewhereMock,
  listPendingMock,
  markAllReadMock,
  reorderPinnedMock,
  harnessRealCatchUp,
  harnessRowProps,
} = vi.hoisted(() => ({
  acceptInvitationMock: vi.fn(),
  listRoomsMock: vi.fn(),
  listArchivedMock: vi.fn(),
  listElsewhereMock: vi.fn(),
  listPendingMock: vi.fn(),
  markAllReadMock: vi.fn(),
  reorderPinnedMock: vi.fn(),
  /** On, Catch up and Mark all as read are the real ones, not markers. */
  harnessRealCatchUp: { current: false },
  /** What each room row last received, by room id. */
  harnessRowProps: new Map<string, Record<string, unknown>>(),
}));

export {
  acceptInvitationMock,
  harnessPathname,
  harnessRealCatchUp,
  harnessRowProps,
  harnessSelection,
  listArchivedMock,
  listElsewhereMock,
  listPendingMock,
  listRoomsMock,
  markAllReadMock,
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

// Values ride after the key, so a test can see what a label was given.
vi.mock("next-intl", () => ({
  useTranslations:
    (namespace?: string) => (key: string, values?: Record<string, unknown>) =>
      [
        namespace ? `${namespace}.${key}` : key,
        ...Object.values(values ?? {}),
      ].join(" "),
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
  markAllChatUnreadReadAction: (...args: Parameters<typeof markAllReadMock>) =>
    markAllReadMock(...args),
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

// Every Direct reads "room" but the Self Direct, which keeps its real name.
vi.mock("@/app/chat/components/room-helpers", async (importActual) => {
  const actual =
    await importActual<typeof import("@/app/chat/components/room-helpers")>();
  return {
    getRoomDisplayName: (
      ...args: Parameters<typeof actual.getRoomDisplayName>
    ) => (args[0].isSelfDirect ? actual.getRoomDisplayName(...args) : "room"),
  };
});

vi.mock("@/components/chat/chat-room-sidebar-row", () => ({
  ChatRoomSidebarRow: ({
    label,
    subtitle,
    reorderHandle,
    itemProps,
    ...props
  }: {
    room: ChatRoom;
    label: string;
    subtitle?: string;
    reorderHandle?: ReactNode;
    itemProps?: ComponentProps<"li">;
  }) => {
    harnessRowProps.set(props.room.id, props);
    return (
      <li {...itemProps} data-testid="room-row">
        <span>{label}</span>
        {subtitle ? <span>{subtitle}</span> : null}
        {reorderHandle}
      </li>
    );
  },
}));

// A marker, not the rows: what they count belongs to
// `chat-unread-nav-rows.test.tsx`. The list decides where they stand and
// what the All unreads filter does to the sections, so the marker keeps the
// toggle — on the row where the row carries it, and as the chip where a
// Chats heading does.
function UnreadsToggleMarker({
  unreadOnly,
  onUnreadOnlyChange,
}: {
  unreadOnly: boolean;
  onUnreadOnlyChange: (unreadOnly: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={unreadOnly}
      onClick={() => onUnreadOnlyChange(!unreadOnly)}
    >
      All unreads
    </button>
  );
}

vi.mock("@/components/chat/chat-unread-nav-rows", async (importActual) => {
  const actual =
    await importActual<
      typeof import("@/components/chat/chat-unread-nav-rows")
    >();
  return {
    ChatUnreadNavRows: (
      props: ComponentProps<typeof actual.ChatUnreadNavRows>,
    ) =>
      harnessRealCatchUp.current ? (
        <actual.ChatUnreadNavRows {...props} />
      ) : (
        <li data-testid="chat-unread-nav-rows">
          {props.onUnreadOnlyChange ? (
            <UnreadsToggleMarker
              unreadOnly={props.unreadOnly}
              onUnreadOnlyChange={props.onUnreadOnlyChange}
            />
          ) : null}
        </li>
      ),
    ChatUnreadsFilterChip: UnreadsToggleMarker,
    // When it shows past the filter is the row's test's; the list decides only
    // where it stands.
    ChatMarkAllReadButton: (
      props: ComponentProps<typeof actual.ChatMarkAllReadButton>,
    ) =>
      harnessRealCatchUp.current ? (
        <actual.ChatMarkAllReadButton {...props} />
      ) : props.unreadOnly ? (
        <button type="button">Mark all as read</button>
      ) : null,
  };
});

vi.mock("@/components/chat/direct-room-avatar-stack", () => ({
  DirectRoomAvatarStack: () => null,
}));

vi.mock("@/components/chat/organization-chat-list.actions", () => ({
  listOrganizationChatRoomsAction: (
    ...args: Parameters<typeof listRoomsMock>
  ) => listRoomsMock(...args),
  reorderPinnedOrganizationChatRoomsAction: (
    ...args: Parameters<typeof reorderPinnedMock>
  ) => reorderPinnedMock(...args),
}));

vi.mock("@/components/chat/fetch-sidebar-room-collection", () => ({
  fetchSidebarRoomCollection: async (collection: string) => {
    if (collection === "elsewhere") {
      return listElsewhereMock();
    }
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

// Open state as Radix keeps it — `aria-expanded` on the trigger, `data-state`
// on the content — but a closed section's rows stay rendered, so a test can
// still reach Archived, which starts folded.
const CollapsibleMockContext = createContext<{
  open: boolean;
  onOpenChange?: (open: boolean) => void;
}>({ open: true });

vi.mock("@/components/ui/collapsible", () => ({
  Collapsible: ({
    children,
    open = true,
    onOpenChange,
  }: {
    children: ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) => (
    <CollapsibleMockContext.Provider value={{ open, onOpenChange }}>
      <div>{children}</div>
    </CollapsibleMockContext.Provider>
  ),
  CollapsibleContent: function CollapsibleContent({
    children,
  }: {
    children: ReactNode;
  }) {
    const { open } = use(CollapsibleMockContext);
    return (
      <div
        data-slot="collapsible-content"
        data-state={open ? "open" : "closed"}
      >
        {children}
      </div>
    );
  },
  CollapsibleTrigger: function CollapsibleTrigger({
    children,
  }: {
    children: ReactNode;
  }) {
    const { open, onOpenChange } = use(CollapsibleMockContext);
    return (
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onOpenChange?.(!open)}
      >
        {children}
      </button>
    );
  },
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

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** One per test, as the app has one per tab, so a test's rooms stay its own. */
let harnessQueryClient = makeQueryClient();

export interface OrganizationChatListHarnessOptions {
  rooms?: ChatRoom[];
  archivedRooms?: ChatRoom[];
  pendingInvitations?: ChatRoomInvitation[];
  organizationId?: string | null;
  paintOnly?: boolean;
  /** As the sidebar mounts it; the phone's Chats page leaves it out. */
  withChatsHeading?: boolean;
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
    isReadOnly: false,
    formerUserMembers: [],
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
  harnessRealCatchUp.current = false;
  markAllReadMock.mockReset();
  markAllReadMock.mockResolvedValue({ ok: true, value: null });
  acceptInvitationMock.mockReset();
  listRoomsMock.mockReset();
  listArchivedMock.mockReset();
  listPendingMock.mockReset();
  listElsewhereMock.mockReset();
  reorderPinnedMock.mockReset();
  harnessRowProps.clear();
  rememberPinnedRooms("", []);
  harnessQueryClient = makeQueryClient();
  listElsewhereMock.mockResolvedValue([]);
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
  withChatsHeading = false,
}: OrganizationChatListHarnessOptions = {}): ReactElement {
  return (
    <QueryClientProvider client={harnessQueryClient}>
      <OtherWorkspaceRoomsLive />
      <OrganizationChatList
        rooms={rooms}
        archivedRooms={archivedRooms}
        {...(pendingInvitations === undefined ? {} : { pendingInvitations })}
        currentUserId="user-1"
        organizationId={organizationId}
        isOrgOwnerOrAdmin={false}
        dismissSheetOnNavigate={false}
        paintOnly={paintOnly}
        withChatsHeading={withChatsHeading}
      />
    </QueryClientProvider>
  );
}

export function renderOrganizationChatList(
  options?: OrganizationChatListHarnessOptions,
) {
  return render(createOrganizationChatList(options));
}
