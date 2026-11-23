import type { ChatRoomMessage, ChatRoomThread } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatQueryKeys } from "@/queries/chat";
import {
  ThreadListPanel,
  type ThreadListPanelLabels,
} from "./thread-list-panel";

const listThreadsActionMock = vi.fn();
const markAllUnreadThreadsReadActionMock = vi.fn();

vi.mock("@/app/chat/actions", () => ({
  listThreadsAction: (...args: unknown[]) => listThreadsActionMock(...args),
  markAllUnreadThreadsReadAction: (...args: unknown[]) =>
    markAllUnreadThreadsReadActionMock(...args),
}));

vi.mock("@/lib/utils/datetime.client", () => ({
  useLocalizedDateTime: () => ({
    formatTimeAgo: () => "1m ago",
  }),
}));

const labels = {
  title: "Threads",
  markAllRead: "Mark all as read",
  empty: "No threads yet",
  emptyHint: "Reply to a message in its thread to start one.",
  loading: "Loading threads…",
  error: "Could not load threads.",
  markAllReadError: "Could not mark unread threads as read.",
  loadOlder: "Load older threads",
  groupUnread: "Unread",
  groupEarlier: "Earlier",
  groupUnreadEmpty: "All caught up",
  startedBy: (name: string) => `Started by ${name}`,
  newReplies: (count: number) => `${count} new`,
  replies: (count: number) => (count === 1 ? "1 reply" : `${count} replies`),
  close: "Close threads",
  muted: "Muted",
};

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";

function parentMessage(
  overrides: Partial<ChatRoomMessage> = {},
): ChatRoomMessage {
  return {
    id: "550e8400-e29b-41d4-a716-446655440001",
    roomId: ROOM_ID,
    parentMessageId: null,
    content: "Budget review parent",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    editedAt: null,
    deletedAt: null,
    metadata: null,
    threadReplyCount: 2,
    threadLastReplyAt: new Date("2026-08-01T01:00:00.000Z"),
    mentions: [],
    quote: null,
    sender: {
      type: "user",
      user: {
        id: "user_1",
        name: "Ada",
        email: "ada@example.com",
        image: null,
        presence: "offline",
      },
    },
    reactions: [],
    ...overrides,
  } as ChatRoomMessage;
}

function threadItem(overrides: Partial<ChatRoomThread> = {}): ChatRoomThread {
  return {
    parentMessage: parentMessage(),
    replyCount: 2,
    lastReplyAt: new Date("2026-08-01T01:00:00.000Z"),
    unreadReplyCount: 2,
    lastUnreadReplyAt: new Date("2026-08-01T01:00:00.000Z"),
    hasLooked: true,
    mutedAt: null,

    ...overrides,
  };
}

const LOOKED_ID = "550e8400-e29b-41d4-a716-446655440099";

/** One unread Thread and one read one, the shape the two groups need. */
function unreadAndReadPair() {
  return {
    ok: true,
    value: {
      threads: [
        threadItem(),
        threadItem({
          parentMessage: parentMessage({
            id: LOOKED_ID,
            content: "Old standup notes",
          }),
          replyCount: 4,
          unreadReplyCount: 0,
          lastUnreadReplyAt: null,
          hasLooked: true,
        }),
      ],
      nextCursor: null,
    },
  };
}

function createQueryClient(staleTime?: number) {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        ...(staleTime !== undefined ? { staleTime } : {}),
      },
    },
  });
}

function renderPanel(
  options: {
    roomId?: string;
    userId?: string | null;
    queryClient?: QueryClient;
    onOpenThread?: (parent: ChatRoomMessage) => boolean | Promise<boolean>;
    onClose?: () => void;
    onAllThreadsLooked?: (stillUnreadParentIds: string[]) => void;
    labels?: ThreadListPanelLabels;
  } = {},
) {
  const queryClient = options.queryClient ?? createQueryClient();
  const roomId = options.roomId ?? ROOM_ID;
  const userId = options.userId ?? "user_1";
  const onOpenThread = options.onOpenThread ?? vi.fn().mockResolvedValue(true);
  const onClose = options.onClose ?? vi.fn();
  const panelLabels = options.labels ?? labels;
  const result = render(
    <QueryClientProvider client={queryClient}>
      <ThreadListPanel
        roomId={roomId}
        userId={userId}
        labels={panelLabels}
        onOpenThread={onOpenThread}
        onClose={onClose}
        onAllThreadsLooked={options.onAllThreadsLooked}
      />
    </QueryClientProvider>,
  );
  return {
    ...result,
    queryClient,
    rerenderPanel(next: { roomId?: string; userId?: string | null } = {}) {
      result.rerender(
        <QueryClientProvider client={queryClient}>
          <ThreadListPanel
            roomId={next.roomId ?? roomId}
            userId={next.userId !== undefined ? next.userId : userId}
            labels={panelLabels}
            onOpenThread={onOpenThread}
            onClose={onClose}
            onAllThreadsLooked={options.onAllThreadsLooked}
          />
        </QueryClientProvider>,
      );
    },
  };
}

describe("ThreadListPanel", () => {
  beforeEach(() => {
    // Reset, not clear: a test that fails early leaves its unused
    // mockReturnValueOnce queued, and clear would hand it to the next test.
    vi.resetAllMocks();
    listThreadsActionMock.mockResolvedValue({
      ok: true,
      value: {
        threads: [threadItem()],
        nextCursor: null,
      },
    });
    markAllUnreadThreadsReadActionMock.mockResolvedValue({
      ok: true,
      value: { markedCount: 1 },
    });
  });

  it("lists unread then looked threads with distinct reply copy", async () => {
    listThreadsActionMock.mockResolvedValue(unreadAndReadPair());

    renderPanel();

    await waitFor(() => {
      expect(listThreadsActionMock).toHaveBeenCalledWith(ROOM_ID);
    });

    const items = await screen.findAllByTestId("thread-list-item");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Budget review parent");
    expect(items[0]).toHaveTextContent("2 new");
    expect(items[0]).toHaveTextContent("Ada");
    expect(items[1]).toHaveTextContent("Old standup notes");
    expect(items[1]).toHaveTextContent("4 replies");
    expect(items[1]).not.toHaveTextContent("unread");
  });

  it("marks only the muted thread with the muted icon", async () => {
    const mutedId = "550e8400-e29b-41d4-a716-446655440098";
    listThreadsActionMock.mockResolvedValue({
      ok: true,
      value: {
        threads: [
          threadItem(),
          threadItem({
            parentMessage: parentMessage({
              id: mutedId,
              content: "Muted parent",
            }),
            mutedAt: new Date("2026-08-01T02:00:00.000Z"),
          }),
        ],
        nextCursor: null,
      },
    });

    renderPanel();

    const items = await screen.findAllByTestId("thread-list-item");
    expect(
      within(items[0]).queryByTestId("thread-list-muted"),
    ).not.toBeInTheDocument();
    expect(within(items[1]).getByTestId("thread-list-muted")).toHaveAttribute(
      "aria-label",
      labels.muted,
    );
  });

  it("shows empty state when the room has no threads", async () => {
    listThreadsActionMock.mockResolvedValue({
      ok: true,
      value: { threads: [], nextCursor: null },
    });

    renderPanel();

    const empty = await screen.findByTestId("thread-list-empty");
    expect(empty).toHaveTextContent(labels.empty);
    expect(empty).toHaveTextContent(labels.emptyHint);
    expect(
      screen.queryByTestId("thread-list-mark-all-read"),
    ).not.toBeInTheDocument();
  });

  it("shows only the empty title when there is no hint to give", async () => {
    listThreadsActionMock.mockResolvedValue({
      ok: true,
      value: { threads: [], nextCursor: null },
    });

    renderPanel({ labels: { ...labels, emptyHint: undefined } });

    const empty = await screen.findByTestId("thread-list-empty");
    expect(empty).toHaveTextContent(labels.empty);
    expect(empty).not.toHaveTextContent(labels.emptyHint);
  });

  it("loads older threads when the recency cursor is present", async () => {
    const olderId = "550e8400-e29b-41d4-a716-446655440098";
    listThreadsActionMock
      .mockResolvedValueOnce({
        ok: true,
        value: {
          threads: [
            threadItem({
              unreadReplyCount: 0,
              lastUnreadReplyAt: null,
              hasLooked: true,
            }),
          ],
          nextCursor: "cursor-1",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          threads: [
            threadItem({
              parentMessage: parentMessage({
                id: olderId,
                content: "Last month",
              }),
              unreadReplyCount: 0,
              lastUnreadReplyAt: null,
              hasLooked: true,
            }),
          ],
          nextCursor: null,
        },
      });

    renderPanel();

    fireEvent.click(
      within(await screen.findByTestId("thread-list-load-more")).getByRole(
        "button",
      ),
    );
    await waitFor(() => {
      expect(listThreadsActionMock).toHaveBeenLastCalledWith(ROOM_ID, {
        cursor: "cursor-1",
      });
    });
    expect(await screen.findByText("Last month")).toBeInTheDocument();
    expect(
      screen.queryByTestId("thread-list-load-more"),
    ).not.toBeInTheDocument();
  });

  it("resumes scroll-loading after a failed older page is retried", async () => {
    const olderId = "550e8400-e29b-41d4-a716-446655440098";
    listThreadsActionMock
      .mockResolvedValueOnce({
        ok: true,
        value: {
          threads: [
            threadItem({
              unreadReplyCount: 0,
              lastUnreadReplyAt: null,
              hasLooked: true,
            }),
          ],
          nextCursor: "cursor-1",
        },
      })
      .mockResolvedValueOnce({
        ok: false,
        error: { message: labels.error },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          threads: [
            threadItem({
              parentMessage: parentMessage({
                id: olderId,
                content: "Last month",
              }),
              unreadReplyCount: 0,
              lastUnreadReplyAt: null,
              hasLooked: true,
            }),
          ],
          nextCursor: "cursor-2",
        },
      });

    renderPanel();

    const loadOlder = async () => {
      const button = within(
        await screen.findByTestId("thread-list-load-more"),
      ).getByRole("button");
      await act(async () => fireEvent.click(button));
    };
    await loadOlder();
    expect(await screen.findByRole("alert")).toHaveTextContent(labels.error);

    await loadOlder();
    expect(await screen.findByText("Last month")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("thread-list-load-more")).toHaveTextContent(
      labels.loadOlder,
    );
  });

  it("does not turn a failed mark-all into a failed older page", async () => {
    listThreadsActionMock.mockResolvedValue({
      ok: true,
      value: {
        threads: [threadItem()],
        nextCursor: "cursor-1",
      },
    });
    markAllUnreadThreadsReadActionMock.mockResolvedValue({
      ok: false,
      error: { message: labels.markAllReadError },
    });

    renderPanel();

    fireEvent.click(await screen.findByTestId("thread-list-mark-all-read"));
    expect(await screen.findByTestId("thread-list-error")).toHaveTextContent(
      labels.markAllReadError,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("thread-list-load-more")).getByRole("button"),
    ).toHaveTextContent(labels.loadOlder);
  });

  it.each([
    [
      "Core refuses",
      (settle: { answer: (v: unknown) => void; reject: (e: Error) => void }) =>
        settle.answer({
          ok: false,
          error: { message: labels.markAllReadError },
        }),
    ],
    [
      "the call fails",
      (settle: { answer: (v: unknown) => void; reject: (e: Error) => void }) =>
        settle.reject(new Error("network down")),
    ],
  ])(
    "shows the threads as read before Core answers, and unread again when %s",
    async (_case, settle) => {
      const mutedId = "550e8400-e29b-41d4-a716-446655440098";
      listThreadsActionMock.mockResolvedValue({
        ok: true,
        value: {
          threads: [
            threadItem(),
            threadItem({
              parentMessage: parentMessage({
                id: mutedId,
                content: "Muted parent",
              }),
              mutedAt: new Date("2026-08-01T02:00:00.000Z"),
            }),
          ],
          nextCursor: null,
        },
      });
      const write = {
        answer: (_value: unknown) => {},
        reject: (_reason: Error) => {},
      };
      markAllUnreadThreadsReadActionMock.mockReturnValueOnce(
        new Promise((resolve, reject) => {
          write.answer = resolve;
          write.reject = reject;
        }),
      );
      renderPanel();
      const unread = () =>
        screen
          .getAllByTestId("thread-list-item")
          .map((row) => row.getAttribute("data-unread"));

      fireEvent.click(await screen.findByTestId("thread-list-mark-all-read"));
      // Core leaves the muted thread unread, so the list does too.
      expect(unread()).toEqual(["true", "false"]);
      expect(screen.getAllByTestId("thread-list-item")[0]).toHaveTextContent(
        "Muted parent",
      );

      await act(async () => settle(write));
      expect(unread()).toEqual(["true", "true"]);
      expect(screen.getByTestId("thread-list-error")).toHaveTextContent(
        labels.markAllReadError,
      );
    },
  );

  it("keeps the threads read and the button in place until the list is read again", async () => {
    let answerMarkAll: (value: unknown) => void = () => {};
    markAllUnreadThreadsReadActionMock.mockReturnValueOnce(
      new Promise((resolve) => {
        answerMarkAll = resolve;
      }),
    );
    let answerReload: (value: unknown) => void = () => {};
    listThreadsActionMock
      .mockResolvedValueOnce({
        ok: true,
        value: { threads: [threadItem()], nextCursor: null },
      })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          answerReload = resolve;
        }),
      );
    renderPanel();
    const row = () => screen.getByTestId("thread-list-item");

    const button = await screen.findByTestId("thread-list-mark-all-read");
    fireEvent.click(button);
    expect(row()).toHaveAttribute("data-unread", "false");
    expect(screen.getByTestId("thread-list-mark-all-read")).toBe(button);

    // Core marked them; the list read that follows is still out.
    await act(async () =>
      answerMarkAll({ ok: true, value: { markedCount: 1 } }),
    );
    expect(row()).toHaveAttribute("data-unread", "false");

    await act(async () =>
      answerReload({
        ok: true,
        value: {
          threads: [threadItem({ unreadReplyCount: 0, hasLooked: true })],
          nextCursor: null,
        },
      }),
    );
    expect(row()).toHaveAttribute("data-unread", "false");
    expect(screen.queryByTestId("thread-list-mark-all-read")).toBeNull();
  });

  it("holds older pages while Mark all runs, so its reload is not discarded", async () => {
    markAllUnreadThreadsReadActionMock.mockResolvedValueOnce({
      ok: true,
      value: { markedCount: 1 },
    });
    let answerReload: (value: unknown) => void = () => {};
    listThreadsActionMock
      .mockResolvedValueOnce({
        ok: true,
        value: { threads: [threadItem()], nextCursor: "cursor-1" },
      })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          answerReload = resolve;
        }),
      );
    renderPanel();
    const row = () => screen.getByTestId("thread-list-item");

    fireEvent.click(await screen.findByTestId("thread-list-mark-all-read"));
    // Core marked them; the reload is out.
    await waitFor(() => expect(listThreadsActionMock).toHaveBeenCalledTimes(2));
    fireEvent.click(
      within(screen.getByTestId("thread-list-load-more")).getByRole("button"),
    );
    expect(listThreadsActionMock).toHaveBeenCalledTimes(2);

    await act(async () =>
      answerReload({
        ok: true,
        value: {
          threads: [threadItem({ unreadReplyCount: 0 })],
          nextCursor: "cursor-1",
        },
      }),
    );
    expect(row()).toHaveAttribute("data-unread", "false");
  });

  it("selects a row and marks all unread", async () => {
    const onOpenThread = vi.fn().mockResolvedValue(true);
    const onAllThreadsLooked = vi.fn();
    renderPanel({ onOpenThread, onAllThreadsLooked });

    fireEvent.click(await screen.findByTestId("thread-list-item"));
    expect(onOpenThread).toHaveBeenCalledWith(
      expect.objectContaining({ id: "550e8400-e29b-41d4-a716-446655440001" }),
    );

    fireEvent.click(await screen.findByTestId("thread-list-mark-all-read"));
    await waitFor(() => {
      expect(markAllUnreadThreadsReadActionMock).toHaveBeenCalledWith(ROOM_ID);
    });
    expect(onAllThreadsLooked).toHaveBeenCalledTimes(1);
    expect(onAllThreadsLooked).toHaveBeenCalledWith([]);
  });

  // Core's Mark all leaves muted threads alone, even with a mention still
  // unread (SOK-1087), so the caller must not treat those as read.
  it("names the muted threads Mark all leaves unread", async () => {
    const mutedId = "550e8400-e29b-41d4-a716-446655440098";
    listThreadsActionMock.mockResolvedValue({
      ok: true,
      value: {
        threads: [
          threadItem(),
          threadItem({
            parentMessage: parentMessage({
              id: mutedId,
              content: "Muted parent",
            }),
            mutedAt: new Date("2026-08-01T02:00:00.000Z"),
          }),
        ],
        nextCursor: null,
      },
    });
    const onAllThreadsLooked = vi.fn();
    renderPanel({ onAllThreadsLooked });

    fireEvent.click(await screen.findByTestId("thread-list-mark-all-read"));

    await waitFor(() => {
      expect(onAllThreadsLooked).toHaveBeenCalledWith([mutedId]);
    });
  });

  it("refetches the first page after mark-all so recency and cursor stay consistent", async () => {
    const olderUnreadId = "550e8400-e29b-41d4-a716-446655440097";
    const recentLookedId = "550e8400-e29b-41d4-a716-446655440096";
    listThreadsActionMock
      .mockResolvedValueOnce({
        ok: true,
        value: {
          threads: [
            threadItem({
              parentMessage: parentMessage({
                id: olderUnreadId,
                content: "Older unread",
              }),
              lastReplyAt: new Date("2026-07-01T00:00:00.000Z"),
              unreadReplyCount: 1,
            }),
            threadItem({
              parentMessage: parentMessage({
                id: recentLookedId,
                content: "Recent looked",
              }),
              lastReplyAt: new Date("2026-08-01T00:00:00.000Z"),
              unreadReplyCount: 0,
              lastUnreadReplyAt: null,
              hasLooked: true,
            }),
          ],
          nextCursor: "cursor-1",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          threads: [
            threadItem({
              parentMessage: parentMessage({
                id: recentLookedId,
                content: "Recent looked",
              }),
              lastReplyAt: new Date("2026-08-01T00:00:00.000Z"),
              unreadReplyCount: 0,
              lastUnreadReplyAt: null,
              hasLooked: true,
            }),
            threadItem({
              parentMessage: parentMessage({
                id: olderUnreadId,
                content: "Older unread",
              }),
              lastReplyAt: new Date("2026-07-01T00:00:00.000Z"),
              unreadReplyCount: 0,
              lastUnreadReplyAt: null,
              hasLooked: true,
            }),
          ],
          nextCursor: "cursor-2",
        },
      });

    renderPanel();

    const before = await screen.findAllByTestId("thread-list-item");
    expect(before[0]).toHaveTextContent("Older unread");
    fireEvent.click(await screen.findByTestId("thread-list-mark-all-read"));
    await waitFor(() => {
      expect(markAllUnreadThreadsReadActionMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(listThreadsActionMock).toHaveBeenCalledTimes(2);
    });
    const after = screen.getAllByTestId("thread-list-item");
    expect(after[0]).toHaveTextContent("Recent looked");
    expect(after[1]).toHaveTextContent("Older unread");
    expect(after[1]).toHaveTextContent("2 replies");
    expect(after[1]).not.toHaveTextContent("unread replies");
    expect(screen.getByTestId("thread-list-load-more")).toBeInTheDocument();
  });

  it("shows unread chrome and Mark all for never-looked Participant threads", async () => {
    listThreadsActionMock.mockResolvedValue({
      ok: true,
      value: {
        threads: [
          threadItem({
            unreadReplyCount: 37,
            hasLooked: false,
            replyCount: 37,
          }),
        ],
        nextCursor: null,
      },
    });

    renderPanel();

    const item = await screen.findByTestId("thread-list-item");
    expect(item).toHaveAttribute("data-unread", "true");
    expect(item).toHaveTextContent("37 new");
    expect(within(item).getByTestId("thread-icon-circle")).toBeInTheDocument();
    expect(
      await screen.findByTestId("thread-list-mark-all-read"),
    ).toBeInTheDocument();
  });

  it("does not treat never-looked with only pre-join or self replies as attention", async () => {
    listThreadsActionMock.mockResolvedValue({
      ok: true,
      value: {
        threads: [
          threadItem({
            unreadReplyCount: 0,
            lastUnreadReplyAt: null,
            hasLooked: false,

            replyCount: 4,
          }),
        ],
        nextCursor: null,
      },
    });

    renderPanel();

    const item = await screen.findByTestId("thread-list-item");
    expect(item).toHaveAttribute("data-unread", "false");
    expect(item).toHaveTextContent("Started by Ada");
    expect(item).toHaveTextContent("4 replies");
    expect(item).not.toHaveTextContent("new");
    expect(within(item).getByTestId("thread-icon-circle")).toHaveAttribute(
      "data-tone",
      "read",
    );
    expect(
      screen.queryByTestId("thread-list-mark-all-read"),
    ).not.toBeInTheDocument();
  });

  it("splits the list into Unread and Earlier headings", async () => {
    listThreadsActionMock.mockResolvedValue(unreadAndReadPair());

    renderPanel();

    const headings = await screen.findAllByTestId("thread-list-group-heading");
    // By accessible name: the Unread heading also draws its count, which is
    // hidden from speech.
    expect(
      screen
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent?.replace(/\d+$/, "")),
    ).toEqual([labels.groupUnread, labels.groupEarlier]);
    expect(
      screen.getByRole("heading", { level: 3, name: labels.groupUnread }),
    ).toBe(headings[0]);
    expect(headings[0].tagName).toBe("H3");

    // The unread row is under Unread, the read one under Earlier: in document
    // order each row follows its own heading and precedes the next.
    const rows = screen.getAllByTestId("thread-list-item");
    const order = Array.from(
      document.querySelectorAll(
        '[data-testid="thread-list-group-heading"],[data-testid="thread-list-item"]',
      ),
    );
    expect(order).toEqual([headings[0], rows[0], headings[1], rows[1]]);
  });

  // An all-read room still gets the Unread heading, so the reader is told they
  // are caught up rather than left to infer it from an undivided list.
  it("keeps the Unread heading on an all-read room and says so", async () => {
    listThreadsActionMock.mockResolvedValue({
      ok: true,
      value: {
        threads: [
          threadItem({
            unreadReplyCount: 0,
            lastUnreadReplyAt: null,
            hasLooked: true,
          }),
        ],
        nextCursor: null,
      },
    });

    renderPanel();

    const headings = await screen.findAllByTestId("thread-list-group-heading");
    expect(headings.map((heading) => heading.textContent)).toEqual([
      labels.groupUnread,
      labels.groupEarlier,
    ]);
    expect(screen.getByTestId("thread-list-unread-empty")).toHaveTextContent(
      labels.groupUnreadEmpty,
    );
    // The caught-up line stands in for rows, it does not join them.
    expect(screen.getAllByTestId("thread-list-item")).toHaveLength(1);
  });

  it("drops the headings entirely when the room has no threads at all", async () => {
    listThreadsActionMock.mockResolvedValue({
      ok: true,
      value: { threads: [], nextCursor: null },
    });

    renderPanel();

    await screen.findByTestId("thread-list-empty");
    expect(
      screen.queryByTestId("thread-list-group-heading"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("thread-list-unread-empty"),
    ).not.toBeInTheDocument();
  });

  // Nothing is read, so there is no Earlier group to head and nothing to
  // confirm under Unread.
  it("heads an all-unread list with Unread alone", async () => {
    renderPanel();

    const headings = await screen.findAllByTestId("thread-list-group-heading");
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(labels.groupUnread);
    expect(
      screen.queryByTestId("thread-list-unread-empty"),
    ).not.toBeInTheDocument();
  });

  it("tints the unread row's mark and leaves the read row's bare", async () => {
    listThreadsActionMock.mockResolvedValue(unreadAndReadPair());

    renderPanel();

    const items = await screen.findAllByTestId("thread-list-item");
    expect(within(items[0]).getByTestId("thread-icon-circle")).toHaveAttribute(
      "data-tone",
      "attention",
    );
    expect(within(items[1]).getByTestId("thread-icon-circle")).toHaveAttribute(
      "data-tone",
      "read",
    );
  });

  it("never shows the previous room's threads when switching rooms while the first page is in flight", async () => {
    const otherRoomId = "550e8400-e29b-41d4-a716-446655440002";
    const roomADeferred = Promise.withResolvers<unknown>();
    listThreadsActionMock.mockImplementation((roomId: string) => {
      if (roomId === ROOM_ID) {
        return roomADeferred.promise;
      }
      return Promise.resolve({
        ok: true,
        value: {
          threads: [
            threadItem({
              parentMessage: parentMessage({
                id: "550e8400-e29b-41d4-a716-446655440022",
                roomId: otherRoomId,
                content: "Room B thread",
              }),
            }),
          ],
          nextCursor: null,
        },
      });
    });

    const { rerenderPanel, queryClient } = renderPanel();
    await waitFor(() => {
      expect(listThreadsActionMock).toHaveBeenCalledWith(ROOM_ID);
    });

    rerenderPanel({ roomId: otherRoomId });
    expect(await screen.findByText("Room B thread")).toBeInTheDocument();

    // Room A's first page finishes late: it must not replace Room B's list.
    await act(async () => {
      roomADeferred.resolve({
        ok: true,
        value: {
          threads: [
            threadItem({
              parentMessage: parentMessage({
                id: "550e8400-e29b-41d4-a716-446655440011",
                roomId: ROOM_ID,
                content: "Room A stale thread",
              }),
            }),
          ],
          nextCursor: null,
        },
      });
    });

    expect(screen.getByText("Room B thread")).toBeInTheDocument();
    expect(screen.queryByText("Room A stale thread")).not.toBeInTheDocument();
    expect(
      queryClient.getQueriesData({
        queryKey: chatQueryKeys.threads({ userId: "user_1" }, otherRoomId),
      }),
    ).toHaveLength(1);
  });

  it("refetches only the first page after mark-all even when older pages were loaded", async () => {
    const olderId = "550e8400-e29b-41d4-a716-446655440098";
    listThreadsActionMock
      .mockResolvedValueOnce({
        ok: true,
        value: {
          threads: [threadItem()],
          nextCursor: "cursor-1",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          threads: [
            threadItem({
              parentMessage: parentMessage({
                id: olderId,
                content: "Older page thread",
              }),
              unreadReplyCount: 0,
              lastUnreadReplyAt: null,
            }),
          ],
          nextCursor: "cursor-2",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          threads: [
            threadItem({
              unreadReplyCount: 0,
              lastUnreadReplyAt: null,
            }),
          ],
          nextCursor: "cursor-fresh",
        },
      });

    renderPanel();

    fireEvent.click(
      within(await screen.findByTestId("thread-list-load-more")).getByRole(
        "button",
      ),
    );
    expect(await screen.findByText("Older page thread")).toBeInTheDocument();
    expect(listThreadsActionMock).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByTestId("thread-list-mark-all-read"));
    await waitFor(() => {
      expect(listThreadsActionMock).toHaveBeenCalledTimes(3);
    });
    expect(listThreadsActionMock).toHaveBeenLastCalledWith(ROOM_ID);
    expect(screen.queryByText("Older page thread")).not.toBeInTheDocument();
    expect(screen.getByTestId("thread-list-item")).toHaveAttribute(
      "data-unread",
      "false",
    );
  });

  it("clears rows and cursor when mark-all succeeds but the page-one reload fails", async () => {
    markAllUnreadThreadsReadActionMock.mockResolvedValueOnce({
      ok: true,
      value: { markedCount: 1 },
    });
    const reloadDeferred = Promise.withResolvers<unknown>();
    listThreadsActionMock
      .mockResolvedValueOnce({
        ok: true,
        value: {
          threads: [threadItem()],
          nextCursor: "cursor-1",
        },
      })
      .mockReturnValueOnce(reloadDeferred.promise);

    renderPanel();

    fireEvent.click(await screen.findByTestId("thread-list-mark-all-read"));
    await waitFor(() => {
      expect(listThreadsActionMock).toHaveBeenCalledTimes(2);
    });
    // While the reload is in flight, the masked row stays visible.
    expect(screen.getByTestId("thread-list-item")).toHaveAttribute(
      "data-unread",
      "false",
    );

    await act(async () => {
      reloadDeferred.resolve({
        ok: false,
        error: { message: labels.error },
      });
    });

    expect(screen.getByTestId("thread-list-error")).toHaveTextContent(
      labels.error,
    );
    expect(screen.queryByTestId("thread-list-item")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("thread-list-load-more"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("thread-list-empty")).not.toBeInTheDocument();
  });

  it("reopening after load-older starts empty and reads page 1 only", async () => {
    const queryClient = createQueryClient(60 * 1000);
    const olderId = "550e8400-e29b-41d4-a716-446655440098";
    const reopenDeferred = Promise.withResolvers<unknown>();
    listThreadsActionMock
      .mockResolvedValueOnce({
        ok: true,
        value: {
          threads: [threadItem()],
          nextCursor: "cursor-1",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          threads: [
            threadItem({
              parentMessage: parentMessage({
                id: olderId,
                content: "Older page thread",
              }),
              unreadReplyCount: 0,
              lastUnreadReplyAt: null,
            }),
          ],
          nextCursor: "cursor-2",
        },
      })
      .mockReturnValueOnce(reopenDeferred.promise);

    const firstMount = renderPanel({ queryClient });
    fireEvent.click(
      within(await screen.findByTestId("thread-list-load-more")).getByRole(
        "button",
      ),
    );
    expect(await screen.findByText("Older page thread")).toBeInTheDocument();
    expect(listThreadsActionMock).toHaveBeenCalledTimes(2);

    firstMount.unmount();

    renderPanel({ queryClient });
    expect(screen.queryByTestId("thread-list-item")).not.toBeInTheDocument();
    expect(screen.queryByText("Older page thread")).not.toBeInTheDocument();
    expect(screen.getByText(labels.loading)).toBeInTheDocument();
    await waitFor(() => {
      expect(listThreadsActionMock).toHaveBeenCalledTimes(3);
    });
    expect(listThreadsActionMock).toHaveBeenLastCalledWith(ROOM_ID);

    await act(async () => {
      reopenDeferred.resolve({
        ok: true,
        value: {
          threads: [
            threadItem({
              parentMessage: parentMessage({
                id: "550e8400-e29b-41d4-a716-446655440055",
                content: "Fresh page 1 thread",
              }),
            }),
          ],
          nextCursor: "cursor-fresh",
        },
      });
    });

    expect(await screen.findByText("Fresh page 1 thread")).toBeInTheDocument();
    expect(screen.queryByText("Older page thread")).not.toBeInTheDocument();
    expect(listThreadsActionMock).toHaveBeenCalledTimes(3);
  });

  it("closing and reopening during the first request issues a new read", async () => {
    const queryClient = createQueryClient(60 * 1000);
    const firstVisitDeferred = Promise.withResolvers<unknown>();
    const secondVisitDeferred = Promise.withResolvers<unknown>();
    listThreadsActionMock
      .mockReturnValueOnce(firstVisitDeferred.promise)
      .mockReturnValueOnce(secondVisitDeferred.promise);

    const firstMount = renderPanel({ queryClient });
    await waitFor(() => {
      expect(listThreadsActionMock).toHaveBeenCalledTimes(1);
    });

    firstMount.unmount();
    renderPanel({ queryClient });

    await waitFor(() => {
      expect(listThreadsActionMock).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      firstVisitDeferred.resolve({
        ok: true,
        value: {
          threads: [
            threadItem({
              parentMessage: parentMessage({
                id: "550e8400-e29b-41d4-a716-446655440066",
                content: "First visit stale thread",
              }),
            }),
          ],
          nextCursor: null,
        },
      });
    });
    expect(
      screen.queryByText("First visit stale thread"),
    ).not.toBeInTheDocument();

    await act(async () => {
      secondVisitDeferred.resolve({
        ok: true,
        value: {
          threads: [
            threadItem({
              parentMessage: parentMessage({
                id: "550e8400-e29b-41d4-a716-446655440077",
                content: "Second visit fresh thread",
              }),
            }),
          ],
          nextCursor: null,
        },
      });
    });
    expect(
      await screen.findByText("Second visit fresh thread"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("First visit stale thread"),
    ).not.toBeInTheDocument();
  });

  it("never shows another viewer's rows when sharing one QueryClient", async () => {
    const queryClient = createQueryClient(60 * 1000);
    const viewerBDeferred = Promise.withResolvers<unknown>();
    listThreadsActionMock
      .mockResolvedValueOnce({
        ok: true,
        value: {
          threads: [
            threadItem({
              parentMessage: parentMessage({
                id: "550e8400-e29b-41d4-a716-446655440088",
                content: "Viewer A thread",
              }),
            }),
          ],
          nextCursor: null,
        },
      })
      .mockReturnValueOnce(viewerBDeferred.promise);

    const { rerenderPanel } = renderPanel({
      queryClient,
      userId: "user_a",
    });
    expect(await screen.findByText("Viewer A thread")).toBeInTheDocument();

    rerenderPanel({ userId: "user_b" });
    expect(screen.queryByText("Viewer A thread")).not.toBeInTheDocument();
    expect(screen.getByText(labels.loading)).toBeInTheDocument();

    await act(async () => {
      viewerBDeferred.resolve({
        ok: true,
        value: {
          threads: [
            threadItem({
              parentMessage: parentMessage({
                id: "550e8400-e29b-41d4-a716-446655440089",
                content: "Viewer B thread",
              }),
            }),
          ],
          nextCursor: null,
        },
      });
    });

    expect(await screen.findByText("Viewer B thread")).toBeInTheDocument();
    expect(screen.queryByText("Viewer A thread")).not.toBeInTheDocument();
  });

  it("keeps loaded rows and cursor with no new read when the parent re-renders on a workspace switch", async () => {
    const queryClient = createQueryClient(60 * 1000);
    const olderId = "550e8400-e29b-41d4-a716-446655440098";
    listThreadsActionMock
      .mockResolvedValueOnce({
        ok: true,
        value: {
          threads: [threadItem()],
          nextCursor: "cursor-1",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          threads: [
            threadItem({
              parentMessage: parentMessage({
                id: olderId,
                content: "Older page thread",
              }),
              unreadReplyCount: 0,
              lastUnreadReplyAt: null,
            }),
          ],
          nextCursor: "cursor-2",
        },
      });

    const { rerenderPanel } = renderPanel({ queryClient });
    fireEvent.click(
      within(await screen.findByTestId("thread-list-load-more")).getByRole(
        "button",
      ),
    );
    expect(await screen.findByText("Older page thread")).toBeInTheDocument();
    expect(listThreadsActionMock).toHaveBeenCalledTimes(2);

    // Simulates a workspace switch keeping the room and panel mounted.
    rerenderPanel();

    expect(screen.getByText("Budget review parent")).toBeInTheDocument();
    expect(screen.getByText("Older page thread")).toBeInTheDocument();
    expect(screen.getByTestId("thread-list-load-more")).toBeInTheDocument();
    expect(listThreadsActionMock).toHaveBeenCalledTimes(2);
    expect(
      queryClient.getQueriesData({
        queryKey: chatQueryKeys.threads({ userId: "user_1" }, ROOM_ID),
      }),
    ).toHaveLength(1);
  });

  it("drops a late mark-all reload instead of recreating an abandoned cache entry", async () => {
    const queryClient = createQueryClient(60 * 1000);
    markAllUnreadThreadsReadActionMock.mockResolvedValueOnce({
      ok: true,
      value: { markedCount: 1 },
    });
    const reloadDeferred = Promise.withResolvers<unknown>();
    listThreadsActionMock
      .mockResolvedValueOnce({
        ok: true,
        value: {
          threads: [threadItem()],
          nextCursor: "cursor-1",
        },
      })
      .mockReturnValueOnce(reloadDeferred.promise);

    const { unmount } = renderPanel({ queryClient });
    fireEvent.click(await screen.findByTestId("thread-list-mark-all-read"));
    await waitFor(() => {
      expect(listThreadsActionMock).toHaveBeenCalledTimes(2);
    });

    // Closing the panel abandons the visit key (gcTime: 0 removes it).
    unmount();
    await waitFor(() => {
      expect(
        queryClient.getQueryCache().findAll({
          queryKey: chatQueryKeys.threads({ userId: "user_1" }, ROOM_ID),
        }),
      ).toHaveLength(0);
    });

    await act(async () => {
      reloadDeferred.resolve({
        ok: true,
        value: {
          threads: [threadItem({ unreadReplyCount: 0 })],
          nextCursor: null,
        },
      });
    });

    expect(
      queryClient.getQueryCache().findAll({
        queryKey: chatQueryKeys.threads({ userId: "user_1" }, ROOM_ID),
      }),
    ).toHaveLength(0);
  });
});
