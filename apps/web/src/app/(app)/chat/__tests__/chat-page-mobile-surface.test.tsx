import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getSessionMock = vi.fn();
const getActiveOrganizationIdMock = vi.fn();
const listCoworkersMock = vi.fn();
const getActivitySummaryMock = vi.fn();
const getPrivateCachedMembershipVisibleRoomsMock = vi.fn();
const getPrivateCachedChatListArchivedAndMembersMock = vi.fn();

vi.mock("next/server", () => ({
  connection: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("@/lib/services", () => ({
  userService: {
    getActiveOrganizationId: (...args: unknown[]) =>
      getActiveOrganizationIdMock(...args),
    getActiveOrganization: vi.fn(),
    getMyMemberInOrganization: vi.fn(),
  },
}));

vi.mock("@/lib/services/coworker.service", () => ({
  coworkerService: {
    listCoworkers: (...args: unknown[]) => listCoworkersMock(...args),
  },
}));

vi.mock("@/lib/services/task.service", () => ({
  taskService: {
    getActivitySummary: (...args: unknown[]) => getActivitySummaryMock(...args),
  },
}));

vi.mock("@/app/components/private-sidebar-cache", () => ({
  getPrivateCachedMembershipVisibleRooms: (...args: unknown[]) =>
    getPrivateCachedMembershipVisibleRoomsMock(...args),
  getPrivateCachedChatListArchivedAndMembers: (...args: unknown[]) =>
    getPrivateCachedChatListArchivedAndMembersMock(...args),
}));

vi.mock("../components/chat-mobile-room-list", () => ({
  ChatMobileRoomList: function ChatMobileRoomList() {
    return <div data-testid="chat-mobile-room-list" />;
  },
}));

import ChatPage from "../page";

function componentName(element: ReactElement): string | null {
  const type = element.type;
  if (typeof type === "function") {
    return type.name || null;
  }
  return null;
}

function findByName(node: ReactNode, name: string): ReactElement | null {
  if (node == null || typeof node === "boolean" || typeof node === "string") {
    return null;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByName(child, name);
      if (found) {
        return found;
      }
    }
    return null;
  }
  if (!isValidElement(node)) {
    return null;
  }
  if (componentName(node) === name) {
    return node;
  }
  const props = node.props as { children?: ReactNode };
  return findByName(props.children, name);
}

describe("ChatPage mobile surface at chat root", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({
      user: { id: "user_1", name: "Ada", email: "ada@example.com" },
      session: { activeOrganizationId: "org_1" },
    });
    getActiveOrganizationIdMock.mockResolvedValue("org_1");
    listCoworkersMock.mockResolvedValue([]);
    getActivitySummaryMock.mockResolvedValue({
      completed: 0,
      blocked: 0,
      added: 0,
      basis: "recent",
    });
  });

  it("renders Chat landing on mobile when there are no rooms", async () => {
    getPrivateCachedMembershipVisibleRoomsMock.mockResolvedValue({
      rooms: [],
      nextCursor: null,
    });
    getPrivateCachedChatListArchivedAndMembersMock.mockResolvedValue({
      archivedChatRoomsPage: { rooms: [], nextCursor: null },
      members: [],
    });

    const tree = await ChatPage({ searchParams: Promise.resolve({}) });

    expect(findByName(tree, "ChatLanding")).not.toBeNull();
    expect(findByName(tree, "ChatLandingMobile")).not.toBeNull();
    expect(findByName(tree, "ChatMobileRoomList")).toBeNull();
    expect(getPrivateCachedChatListArchivedAndMembersMock).toHaveBeenCalled();
  });

  it("renders the room list on mobile when membership-visible rooms exist", async () => {
    getPrivateCachedMembershipVisibleRoomsMock.mockResolvedValue({
      rooms: [{ id: "room-1", name: "General" }],
      nextCursor: null,
    });

    const tree = await ChatPage({ searchParams: Promise.resolve({}) });

    expect(findByName(tree, "ChatLanding")).not.toBeNull();
    expect(findByName(tree, "ChatMobileRoomList")).not.toBeNull();
    expect(findByName(tree, "ChatLandingMobile")).toBeNull();
    expect(
      getPrivateCachedChatListArchivedAndMembersMock,
    ).not.toHaveBeenCalled();
  });

  it("renders the room list on mobile when only archived rooms exist", async () => {
    getPrivateCachedMembershipVisibleRoomsMock.mockResolvedValue({
      rooms: [],
      nextCursor: null,
    });
    getPrivateCachedChatListArchivedAndMembersMock.mockResolvedValue({
      archivedChatRoomsPage: {
        rooms: [{ id: "old", name: "Old" }],
        nextCursor: null,
      },
      members: [],
    });

    const tree = await ChatPage({ searchParams: Promise.resolve({}) });

    expect(findByName(tree, "ChatMobileRoomList")).not.toBeNull();
    expect(findByName(tree, "ChatLandingMobile")).toBeNull();
  });

  it("still shows room-unavailable notice when the mobile list renders", async () => {
    getPrivateCachedMembershipVisibleRoomsMock.mockResolvedValue({
      rooms: [{ id: "room-1", name: "General" }],
      nextCursor: null,
    });

    const tree = await ChatPage({
      searchParams: Promise.resolve({ notice: "room-unavailable" }),
    });

    const notice = findByName(tree, "ChatLandingNotice");
    expect(notice).not.toBeNull();
    expect(
      (notice?.props as { notice?: string | null } | undefined)?.notice,
    ).toBe("room-unavailable");
    expect(findByName(tree, "ChatMobileRoomList")).not.toBeNull();
  });
});
