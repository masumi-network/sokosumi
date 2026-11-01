import type {
  ChatCatchUpItem,
  ChatCatchUpSummary,
  ChatRoom,
} from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearRoomReadOverlays } from "@/components/chat/room-read-overlay";

import { CatchUpView } from "./catch-up-view";

const {
  listElsewhereMock,
  markAllReadMock,
  setLoopMock,
  showRoomUnreadCountMock,
  summaryActionMock,
} = vi.hoisted(() => ({
  listElsewhereMock: vi.fn(),
  markAllReadMock: vi.fn(),
  setLoopMock: vi.fn(),
  showRoomUnreadCountMock: vi.fn(),
  summaryActionMock: vi.fn(),
}));

const NOW = new Date("2026-10-31T12:00:00.000Z");

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
  getChatCatchUpSummaryAction: () => summaryActionMock(),
  setChatSignalLoopAction: (...args: unknown[]) => setLoopMock(...args),
}));

vi.mock("@/app/chat/actions", () => ({
  markAllChatUnreadReadAction: (...args: unknown[]) => markAllReadMock(...args),
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
  headline: null,
  generatedAt: null,
  counts: [],
  needsYou: [],
  blockers: [],
  decisions: [],
  announcements: [],
  openLoops: [],
  highlights: [],
  rooms: [],
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
    summaryAnswers({
      headline: "A quiet morning",
      rooms: [{ roomId: "own", roomName: "own room", line: "All settled" }],
    });

    renderCatchUp();
    const list = await findElsewhereList();
    const summary = await screen.findByTestId("catch-up-summary");

    expect(summary.compareDocumentPosition(list)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(within(summary).getByText("A quiet morning")).toBeTruthy();
    // The headline already says it; no second pass room by room.
    expect(within(summary).queryByText("All settled")).toBeNull();
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

  describe("the summary", () => {
    it("shows what needs you as cards, the rest as one card per room", async () => {
      summaryAnswers({
        headline: "Francis needs your green light.",
        needsYou: [item("q1"), item("q2")],
        blockers: [
          item("b1", { bucket: "blocker", roomId: "room-b", roomName: "NMKR" }),
        ],
        announcements: [item("a1", { bucket: "announcement" })],
      });

      renderCatchUp();
      const needsYou = await screen.findByRole("region", {
        name: "App.Channels.Signals.Sections.needsYou",
      });
      expect(
        within(needsYou).getAllByRole("link", {
          name: "App.Channels.Signals.openAndReply",
        }),
      ).toHaveLength(2);

      const rooms = screen.getByRole("region", {
        name: "App.Channels.Signals.inYourRooms",
      });
      expect(
        within(rooms).getAllByRole("button", {
          name: "App.Channels.Signals.markRead",
        }),
      ).toHaveLength(2);
      expect(within(rooms).getByText("NMKR")).toBeTruthy();
      expect(
        within(rooms).getByText("App.Channels.Signals.Chips.blocker"),
      ).toBeTruthy();
      // What needs you is not repeated in its room's card.
      expect(within(rooms).queryByText("text of q1")).toBeNull();
    });

    it("says how overdue a promise is, and what a decision answers", async () => {
      summaryAnswers({
        openLoops: [
          item("loop", {
            bucket: "commitment",
            dueAt: new Date("2026-10-28T09:00:00.000Z"),
          }),
        ],
        decisions: [
          item("d1", {
            bucket: "decisionMade",
            excerpt: "Oh yes, send it",
            inReplyTo: {
              senderName: "Patrick",
              excerpt: "Shall I send the deck?",
            },
          }),
        ],
      });

      renderCatchUp();

      expect(
        await screen.findByText("App.Channels.Signals.overdue 3"),
      ).toBeTruthy();
      expect(
        screen.getByText(
          "App.Channels.Signals.inReplyTo Patrick Shall I send the deck?",
        ),
      ).toBeTruthy();
    });

    it("marks a card done and reloads the summary", async () => {
      summaryAnswers({ needsYou: [item("q1")] });
      setLoopMock.mockResolvedValue({ ok: true, value: {} });

      renderCatchUp();
      const done = await screen.findByRole("button", {
        name: "App.Channels.Signals.done",
      });
      summaryAnswers();
      await act(async () => done.click());

      expect(setLoopMock).toHaveBeenCalledWith("q1", { closed: true });
      expect(await screen.findByTestId("chat-caught-up")).toBeTruthy();
    });

    it("marks one room read from its card", async () => {
      summaryAnswers({
        needsYou: [item("q1")],
        highlights: [
          item("h1", {
            parentMessageId: "parent",
            bucket: "question",
          }),
          item("h2", {
            roomId: "room-b",
            roomName: "NMKR",
            bucket: "question",
          }),
        ],
      });
      markAllReadMock.mockResolvedValue({ ok: true, value: null });

      renderCatchUp();
      const rooms = await screen.findByRole("region", {
        name: "App.Channels.Signals.inYourRooms",
      });
      const [sokosumi] = within(rooms).getAllByRole("button", {
        name: "App.Channels.Signals.markRead",
      });
      await act(async () => sokosumi.click());

      expect(markAllReadMock).toHaveBeenCalledWith([
        { roomId: "room-a", readRoom: true, lookThreads: true },
      ]);
    });

    it("marks every listed room read at once", async () => {
      summaryAnswers({
        needsYou: [item("q1")],
        highlights: [
          item("h1", {
            roomId: "room-b",
            roomName: "NMKR",
            parentMessageId: "parent",
            bucket: "question",
          }),
        ],
      });
      markAllReadMock.mockResolvedValue({ ok: true, value: null });

      renderCatchUp();
      const button = await screen.findByRole("button", {
        name: "App.Channels.Signals.markAllRead",
      });
      await act(async () => button.click());

      expect(markAllReadMock).toHaveBeenCalledWith([
        { roomId: "room-a", readRoom: true, lookThreads: false },
        { roomId: "room-b", readRoom: false, lookThreads: true },
      ]);
    });
  });
});
