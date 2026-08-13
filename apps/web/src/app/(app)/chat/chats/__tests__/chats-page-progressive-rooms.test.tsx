import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getSessionMock = vi.fn();
const getPrivateCachedMembershipVisibleRoomsMock = vi.fn();
const getPrivateCachedChatListArchivedAndMembersMock = vi.fn();

vi.mock("next/server", () => ({
  connection: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("@/lib/hermes/beta-access", () => ({
  isHermesBetaAccessEmail: () => false,
}));

vi.mock("@/app/components/private-sidebar-cache", () => ({
  getPrivateCachedMembershipVisibleRooms: (...args: unknown[]) =>
    getPrivateCachedMembershipVisibleRoomsMock(...args),
  getPrivateCachedChatListArchivedAndMembers: (...args: unknown[]) =>
    getPrivateCachedChatListArchivedAndMembersMock(...args),
}));

vi.mock(
  "@/app/components/sidebar/components/personal-assistant-nav.client",
  () => ({
    default: () => <div data-testid="personal-assistant-nav" />,
  }),
);

vi.mock("@/components/chat/organization-chat-list.client", () => ({
  OrganizationChatList: (props: {
    rooms: Array<{ id: string; name?: string | null }>;
    archivedRooms: unknown[];
    canDeleteArchivedRooms?: boolean;
  }) => (
    <div
      data-testid="organization-chat-list"
      data-room-names={props.rooms.map((room) => room.name).join("|")}
      data-archived-count={String(props.archivedRooms.length)}
      data-can-delete={String(Boolean(props.canDeleteArchivedRooms))}
    />
  ),
}));

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarSeparator: () => <hr />,
}));

import ChatChatsPage from "@/app/chat/chats/page";

const USER_ID = "user_1";
const ORG_ID = "org_1";

interface OrganizationChatListProps {
  rooms: Array<{ id: string; name?: string | null }>;
  archivedRooms: unknown[];
  canDeleteArchivedRooms?: boolean;
  dismissSheetOnNavigate?: boolean;
}

interface SuspenseLikeProps {
  fallback?: ReactElement;
  children?: ReactNode;
}

interface ClassNameProps {
  className?: string;
  children?: ReactNode;
}

function findElement(
  node: ReactNode,
  predicate: (element: ReactElement) => boolean,
): ReactElement | null {
  if (node == null || typeof node === "boolean" || typeof node === "string") {
    return null;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found) {
        return found;
      }
    }
    return null;
  }
  if (!isValidElement(node)) {
    return null;
  }
  if (predicate(node)) {
    return node;
  }
  const props = node.props as { children?: ReactNode };
  return findElement(props.children, predicate);
}

function suspenseProps(element: ReactElement): SuspenseLikeProps {
  return element.props as SuspenseLikeProps;
}

function listProps(element: ReactElement): OrganizationChatListProps {
  return element.props as OrganizationChatListProps;
}

describe("ChatChatsPage progressive rooms (mobile LCP)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({
      user: { id: USER_ID, email: "alice@example.com" },
      session: { activeOrganizationId: ORG_ID },
    });
    getPrivateCachedMembershipVisibleRoomsMock.mockResolvedValue({
      rooms: [{ id: "room-1", name: "Plan.Net Studios x NMKR" }],
      nextCursor: null,
    });
  });

  it("paints OrganizationChatList room labels while archived+members stay pending", async () => {
    getPrivateCachedChatListArchivedAndMembersMock.mockReturnValue(
      new Promise(() => {}),
    );

    const tree = await ChatChatsPage();

    // Parent finishes after membership rooms; Suspense fallback already has
    // real row text. Deferred chrome is a sibling child, not awaited here.
    expect(getPrivateCachedMembershipVisibleRoomsMock).toHaveBeenCalledTimes(1);
    expect(getPrivateCachedMembershipVisibleRoomsMock).toHaveBeenCalledWith({
      userId: USER_ID,
      activeOrganizationId: ORG_ID,
    });

    const suspense = findElement(tree, (el) => {
      const props = el.props as SuspenseLikeProps;
      return props.fallback != null && props.children != null;
    });

    expect(suspense).not.toBeNull();
    const fallback = suspenseProps(suspense as ReactElement).fallback;
    expect(fallback).toBeDefined();
    const props = listProps(fallback as ReactElement);
    expect(props.rooms).toEqual([
      { id: "room-1", name: "Plan.Net Studios x NMKR" },
    ]);
    expect(props.archivedRooms).toEqual([]);
    expect(props.canDeleteArchivedRooms).toBe(false);
    expect(props.dismissSheetOnNavigate).toBe(false);

    // Deferred fetch is started by the Suspense child type, not by the parent
    // await — calling the page must not require archived/members to resolve.
    expect(
      getPrivateCachedChatListArchivedAndMembersMock,
    ).not.toHaveBeenCalled();
  });

  it("keeps md:hidden mobile-only shell", async () => {
    getPrivateCachedChatListArchivedAndMembersMock.mockResolvedValue({
      archivedChatRoomsPage: { rooms: [], nextCursor: null },
      members: [],
    });

    const tree = await ChatChatsPage();
    const shell = findElement(tree, (el) => {
      const props = el.props as ClassNameProps;
      return (
        typeof props.className === "string" &&
        props.className.includes("md:hidden")
      );
    });

    expect(shell).not.toBeNull();
  });
});
