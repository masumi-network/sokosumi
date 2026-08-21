import { render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { vi } from "vitest";
import type {
  ChatRoom,
  ChatRoomInvitation,
} from "@/lib/clients/generated/core";

import { OrganizationChatList } from "../organization-chat-list.client";

const { acceptInvitationMock, listRoomsMock, listPendingMock } = vi.hoisted(
  () => ({
    acceptInvitationMock: vi.fn(),
    listRoomsMock: vi.fn(),
    listPendingMock: vi.fn(),
  }),
);

export { acceptInvitationMock, listPendingMock, listRoomsMock };

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/chat",
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

vi.mock("@/contexts/lazy-ably-provider", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/ably/use-chat-membership-revoked-control", () => ({
  useChatMembershipRevokedControl: () => {},
}));

vi.mock("@/hooks/use-chat-unread-document-title", () => ({
  useChatUnreadDocumentTitle: () => {},
}));

vi.mock("@/app/chat/actions", () => ({
  acceptChatRoomInvitationAction: (
    ...args: Parameters<typeof acceptInvitationMock>
  ) => acceptInvitationMock(...args),
  declineChatRoomInvitationAction: vi.fn(),
  deleteRoomAction: vi.fn(),
  listPendingChatRoomInvitationsAction: (
    ...args: Parameters<typeof listPendingMock>
  ) => listPendingMock(...args),
  restoreRoomAction: vi.fn(),
}));

vi.mock("@/app/chat/components/browse-channels-dialog", () => ({
  BrowseChannelsDialog: () => null,
}));

vi.mock("@/app/chat/components/room-helpers", () => ({
  getRoomDisplayName: () => "room",
}));

vi.mock("../chat-room-sidebar-row", () => ({
  ChatRoomSidebarRow: ({ label }: { label: string }) => <span>{label}</span>,
}));

vi.mock("../direct-room-avatar-stack", () => ({
  DirectRoomAvatarStack: () => null,
}));

vi.mock("../organization-chat-list.actions", () => ({
  listOrganizationChatRoomsAction: (
    ...args: Parameters<typeof listRoomsMock>
  ) => listRoomsMock(...args),
  listOrganizationArchivedChatRoomsAction: vi.fn(async () => ({
    ok: true,
    value: { rooms: [], nextCursor: null },
  })),
  loadMoreOrganizationArchivedChatRoomsAction: vi.fn(),
  loadMoreOrganizationChatRoomsAction: vi.fn(),
}));

vi.mock("@/components/ui/sheet", () => ({
  SheetClose: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarGroup: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarGroupContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarMenu: ({ children }: { children: ReactNode }) => <ul>{children}</ul>,
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
  pendingInvitations?: ChatRoomInvitation[];
  organizationId?: string | null;
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
    slug: overrides.id,
    directKey: null,
    topic: null,
    discoverability: overrides.kind === "channel" ? "public" : null,
    createdByUserId: "user-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    unreadCount: 0,
    unreadMentionCount: 0,
    pinnedAt: null,
    mutedAt: null,
    markedUnread: false,
    userMembers: [],
    coworkerMembers: [],
    ...overrides,
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
  acceptInvitationMock.mockReset();
  listRoomsMock.mockReset();
  listPendingMock.mockReset();
  listRoomsMock.mockResolvedValue(emptyListResult());
  listPendingMock.mockResolvedValue({ ok: true, value: [] });
  acceptInvitationMock.mockResolvedValue({
    ok: true,
    value: makeInvitation(),
  });
}

export function createOrganizationChatList({
  rooms = emptyRooms,
  pendingInvitations,
  organizationId = "org-1",
}: OrganizationChatListHarnessOptions = {}): ReactElement {
  return (
    <OrganizationChatList
      rooms={rooms}
      roomsNextCursor={null}
      archivedRooms={emptyRooms}
      archivedRoomsNextCursor={null}
      {...(pendingInvitations === undefined ? {} : { pendingInvitations })}
      currentUserId="user-1"
      organizationId={organizationId}
      canDeleteArchivedRooms={false}
      dismissSheetOnNavigate={false}
    />
  );
}

export function renderOrganizationChatList(
  options?: OrganizationChatListHarnessOptions,
) {
  return render(createOrganizationChatList(options));
}
