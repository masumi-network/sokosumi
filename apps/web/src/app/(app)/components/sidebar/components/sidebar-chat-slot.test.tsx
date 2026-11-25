import type { SessionUser } from "@sokosumi/utils";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import {
  type ComponentProps,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en.json";
import { TestQueryProvider } from "@/test/query-provider";

import { SidebarChatSlot } from "./sidebar-chat-slot";

const { loadSidebarChatListMock } = vi.hoisted(() => ({
  loadSidebarChatListMock: vi.fn(),
}));

vi.mock("@/app/components/private-sidebar-cache", () => ({
  loadSidebarChatList: (...args: unknown[]) => loadSidebarChatListMock(...args),
}));

// The room list itself has its own tests; here it only has to show its rooms.
vi.mock("@/app/components/sidebar-chat-list.client", () => ({
  SidebarChatList: ({
    rooms,
  }: {
    rooms: Array<{ id: string; name: string }>;
  }) => (
    <ul>
      {rooms.map((room) => (
        <li key={room.id}>{room.name}</li>
      ))}
    </ul>
  ),
}));

vi.mock("@/components/chat/use-live-chat-rooms", () => ({
  useLiveChatRooms: () => [],
}));

vi.mock("@/components/chat/use-show-room-unread-count", () => ({
  useShowRoomUnreadCount: () => true,
}));

vi.mock("@/app/chat/actions", () => ({
  markAllChatUnreadReadAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: { children: ReactNode } & ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock("@/components/ui/sidebar", async () => ({
  ...(await vi.importActual<typeof import("@/components/ui/sidebar")>(
    "@/components/ui/sidebar",
  )),
  SidebarMenuButton: ({
    children,
    asChild,
  }: {
    children: ReactNode;
    asChild?: boolean;
  }) => (asChild === true && isValidElement(children) ? children : children),
  useSidebar: () => ({ isMobile: false }),
  SidebarMenu: ({ children }: { children: ReactNode }) => <ul>{children}</ul>,
  SidebarMenuItem: ({ children }: { children: ReactNode }) => (
    <li>{children}</li>
  ),
}));

vi.mock("@/components/ui/sheet", () => ({
  SheetClose: ({ children }: { children: ReactNode }) => children,
}));

const ROOMS = [{ id: "room-1", name: "launch-plans" }];

function sessionUser(feedMode: boolean): SessionUser {
  return { id: "user-1", feedMode } as SessionUser;
}

/**
 * The slot's tree with its async room loader awaited in place: happy-dom
 * cannot render an async Server Component, so this does what the server does.
 */
async function resolveServerTree(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) {
    return Promise.all(node.map(resolveServerTree));
  }
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (
    typeof element.type === "function" &&
    element.type.constructor.name === "AsyncFunction"
  ) {
    const type = element.type as (props: unknown) => Promise<ReactNode>;
    return resolveServerTree(await type(element.props));
  }
  if (element.props.children === undefined) return element;
  return cloneElement(
    element,
    undefined,
    await resolveServerTree(element.props.children),
  );
}

async function renderSlot(feedMode: boolean) {
  const tree = await resolveServerTree(
    SidebarChatSlot({
      sessionUser: sessionUser(feedMode),
      activeOrganizationId: "org-1",
    }),
  );
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TestQueryProvider>{tree}</TestQueryProvider>
    </NextIntlClientProvider>,
  );
}

describe("SidebarChatSlot", () => {
  beforeEach(() => {
    loadSidebarChatListMock.mockReset();
    loadSidebarChatListMock.mockResolvedValue({
      rooms: ROOMS,
      deferred: new Promise(() => {}),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: { items: [], nextCursor: null, unreadCount: 3 },
              meta: { timestamp: new Date().toISOString(), requestId: "r1" },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Feed mode is the room list's replacement. A slot that still read or
  // drew the rooms would spend the rooms read and show the list the reader
  // switched off.
  it("shows the Feed row with its unread count and never reads the rooms in feed mode", async () => {
    await renderSlot(true);

    const feedRow = screen.getByTestId("chat-feed-row");
    expect(feedRow).toHaveAttribute("href", "/chat/feed");
    expect(await screen.findByText("3 unread messages")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      "/api/chat/feed?limit=1",
      expect.anything(),
    );
    expect(screen.getByTestId("chat-catch-up-row")).toBeInTheDocument();
    expect(screen.queryByText("launch-plans")).toBeNull();
    expect(loadSidebarChatListMock).not.toHaveBeenCalled();
  });

  it("shows the room list and no Feed row with feed mode off", async () => {
    await renderSlot(false);

    expect(screen.getByText("launch-plans")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-feed-row")).toBeNull();
    expect(loadSidebarChatListMock).toHaveBeenCalledWith({
      userId: "user-1",
      activeOrganizationId: "org-1",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
