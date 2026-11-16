import type {
  ChatCatchUpItem,
  ChatCatchUpSummary,
  ChatCatchUpTopic,
  ChatRoom,
} from "@sokosumi/core-client";
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT } from "@/components/chat/organization-chat-events";
import { clearRoomReadOverlays } from "@/components/chat/room-read-overlay";

import { CatchUpView } from "./catch-up-view";

const {
  listElsewhereMock,
  markAllReadMock,
  sendMock,
  setLoopMock,
  showRoomUnreadCountMock,
  summaryActionMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
  listElsewhereMock: vi.fn(),
  markAllReadMock: vi.fn(),
  sendMock: vi.fn(),
  setLoopMock: vi.fn(),
  showRoomUnreadCountMock: vi.fn(),
  summaryActionMock: vi.fn(),
}));

const NOW = new Date("2026-10-31T12:00:00.000Z");

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: toastErrorMock },
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
  useFormatter: () => ({
    relativeTime: () => "just now",
    dateTime: () => "Fri, Oct 30",
  }),
  useNow: () => NOW,
}));

vi.mock("@/app/chat/signal-actions", () => ({
  setChatSignalLoopAction: (...args: unknown[]) => setLoopMock(...args),
}));

vi.mock("@/components/chat/signals/fetch-catch-up-summary", () => ({
  fetchCatchUpSummary: async () => {
    const result = await summaryActionMock();
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  },
}));

vi.mock("@/app/chat/actions", () => ({
  markAllChatUnreadReadAction: (...args: unknown[]) => markAllReadMock(...args),
  sendRoomMessageAction: (...args: unknown[]) => sendMock(...args),
}));

vi.mock("@/components/chat/fetch-sidebar-room-collection", () => ({
  fetchSidebarRoomCollection: () => listElsewhereMock(),
}));

vi.mock("@/components/chat/use-show-room-unread-count", () => ({
  useShowRoomUnreadCount: () => showRoomUnreadCountMock(),
}));

const LIST_LABEL = "App.Channels.UnreadNav.elsewhereLabel";
const PERSONAL_LABEL = "App.Tasks.Detail.personalWorkspace";

function elsewhereRoom(
  id: string,
  overrides: Partial<ChatRoom> = {},
): ChatRoom {
  return {
    id,
    kind: "channel",
    myAccess: "member",
    organizationId: "org-2",
    organizationName: "Other Org",
    name: id,
    userMembers: [],
    coworkerMembers: [],
    sokoBotMembers: [],
    formerUserMembers: [],
    isSelfDirect: false,
    isGroupDirect: false,
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    unreadCount: 1,
    channelUnreadCount: 1,
    unreadMentionCount: 0,
    mutedAt: null,
    markedUnread: false,
    ...overrides,
  } as ChatRoom;
}

const EMPTY_SUMMARY: ChatCatchUpSummary = {
  scope: "all",
  unreadTaggedCount: 0,
  unreadMessageCount: 0,
  unreadRoomCount: 0,
  awaySince: null,
  headline: null,
  generatedAt: null,
  counts: [],
  needsYou: [],
  blockers: [],
  decisions: [],
  announcements: [],
  openLoops: [],
  highlights: [],
  topics: [],
  quietRooms: [],
};

function item(
  messageId: string,
  overrides: Partial<ChatCatchUpItem> = {},
): ChatCatchUpItem {
  return {
    messageId,
    roomId: "room-a",
    roomName: "Sokosumi",
    roomKind: "channel",
    parentMessageId: null,
    senderName: "Francis",
    senderImageUrl: null,
    excerpt: `text of ${messageId}`,
    bucket: "needsYou",
    createdAt: new Date("2026-10-29T12:00:00.000Z"),
    dueAt: null,
    inReplyTo: null,
    ...overrides,
  };
}

function topic(
  id: string,
  overrides: Partial<ChatCatchUpTopic> = {},
): ChatCatchUpTopic {
  return {
    id,
    title: `title of ${id}`,
    summary: `summary of ${id}`,
    status: "fyi",
    roomId: "room-a",
    roomName: "Sokosumi",
    roomKind: "channel",
    people: [{ name: "Francis", imageUrl: null }],
    latestAt: new Date("2026-10-29T12:00:00.000Z"),
    messages: [item(`${id}-m`, { bucket: "fyi" })],
    ...overrides,
  };
}

function summaryAnswers(summary: Partial<ChatCatchUpSummary> = {}) {
  summaryActionMock.mockResolvedValue({
    ok: true,
    value: { ...EMPTY_SUMMARY, ...summary },
  });
}

function renderCatchUp() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <CatchUpView currentUserId="user-1" organizationId="org-1" />
    </QueryClientProvider>,
  );
}

function elsewhereList() {
  return screen.queryByRole("region", { name: LIST_LABEL });
}

async function findElsewhereList() {
  return screen.findByRole("region", { name: LIST_LABEL });
}

function workspaceRooms(list: HTMLElement, workspace: string) {
  return within(within(list).getByRole("list", { name: workspace }))
    .getAllByRole("link")
    .map((link) => link.getAttribute("href"));
}

beforeEach(() => {
  clearRoomReadOverlays();
  listElsewhereMock.mockReset();
  summaryActionMock.mockReset();
  showRoomUnreadCountMock.mockReturnValue(true);
  listElsewhereMock.mockResolvedValue([]);
  summaryAnswers();
});

describe("CatchUpView's unread rooms elsewhere", () => {
  it("lists each room under its workspace, in Core's order", async () => {
    listElsewhereMock.mockResolvedValue([
      elsewhereRoom("launch"),
      elsewhereRoom("assistant", {
        organizationId: null,
        organizationName: null,
      }),
      elsewhereRoom("design"),
    ]);

    renderCatchUp();
    const list = await findElsewhereList();

    expect(workspaceRooms(list, "Other Org")).toEqual([
      "/chat/rooms/launch",
      "/chat/rooms/design",
    ]);
    expect(workspaceRooms(list, PERSONAL_LABEL)).toEqual([
      "/chat/rooms/assistant",
    ]);
  });

  it.each([
    [
      "the @ pill where the reader was named",
      { unreadMentionCount: 2 },
      '[data-slot="mention-pill"]',
      "App.Channels.RoomMentions.mentions 2",
    ],
    [
      "the needs-you pill over the @ pill",
      { unreadMentionCount: 2, unreadNeedsYouCount: 3 },
      '[data-slot="needs-you-pill"]',
      "App.Channels.Signals.needsYouCount 3",
    ],
    [
      "the muted count in a Direct of two",
      {
        kind: "direct",
        channelUnreadCount: 4,
        unreadCount: 4,
        unreadMentionCount: 4,
      },
      null,
      "App.Channels.RoomUnread.unreadMessages 4",
    ],
  ] as const)(
    "draws %s, and says it in words",
    async (_name, room, slot, words) => {
      listElsewhereMock.mockResolvedValue([elsewhereRoom("launch", room)]);

      renderCatchUp();
      const list = await findElsewhereList();
      const link = within(list).getByRole("link");

      expect(link.querySelector('[data-slot="mention-pill"]') != null).toBe(
        slot === '[data-slot="mention-pill"]',
      );
      expect(link.querySelector('[data-slot="needs-you-pill"]') != null).toBe(
        slot === '[data-slot="needs-you-pill"]',
      );
      expect(link.textContent).toContain(words);
    },
  );

  it("bolds a room as its row would, and gives a Thread-only room its plain number", async () => {
    showRoomUnreadCountMock.mockReturnValue(false);
    listElsewhereMock.mockResolvedValue([
      elsewhereRoom("launch"),
      elsewhereRoom("threads", {
        unreadCount: 2,
        channelUnreadCount: 0,
        threadUnreadCount: 2,
        unreadThreadCount: 1,
      }),
    ]);

    renderCatchUp();
    const list = await findElsewhereList();

    expect(screen.getByText("launch").className).toContain("font-semibold");
    expect(screen.getByText("threads").className).not.toContain(
      "font-semibold",
    );
    const [launch, threads] = within(list).getAllByRole("link");
    expect(launch.textContent).toBe("launch");
    expect(threads.textContent).toContain(
      "App.Channels.RoomUnread.unreadMessages 2",
    );
    expect(threads.querySelector("[aria-hidden]")?.textContent).toBe("2");
  });

  it("is absent while nothing is unread elsewhere", async () => {
    renderCatchUp();

    await waitFor(() => expect(listElsewhereMock).toHaveBeenCalled());
    await screen.findByTestId("chat-caught-up");
    expect(elsewhereList()).toBeNull();
  });

  it("stands below the written summary, which keeps its content", async () => {
    listElsewhereMock.mockResolvedValue([elsewhereRoom("launch")]);
    summaryAnswers({ headline: "A quiet morning", topics: [topic("t1")] });

    renderCatchUp();
    const list = await findElsewhereList();
    const summary = await screen.findByTestId("catch-up-summary");

    expect(summary.compareDocumentPosition(list)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(within(summary).getByText("A quiet morning")).toBeTruthy();
    expect(within(summary).queryByText("launch")).toBeNull();
  });

  it("paints while the summary is still being written", async () => {
    listElsewhereMock.mockResolvedValue([elsewhereRoom("launch")]);
    summaryActionMock.mockReturnValue(new Promise(() => {}));

    renderCatchUp();

    expect(await findElsewhereList()).toBeTruthy();
    expect(screen.getByText("App.Channels.Signals.summarizing")).toBeTruthy();
  });

  it("paints when the summary fails", async () => {
    listElsewhereMock.mockResolvedValue([elsewhereRoom("launch")]);
    summaryActionMock.mockResolvedValue({
      ok: false,
      error: { message: "no model" },
    });

    renderCatchUp();

    expect(await findElsewhereList()).toBeTruthy();
    expect(await screen.findByText("App.Channels.Signals.error")).toBeTruthy();
  });

  describe("the caught-up message", () => {
    it("shows with nothing written and nothing unread elsewhere", async () => {
      renderCatchUp();

      expect(await screen.findByTestId("chat-caught-up")).toBeTruthy();
    });

    it("gives way to the list when rooms wait elsewhere", async () => {
      listElsewhereMock.mockResolvedValue([elsewhereRoom("launch")]);

      renderCatchUp();
      await findElsewhereList();
      await waitFor(() => expect(summaryActionMock).toHaveBeenCalled());
      await act(async () => {});

      expect(screen.queryByTestId("chat-caught-up")).toBeNull();
      // Nothing written, so no note about how it was written either.
      expect(screen.queryByText("App.Channels.Signals.aiNote")).toBeNull();
    });

    it("waits for the list's first answer", async () => {
      let answer: (rooms: ChatRoom[] | null) => void = () => {};
      listElsewhereMock.mockReturnValue(
        new Promise((resolve) => {
          answer = resolve;
        }),
      );

      renderCatchUp();
      await waitFor(() => expect(summaryActionMock).toHaveBeenCalled());
      await act(async () => {});
      expect(screen.queryByTestId("chat-caught-up")).toBeNull();

      await act(async () => answer([]));
      expect(await screen.findByTestId("chat-caught-up")).toBeTruthy();
    });

    it("still shows when the list could not be read", async () => {
      listElsewhereMock.mockResolvedValue(null);

      renderCatchUp();

      expect(await screen.findByTestId("chat-caught-up")).toBeTruthy();
    });
  });

  describe("the briefing", () => {
    it("says how much came in since when, then what waits on you first", async () => {
      summaryAnswers({
        headline: "Francis needs your green light.",
        unreadMessageCount: 152,
        unreadRoomCount: 8,
        awaySince: new Date("2026-10-27T18:00:00.000Z"),
        topics: [
          topic("news", { status: "decided" }),
          topic("ask", {
            status: "waitingOnYou",
            messages: [item("q1"), item("q2", { bucket: "fyi" })],
          }),
        ],
      });

      renderCatchUp();
      expect(
        await screen.findByText(
          "App.Channels.Signals.Briefing.unreadSince App.Channels.Signals.Briefing.unread 152 8 Fri, Oct 30",
        ),
      ).toBeTruthy();
      const waiting = screen.getByRole("region", {
        name: "App.Channels.Signals.Briefing.waitingOnYou 1",
      });
      expect(within(waiting).getByText("title of ask")).toBeTruthy();
      expect(within(waiting).getByText("summary of ask")).toBeTruthy();
      const away = screen.getByRole("region", {
        name: "App.Channels.Signals.Briefing.whileAway 1",
      });
      expect(within(away).getByText("title of news")).toBeTruthy();
      expect(
        within(away).getByText("App.Channels.Signals.Briefing.Status.decided"),
      ).toBeTruthy();
      // Only a topic waiting on you can be marked done.
      expect(
        within(away).queryByRole("button", {
          name: "App.Channels.Signals.done",
        }),
      ).toBeNull();
    });

    it("folds out the messages behind a topic", async () => {
      summaryAnswers({ topics: [topic("t1")] });

      renderCatchUp();
      const toggle = await screen.findByRole("button", {
        name: /Briefing\.messages 1/,
      });
      expect(screen.queryByText("text of t1-m")).toBeNull();
      await act(async () => toggle.click());
      expect(screen.getByText("text of t1-m")).toBeTruthy();
    });

    it("takes a topic off at once, closes its messages, and reloads", async () => {
      summaryAnswers({
        topics: [
          topic("ask", {
            status: "waitingOnYou",
            messages: [item("q1"), item("f1", { bucket: "fyi" })],
          }),
        ],
      });
      setLoopMock.mockResolvedValue({ ok: true, value: {} });

      renderCatchUp();
      const done = await screen.findByRole("button", {
        name: "App.Channels.Signals.done",
      });
      summaryAnswers();
      await act(async () => done.click());

      expect(setLoopMock).toHaveBeenCalledWith("q1", { closed: true });
      expect(setLoopMock).toHaveBeenCalledWith("f1", { closed: true });
      expect(await screen.findByTestId("chat-caught-up")).toBeTruthy();
    });

    it("hides a topic before the save answers, and puts it back if it fails", async () => {
      summaryAnswers({ topics: [topic("ask", { status: "waitingOnYou" })] });
      let answer: (value: unknown) => void = () => {};
      setLoopMock.mockReturnValue(
        new Promise((resolve) => {
          answer = resolve;
        }),
      );

      renderCatchUp();
      const done = await screen.findByRole("button", {
        name: "App.Channels.Signals.done",
      });
      await act(async () => done.click());
      expect(screen.queryByText("title of ask")).toBeNull();

      await act(async () => answer({ ok: false, error: { message: "x" } }));
      expect(await screen.findByText("title of ask")).toBeTruthy();
    });

    it("answers in the Thread the question came from", async () => {
      summaryAnswers({
        topics: [
          topic("ask", {
            status: "waitingOnYou",
            messages: [item("q1", { parentMessageId: "parent" })],
          }),
        ],
      });
      sendMock.mockResolvedValue({ ok: true, value: {} });
      setLoopMock.mockResolvedValue({ ok: true, value: {} });

      renderCatchUp();
      await act(async () =>
        (
          await screen.findByRole("button", {
            name: "App.Channels.Signals.Briefing.reply",
          })
        ).click(),
      );
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "Yes, go ahead" },
      });
      await act(async () =>
        screen
          .getByRole("button", { name: "App.Channels.Signals.Briefing.send" })
          .click(),
      );

      expect(sendMock).toHaveBeenCalledWith("room-a", "Yes, go ahead", [], {
        parentMessageId: "parent",
      });
      expect(setLoopMock).toHaveBeenCalledWith("q1", { closed: true });
    });

    it("says how overdue a promise is", async () => {
      summaryAnswers({
        openLoops: [
          item("loop", {
            bucket: "commitment",
            dueAt: new Date("2026-10-28T09:00:00.000Z"),
          }),
        ],
      });

      renderCatchUp();

      expect(
        await screen.findByText("App.Channels.Signals.overdue 3"),
      ).toBeTruthy();
    });

    it("marks the rooms with nothing for you read", async () => {
      summaryAnswers({
        quietRooms: [
          {
            roomId: "room-q",
            roomName: "Andreas",
            roomKind: "direct",
            unreadCount: 12,
            latest: item("dm", {
              roomId: "room-q",
              senderName: "Andreas",
              excerpt: "See you tomorrow",
            }),
            mentionsYou: false,
          },
        ],
      });
      markAllReadMock.mockResolvedValue({ ok: true, value: null });

      renderCatchUp();
      const quiet = await screen.findByRole("region", {
        name: "App.Channels.Signals.Briefing.otherMessages 1",
      });
      // Who wrote last and what, without opening it.
      expect(within(quiet).getByText("See you tomorrow")).toBeTruthy();
      await act(async () =>
        within(quiet)
          .getByRole("button", { name: "App.Channels.Signals.markRead" })
          .click(),
      );

      expect(markAllReadMock).toHaveBeenCalledWith([
        { roomId: "room-q", readRoom: true, lookThreads: true },
      ]);
    });

    it("says who mentioned you, Thread replies too", async () => {
      summaryAnswers({
        quietRooms: [
          {
            roomId: "room-q",
            roomName: "Sokosumi",
            roomKind: "channel",
            unreadCount: 8,
            latest: item("reply", {
              roomId: "room-q",
              parentMessageId: "parent",
              senderName: "Phil",
              excerpt: "Patrick would love this",
            }),
            mentionsYou: true,
          },
        ],
      });

      renderCatchUp();
      const quiet = await screen.findByRole("region", {
        name: "App.Channels.Signals.Briefing.otherMessages 1",
      });
      expect(
        within(quiet).getByText(
          "App.Channels.Signals.Briefing.mentionedYou Phil",
        ),
      ).toBeTruthy();
      expect(within(quiet).queryByText(/^Phil: /)).toBeNull();
    });

    it.each([
      ["a lone group spans the full width", false],
      ["a group beside topics takes the side column", true],
    ] as const)("%s", async (_name, twoColumns) => {
      summaryAnswers({
        topics: twoColumns ? [topic("t1")] : [],
        quietRooms: [
          {
            roomId: "room-q",
            roomName: "random",
            roomKind: "channel",
            unreadCount: 2,
            latest: null,
            mentionsYou: false,
          },
        ],
      });

      renderCatchUp();
      await screen.findByRole("region", {
        name: "App.Channels.Signals.Briefing.otherMessages 1",
      });

      expect(
        screen
          .getByTestId("catch-up-groups")
          .className.includes("lg:grid-cols-"),
      ).toBe(twoColumns);
    });

    /** One summary, then a read that never lands: only the page's own state shows. */
    function summaryAnswersOnce(summary: Partial<ChatCatchUpSummary>) {
      summaryActionMock.mockReset();
      summaryActionMock
        .mockResolvedValueOnce({
          ok: true,
          value: { ...EMPTY_SUMMARY, ...summary },
        })
        .mockReturnValue(new Promise(() => {}));
    }

    /** A Mark read that stays open until the test answers or rejects it. */
    function holdMarkRead() {
      let answer: (value: unknown) => void = () => {};
      let reject: (reason: Error) => void = () => {};
      markAllReadMock.mockReturnValueOnce(
        new Promise((resolve, fail) => {
          answer = resolve;
          reject = fail;
        }),
      );
      return {
        answer: (value: unknown) => act(async () => answer(value)),
        reject: () => act(async () => reject(new Error("network down"))),
      };
    }

    const QUIET_ROOM = {
      roomId: "room-q",
      roomName: "random",
      roomKind: "channel" as const,
      unreadCount: 2,
      latest: null,
      mentionsYou: false,
    };
    const QUIET_REGION = "App.Channels.Signals.Briefing.otherMessages 1";

    it.each([
      [
        "Core refuses",
        (write: ReturnType<typeof holdMarkRead>) =>
          write.answer({ ok: false, error: { message: "x" } }),
      ],
      [
        "the call fails",
        (write: ReturnType<typeof holdMarkRead>) => write.reject(),
      ],
    ])(
      "takes the quiet rooms off before Core answers, and puts them back when %s",
      async (_case, settle) => {
        toastErrorMock.mockClear();
        summaryAnswersOnce({
          unreadMessageCount: 5,
          unreadRoomCount: 2,
          topics: [topic("t1")],
          quietRooms: [QUIET_ROOM],
        });
        const write = holdMarkRead();
        renderCatchUp();
        const quiet = await screen.findByRole("region", { name: QUIET_REGION });
        const unread = (messages: number, rooms: number) =>
          screen.queryByText(
            `App.Channels.Signals.Briefing.unread ${messages} ${rooms}`,
          );

        await act(async () =>
          within(quiet)
            .getByRole("button", { name: "App.Channels.Signals.markRead" })
            .click(),
        );
        // The query cache tells its readers on a timer, so wait for the paint.
        await waitFor(() =>
          expect(
            screen.queryByRole("region", { name: QUIET_REGION }),
          ).toBeNull(),
        );
        // A topic in another room is not part of this write.
        expect(screen.getByText("title of t1")).toBeTruthy();
        // The header counts what is left: the quiet room held 2 of the 5.
        expect(unread(3, 1)).toBeTruthy();

        await settle(write);
        expect(
          await screen.findByRole("region", { name: QUIET_REGION }),
        ).toBeTruthy();
        expect(unread(5, 2)).toBeTruthy();
        // The room that was never part of the write is still there.
        expect(screen.getByText("title of t1")).toBeTruthy();
        expect(toastErrorMock).toHaveBeenCalledWith(
          "App.Channels.Signals.markAllReadError",
        );
      },
    );

    it("keeps the rooms off when a summary read from before the click lands", async () => {
      const full = {
        ...EMPTY_SUMMARY,
        topics: [topic("t1", { status: "waitingOnYou" })],
        quietRooms: [QUIET_ROOM],
      };
      let landLate: (value: unknown) => void = () => {};
      summaryActionMock.mockReset();
      summaryActionMock
        .mockResolvedValueOnce({ ok: true, value: full })
        .mockReturnValueOnce(
          new Promise((resolve) => {
            landLate = resolve;
          }),
        )
        .mockReturnValue(new Promise(() => {}));
      setLoopMock.mockResolvedValue({ ok: true, value: {} });
      markAllReadMock.mockClear();
      const write = holdMarkRead();
      renderCatchUp();
      await screen.findByRole("region", { name: QUIET_REGION });
      // Done re-reads the summary; that read is still out at the click.
      await act(async () =>
        screen
          .getByRole("button", { name: "App.Channels.Signals.done" })
          .click(),
      );
      await waitFor(() => expect(summaryActionMock).toHaveBeenCalledTimes(2));

      await act(async () =>
        within(screen.getByRole("region", { name: QUIET_REGION }))
          .getByRole("button", { name: "App.Channels.Signals.markRead" })
          .click(),
      );
      expect(markAllReadMock).toHaveBeenCalledTimes(1);
      await act(async () => landLate({ ok: true, value: full }));
      await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));

      expect(screen.queryByRole("region", { name: QUIET_REGION })).toBeNull();
      await write.answer({ ok: true, value: null });
    });

    it("clears every unread room before Core answers and keeps the button until then", async () => {
      toastErrorMock.mockClear();
      // An open loop is already read, so it keeps the page, and the button.
      summaryAnswersOnce({
        headline: "A busy morning.",
        openLoops: [item("loop")],
        unreadMessageCount: 5,
        unreadRoomCount: 2,
        topics: [topic("t1")],
        quietRooms: [QUIET_ROOM],
      });
      const write = holdMarkRead();
      renderCatchUp();
      const markAll = () =>
        screen.queryByRole("button", {
          name: "App.Channels.Signals.markAllRead",
        });
      const button = await screen.findByRole("button", {
        name: "App.Channels.Signals.markAllRead",
      });

      await act(async () => button.click());
      await waitFor(() => expect(screen.queryByText("title of t1")).toBeNull());
      expect(screen.queryByRole("region", { name: QUIET_REGION })).toBeNull();
      expect(
        screen.queryByText(/App\.Channels\.Signals\.Briefing\.unread/),
      ).toBeNull();
      // The headline was written about the rooms that just left.
      expect(screen.queryByText("A busy morning.")).toBeNull();
      expect(markAll()).toBe(button);

      const roomsChanged = vi.fn();
      window.addEventListener(
        ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
        roomsChanged,
      );
      const summaryReads = summaryActionMock.mock.calls.length;
      await write.answer({ ok: true, value: null });
      window.removeEventListener(
        ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
        roomsChanged,
      );
      // The sidebar hears of the read, and the summary is written again.
      expect(roomsChanged).toHaveBeenCalledTimes(1);
      expect(summaryActionMock).toHaveBeenCalledTimes(summaryReads + 1);
      await waitFor(() => expect(markAll()).toBeNull());
      expect(screen.queryByText("title of t1")).toBeNull();
      expect(toastErrorMock).not.toHaveBeenCalled();
    });

    it("says caught up before Core answers, and brings the page back when the write fails", async () => {
      toastErrorMock.mockClear();
      // What Core writes for one busy room: a headline, a topic, a section.
      summaryAnswersOnce({
        headline: "A busy morning.",
        unreadMessageCount: 1,
        unreadRoomCount: 1,
        topics: [topic("t1")],
        needsYou: [item("ask")],
      });
      const write = holdMarkRead();
      renderCatchUp();
      const button = await screen.findByRole("button", {
        name: "App.Channels.Signals.markAllRead",
      });

      await act(async () => button.click());
      expect(
        await screen.findByText("App.Channels.Signals.caughtUpTitle"),
      ).toBeTruthy();

      // The header that began the write has left the page by now.
      await write.reject();
      expect(await screen.findByText("title of t1")).toBeTruthy();
      expect(screen.getByText("A busy morning.")).toBeTruthy();
      expect(toastErrorMock).toHaveBeenCalledTimes(1);
    });

    it("fails at once offline, rather than holding the rooms off until the network returns", async () => {
      toastErrorMock.mockClear();
      summaryAnswersOnce({ topics: [topic("t1")], quietRooms: [QUIET_ROOM] });
      markAllReadMock.mockRejectedValueOnce(new Error("network down"));
      renderCatchUp();
      const quiet = await screen.findByRole("region", { name: QUIET_REGION });
      onlineManager.setOnline(false);
      try {
        await act(async () =>
          within(quiet)
            .getByRole("button", { name: "App.Channels.Signals.markRead" })
            .click(),
        );
        await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));
        expect(
          await screen.findByRole("region", { name: QUIET_REGION }),
        ).toBeTruthy();
      } finally {
        onlineManager.setOnline(true);
      }
    });

    it("sends one write for two clicks in the same moment", async () => {
      summaryAnswersOnce({
        openLoops: [item("loop")],
        topics: [topic("t1")],
        quietRooms: [QUIET_ROOM],
      });
      markAllReadMock.mockClear();
      const write = holdMarkRead();
      renderCatchUp();
      const quiet = await screen.findByRole("region", { name: QUIET_REGION });
      const markAll = screen.getByRole("button", {
        name: "App.Channels.Signals.markAllRead",
      });

      await act(async () => {
        within(quiet)
          .getByRole("button", { name: "App.Channels.Signals.markRead" })
          .click();
        markAll.click();
      });
      expect(markAllReadMock).toHaveBeenCalledTimes(1);

      await write.answer({ ok: true, value: null });
    });

    it("holds the other Mark read while one write is open", async () => {
      summaryAnswersOnce({
        openLoops: [item("loop")],
        topics: [topic("t1")],
        quietRooms: [QUIET_ROOM],
      });
      markAllReadMock.mockClear();
      const write = holdMarkRead();
      renderCatchUp();
      const quiet = await screen.findByRole("region", { name: QUIET_REGION });
      const markAll = screen.getByRole("button", {
        name: "App.Channels.Signals.markAllRead",
      });

      await act(async () =>
        within(quiet)
          .getByRole("button", { name: "App.Channels.Signals.markRead" })
          .click(),
      );
      await waitFor(() =>
        expect(markAll.getAttribute("aria-busy")).toBe("true"),
      );
      await act(async () => markAll.click());
      expect(markAllReadMock).toHaveBeenCalledTimes(1);

      await write.answer({ ok: true, value: null });
    });

    it("marks every unread room read at once", async () => {
      summaryAnswers({
        topics: [topic("t1"), topic("t2", { roomId: "room-b" })],
        quietRooms: [
          {
            roomId: "room-q",
            roomName: "random",
            roomKind: "channel",
            unreadCount: 2,
            latest: null,
            mentionsYou: false,
          },
        ],
      });
      markAllReadMock.mockResolvedValue({ ok: true, value: null });

      renderCatchUp();
      const button = await screen.findByRole("button", {
        name: "App.Channels.Signals.markAllRead",
      });
      await act(async () => button.click());

      expect(markAllReadMock).toHaveBeenCalledWith([
        { roomId: "room-a", readRoom: true, lookThreads: true },
        { roomId: "room-b", readRoom: true, lookThreads: true },
        { roomId: "room-q", readRoom: true, lookThreads: true },
      ]);
    });
  });
});
