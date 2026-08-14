import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ChatRoom } from "@/lib/clients/generated/core";

import { OrganizationChatList } from "../organization-chat-list.client";

/**
 * Production: mobile `/chat` mounts OrganizationChatList without
 * `pendingInvitations`. Default `= []` creates a new array every render;
 * render-time `pendingInvitations !== prevPendingInvitations` sync then
 * never converges → React #301 → Chat Error boundary.
 */

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
  useTranslations: () => (key: string) => key,
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
  acceptChatRoomInvitationAction: vi.fn(),
  declineChatRoomInvitationAction: vi.fn(),
  deleteRoomAction: vi.fn(),
  listPendingChatRoomInvitationsAction: vi.fn(async () => ({
    ok: true,
    value: [],
  })),
  restoreRoomAction: vi.fn(),
}));

vi.mock("@/app/chat/components/browse-channels-dialog", () => ({
  BrowseChannelsDialog: () => null,
}));

vi.mock("@/app/chat/components/room-helpers", () => ({
  getRoomDisplayName: () => "room",
}));

vi.mock("../chat-room-sidebar-row", () => ({
  ChatRoomSidebarRow: () => null,
}));

vi.mock("../direct-room-avatar-stack", () => ({
  DirectRoomAvatarStack: () => null,
}));

vi.mock("../organization-chat-list.actions", () => ({
  listOrganizationChatRoomsAction: vi.fn(async () => ({
    ok: true,
    value: { rooms: [], nextCursor: null },
  })),
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

const emptyRooms: ChatRoom[] = [];

function renderChatsTabList() {
  return (
    <OrganizationChatList
      rooms={emptyRooms}
      roomsNextCursor={null}
      archivedRooms={emptyRooms}
      archivedRoomsNextCursor={null}
      currentUserId="user-1"
      organizationId="org-1"
      canDeleteArchivedRooms={false}
      dismissSheetOnNavigate={false}
    />
  );
}

describe("OrganizationChatList pendingInvitations default (Chat Error / #301)", () => {
  it("survives re-render when pendingInvitations prop is omitted", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      const { rerender } = render(renderChatsTabList());
      expect(() => {
        rerender(renderChatsTabList());
      }).not.toThrow();
      expect(
        consoleError.mock.calls.some((call) =>
          call.some((arg) =>
            typeof arg === "string"
              ? arg.includes("Too many re-renders")
              : arg instanceof Error &&
                arg.message.includes("Too many re-renders"),
          ),
        ),
      ).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });
});
