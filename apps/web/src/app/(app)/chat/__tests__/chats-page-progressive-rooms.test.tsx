import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getSessionMock = vi.fn();
const loadSidebarChatListMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("next/server", () => ({
  connection: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("@/app/components/private-sidebar-cache", () => ({
  loadSidebarChatList: (...args: unknown[]) => loadSidebarChatListMock(...args),
}));

vi.mock(
  "@/app/components/sidebar/components/personal-assistant-nav.client",
  () => ({
    default: () => <div data-testid="personal-assistant-nav" />,
  }),
);

vi.mock("@/app/components/sidebar-chat-list.client", () => ({
  SidebarChatList: function SidebarChatList() {
    return null;
  },
}));

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarSeparator: () => <hr />,
}));

vi.mock("@/app/chat/components/chat-desktop-home-redirect.client", () => ({
  ChatDesktopHomeRedirect: () => null,
}));

import ChatPage from "@/app/chat/page";
import { SidebarChatList } from "@/app/components/sidebar-chat-list.client";

const USER_ID = "user_1";
const ORG_ID = "org_1";

interface ChatListProps {
  rooms: Array<{ id: string; name?: string | null }>;
  deferred: Promise<unknown>;
  variant?: string;
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

describe("ChatPage progressive rooms (mobile LCP)", () => {
  const rooms = [{ id: "room-1", name: "Launch Plans" }];

  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({
      user: { id: USER_ID, email: "alice@example.com" },
      session: { activeOrganizationId: ORG_ID },
    });
  });

  it("mounts one list with the rooms while archived+members stay pending", async () => {
    const deferred = new Promise(() => {});
    loadSidebarChatListMock.mockResolvedValue({ rooms, deferred });

    const tree = await ChatPage({ searchParams: Promise.resolve({}) });

    expect(loadSidebarChatListMock).toHaveBeenCalledTimes(1);
    expect(loadSidebarChatListMock).toHaveBeenCalledWith({
      userId: USER_ID,
      activeOrganizationId: ORG_ID,
    });

    // One list, handed the pending read: no Suspense fallback list that a
    // second list replaces when the read lands.
    const fallback = findElement(
      tree,
      (el) => (el.props as { fallback?: unknown }).fallback != null,
    );
    expect(fallback).toBeNull();

    const list = findElement(tree, (el) => el.type === SidebarChatList);
    expect(list).not.toBeNull();
    const props = (list as ReactElement).props as ChatListProps;
    expect(props.rooms).toBe(rooms);
    expect(props.deferred).toBe(deferred);
    expect(props.variant).toBe("page");
  });

  it("keeps md:hidden mobile-only shell", async () => {
    loadSidebarChatListMock.mockResolvedValue({
      rooms,
      deferred: Promise.resolve({
        archivedRooms: [],
        isOrgOwnerOrAdmin: false,
      }),
    });

    const tree = await ChatPage({ searchParams: Promise.resolve({}) });
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
