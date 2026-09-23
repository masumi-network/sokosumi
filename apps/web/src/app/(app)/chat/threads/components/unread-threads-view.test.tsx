import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/../messages/en.json";
import { makeRoom } from "@/components/chat/__tests__/chat-room-fixtures";
import type { ChatRoom } from "@/lib/clients/generated/core";
import type { ChatUnreadThreadsPage } from "@/lib/services/chat-room.service";

import { UnreadThreadsView } from "./unread-threads-view";

const { liveRooms, fetchUnreadThreadsMock } = vi.hoisted(() => ({
  liveRooms: { current: [] as ChatRoom[] },
  fetchUnreadThreadsMock: vi.fn(),
}));

vi.mock("@/components/chat/use-live-chat-rooms", () => ({
  useLiveChatRooms: () => liveRooms.current,
}));

vi.mock("@/components/chat/fetch-chat-unread-threads", () => ({
  fetchChatUnreadThreads: (...args: unknown[]) =>
    fetchUnreadThreadsMock(...args),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const sokosumi = makeRoom({
  id: "room-sokosumi",
  name: "sokosumi",
  unreadThreadCount: 1,
  threadUnreadCount: 2,
});
const design = makeRoom({
  id: "room-design",
  name: "design",
  unreadThreadCount: 1,
  threadUnreadCount: 1,
});

function page(): ChatUnreadThreadsPage {
  return {
    threads: [
      {
        roomId: "room-design",
        parentMessageId: "p-design",
        firstUnreadReplyId: "r-design",
        parentContent: "added it into linear",
        unreadReplyCount: 1,
        unreadMentionCount: 0,
      },
      {
        roomId: "room-sokosumi",
        parentMessageId: "p-sokosumi",
        firstUnreadReplyId: "r-sokosumi",
        parentContent: "should be vendor-wide",
        unreadReplyCount: 2,
        unreadMentionCount: 1,
      },
    ],
    nextCursor: null,
  };
}

function renderView(
  initialPage: ChatUnreadThreadsPage | null = page(),
  staleTime = 0,
) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, staleTime } },
        })
      }
    >
      <NextIntlClientProvider locale="en" messages={messages}>
        <UnreadThreadsView
          initialPage={initialPage}
          initialRooms={[sokosumi, design]}
          currentUserId="user-1"
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  liveRooms.current = [];
  fetchUnreadThreadsMock.mockResolvedValue(page());
});

describe("UnreadThreadsView", () => {
  it("lists each unread Thread with its room, opening it in that room", () => {
    renderView();

    const list = screen.getByRole("list", { name: "Unread threads" });
    const rows = within(list).getAllByRole("link");
    expect(rows.map((row) => row.getAttribute("href"))).toEqual([
      "/chat/rooms/room-design?message=r-design",
      "/chat/rooms/room-sokosumi?message=r-sokosumi",
    ]);
    expect(rows[0]).toHaveTextContent("added it into linear");
    expect(rows[0]).toHaveTextContent("#design");
    expect(rows[1]).toHaveTextContent("1 mention, 2 unread replies");
  });

  it("says the reader is caught up once the rooms hold no unread Thread", () => {
    liveRooms.current = [
      { ...sokosumi, unreadThreadCount: 0, threadUnreadCount: 0 },
      { ...design, unreadThreadCount: 0, threadUnreadCount: 0 },
    ];
    renderView();

    expect(screen.getByText("You’re all caught up")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Unread threads" })).toBeNull();
  });

  it("drops a Thread whose room the reader has muted since", async () => {
    liveRooms.current = [
      sokosumi,
      { ...design, mutedAt: new Date("2026-09-01T00:00:00.000Z") },
    ];
    renderView();

    const list = await screen.findByRole("list", { name: "Unread threads" });
    expect(within(list).getAllByRole("link")).toHaveLength(1);
  });

  it("reads again when the live rooms have already moved past the server page", async () => {
    liveRooms.current = [{ ...sokosumi, threadUnreadCount: 9 }, design];
    renderView(page(), 60_000);

    await screen.findByRole("list", { name: "Unread threads" });
    expect(fetchUnreadThreadsMock).toHaveBeenCalledWith(undefined);
  });

  it("reads the first page itself when the server's read failed", async () => {
    renderView(null);

    const list = await screen.findByRole("list", { name: "Unread threads" });
    expect(within(list).getAllByRole("link")).toHaveLength(2);
    expect(fetchUnreadThreadsMock).toHaveBeenCalledWith(undefined);
  });
});
