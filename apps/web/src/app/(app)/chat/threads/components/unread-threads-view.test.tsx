import type { ChatRoom } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/../messages/en.json";
import {
  makeRoom,
  makeUser,
} from "@/components/chat/__tests__/chat-room-fixtures";
import { SearchablePageContent } from "@/components/searchable-page-content";
import type { ChatUnreadThreadsPage } from "@/lib/services/chat-room.service";

import { UnreadThreadsView } from "./unread-threads-view";

const { liveRooms, fetchUnreadThreadsMock, fetchEarlierThreadsMock } =
  vi.hoisted(() => ({
    liveRooms: { current: null as ChatRoom[] | null },
    fetchUnreadThreadsMock: vi.fn(),
    fetchEarlierThreadsMock: vi.fn(),
  }));

vi.mock("@/components/chat/use-live-chat-rooms", () => ({
  useLiveChatRooms: () => liveRooms.current,
}));

vi.mock("@/components/chat/fetch-chat-threads", () => ({
  fetchChatUnreadThreads: (...args: unknown[]) =>
    fetchUnreadThreadsMock(...args),
  fetchChatEarlierThreads: (...args: unknown[]) =>
    fetchEarlierThreadsMock(...args),
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
        lastUnreadAt: new Date("2026-09-23T09:00:00.000Z"),
      },
      {
        roomId: "room-sokosumi",
        parentMessageId: "p-sokosumi",
        firstUnreadReplyId: "r-sokosumi",
        parentContent: "should be vendor-wide",
        unreadReplyCount: 2,
        unreadMentionCount: 1,
        lastUnreadAt: new Date("2026-09-23T08:00:00.000Z"),
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
          defaultOptions: {
            queries: {
              retry: false,
              staleTime,
              gcTime: Number.POSITIVE_INFINITY,
            },
            mutations: { gcTime: Number.POSITIVE_INFINITY },
          },
        })
      }
    >
      <NextIntlClientProvider locale="en" messages={messages}>
        <SearchablePageContent>
          <UnreadThreadsView
            initialPage={initialPage}
            initialRooms={[sokosumi, design]}
            currentUserId="user-1"
          />
        </SearchablePageContent>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  liveRooms.current = null;
  fetchUnreadThreadsMock.mockResolvedValue(page());
  fetchEarlierThreadsMock.mockResolvedValue({ threads: [], nextCursor: null });
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
    // What is new leads the details, in words; the @ pill is spoken as text.
    expect(rows[1]).toHaveTextContent("2 new");
    expect(rows[1]).toHaveTextContent("1 mention");
  });

  it("ranks a resolved parent mention ahead of a direct room display name in both groups", async () => {
    const member = {
      ...makeUser("019fc7e4-e4bd-7005-900c-66e44d33f5e4"),
      name: "Avery",
    };
    const userMembers = [makeUser("user-1"), member];
    liveRooms.current = [
      { ...sokosumi, userMembers },
      { ...design, kind: "direct", userMembers },
    ];
    const [direct, channel] = page().threads;
    const unread = {
      threads: [
        { ...direct, parentContent: "Review notes" },
        { ...channel, parentContent: `Ask @${member.id}:old-name` },
      ],
      nextCursor: null,
    };
    fetchUnreadThreadsMock.mockResolvedValue(unread);
    fetchEarlierThreadsMock.mockResolvedValue({
      threads: unread.threads.map((thread) => ({
        roomId: thread.roomId,
        parentMessageId: thread.parentMessageId,
        parentContent: thread.parentContent,
        replyCount: 1,
        lastReplyAt: thread.lastUnreadAt,
        lastReplyId: thread.firstUnreadReplyId,
      })),
      nextCursor: null,
    });
    renderView(unread);
    await screen.findByTestId("earlier-threads-list");
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Avery" },
    });
    for (const group of ["unread-threads-list", "earlier-threads-list"]) {
      const links = within(screen.getByTestId(group)).getAllByRole("link");
      expect(links).toHaveLength(2);
      expect(links[0]).toHaveTextContent("Ask @Avery");
      expect(links[1]).toHaveTextContent("Review notes");
      expect(links[1]).toHaveTextContent("Avery");
    }
  });

  it("says the reader is caught up once the rooms hold no unread Thread", () => {
    liveRooms.current = [
      { ...sokosumi, unreadThreadCount: 0, threadUnreadCount: 0 },
      { ...design, unreadThreadCount: 0, threadUnreadCount: 0 },
    ];
    renderView();

    expect(screen.getByText("You're all caught up")).toBeInTheDocument();
    expect(
      screen.getByText("New replies in threads you're part of show up here."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Unread threads" })).toBeNull();
    // The live rooms already said so; Core is not asked.
    expect(fetchUnreadThreadsMock).not.toHaveBeenCalled();
  });

  // An empty live read is an answer: the reader is in no room now, and the
  // cached rooms the server rendered with must not stand in for it.
  it("says the reader is caught up when the live read finds no room", () => {
    liveRooms.current = [];
    renderView();

    expect(screen.getByText("You're all caught up")).toBeInTheDocument();
    expect(
      screen.getByText("New replies in threads you're part of show up here."),
    ).toBeInTheDocument();
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

  it("drops the server page when the live rooms are cleared", () => {
    function Probe({ live }: { live: ChatRoom[] | null }) {
      liveRooms.current = live;
      return (
        <UnreadThreadsView
          initialPage={page()}
          initialRooms={[sokosumi, design]}
          currentUserId="user-1"
        />
      );
    }
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: 60_000,
          gcTime: Number.POSITIVE_INFINITY,
        },
        mutations: { gcTime: Number.POSITIVE_INFINITY },
      },
    });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={messages}>
          <Probe live={[sokosumi, design]} />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );

    expect(
      screen.getByRole("link", { name: /added it into linear/ }),
    ).toBeInTheDocument();

    rerender(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={messages}>
          <Probe live={null} />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );

    expect(
      screen.queryByRole("link", { name: /added it into linear/ }),
    ).not.toBeInTheDocument();
    expect(fetchUnreadThreadsMock).not.toHaveBeenCalled();
  });

  it("reads the first page itself when the server's read failed", async () => {
    renderView(null);

    const list = await screen.findByRole("list", { name: "Unread threads" });
    expect(within(list).getAllByRole("link")).toHaveLength(2);
    expect(fetchUnreadThreadsMock).toHaveBeenCalledWith(undefined);
  });
});

// A page whose rows all drop out (their room is gone from the list) says
// nothing about the pages after it (PR #5119 review).
describe("UnreadThreadsView with a filtered page", () => {
  it("keeps paging rather than saying caught up while another page follows", () => {
    renderView({
      threads: [
        {
          roomId: "room-left",
          parentMessageId: "p-left",
          firstUnreadReplyId: "r-left",
          parentContent: "in a room the reader left",
          unreadReplyCount: 1,
          unreadMentionCount: 0,
          lastUnreadAt: new Date("2026-09-23T09:00:00.000Z"),
        },
      ],
      nextCursor: "p-left",
    });

    expect(screen.queryByText("You're all caught up")).toBeNull();
    expect(screen.getByTestId("thread-list-load-more")).toBeInTheDocument();
  });
});

describe("UnreadThreadsView Earlier group", () => {
  it("lists the reader's read Threads under the unread ones, opening at the newest reply", async () => {
    fetchEarlierThreadsMock.mockResolvedValue({
      threads: [
        {
          roomId: "room-design",
          parentMessageId: "p-old",
          parentContent: "we support max 1GB",
          replyCount: 6,
          lastReplyAt: new Date("2026-09-23T09:00:00.000Z"),
          lastReplyId: "r-old",
        },
      ],
      nextCursor: null,
    });
    renderView();

    const list = await screen.findByTestId("earlier-threads-list");
    const row = within(list).getByRole("link");
    expect(row).toHaveAttribute(
      "href",
      "/chat/rooms/room-design?message=r-old",
    );
    expect(row).toHaveTextContent("we support max 1GB");
    expect(row).toHaveTextContent("#design");
    expect(row).toHaveTextContent("6 replies");
    expect(
      screen.getByRole("heading", { name: "Earlier" }),
    ).toBeInTheDocument();
  });

  it("leaves the group out while the reader has no read Thread", async () => {
    renderView();

    await screen.findByRole("list", { name: "Unread threads" });
    await waitFor(() => expect(fetchEarlierThreadsMock).toHaveBeenCalled());
    expect(screen.queryByRole("heading", { name: "Earlier" })).toBeNull();
  });
});
