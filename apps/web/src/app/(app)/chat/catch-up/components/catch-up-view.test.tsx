import type { ChatCatchUpSummary, ChatRoom } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearRoomReadOverlays } from "@/components/chat/room-read-overlay";
import { clearElsewhereRooms } from "@/components/chat/use-elsewhere-rooms";

import { CatchUpView } from "./catch-up-view";

const { listElsewhereMock, summaryActionMock } = vi.hoisted(() => ({
  listElsewhereMock: vi.fn(),
  summaryActionMock: vi.fn(),
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
  useFormatter: () => ({ relativeTime: () => "just now" }),
}));

vi.mock("@/app/chat/signal-actions", () => ({
  getChatCatchUpSummaryAction: () => summaryActionMock(),
}));

vi.mock("@/components/chat/fetch-sidebar-room-collection", () => ({
  fetchSidebarRoomCollection: () => listElsewhereMock(),
}));

vi.mock("@/components/chat/use-show-room-unread-count", () => ({
  useShowRoomUnreadCount: () => true,
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
  decisions: [],
  openLoops: [],
  highlights: [],
  rooms: [],
};

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
  clearElsewhereRooms();
  listElsewhereMock.mockReset();
  summaryActionMock.mockReset();
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

  it("bolds a room as its row would, and leaves a Thread-only room unmarked", async () => {
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
    await findElsewhereList();

    expect(screen.getByText("launch").className).toContain("font-semibold");
    expect(screen.getByText("threads").className).not.toContain(
      "font-semibold",
    );
  });

  it("is absent while nothing is unread elsewhere", async () => {
    renderCatchUp();

    await waitFor(() => expect(listElsewhereMock).toHaveBeenCalled());
    await screen.findByTestId("chat-caught-up");
    expect(elsewhereList()).toBeNull();
  });

  it("stands above the written summary, which keeps its content", async () => {
    listElsewhereMock.mockResolvedValue([elsewhereRoom("launch")]);
    summaryAnswers({
      headline: "A quiet morning",
      rooms: [{ roomId: "own", roomName: "own room", line: "All settled" }],
    });

    renderCatchUp();
    const list = await findElsewhereList();
    const summary = await screen.findByTestId("catch-up-summary");

    expect(list.compareDocumentPosition(summary)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(within(summary).getByText("A quiet morning")).toBeTruthy();
    expect(within(summary).getByText("All settled")).toBeTruthy();
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
});
