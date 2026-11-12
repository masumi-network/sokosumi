import "./rooms-client-harness";
import type { ChatRoomMessage } from "@sokosumi/core-client";
import { act, fireEvent, screen } from "@testing-library/react";
import { type ReactNode, type Ref, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomComposerHandle } from "@/app/chat/components/room-composer";
import { clearMembershipVisibleRoomsSnapshot } from "@/components/chat/membership-visible-rooms-store";
import { clearRoomReadOverlays } from "@/components/chat/room-read-overlay";
import { chatRoomMessageEventDataSchema } from "@/lib/ably/schema";
import { RoomsClient } from "../rooms-client";
import {
  deleteRoomMessageAction,
  editRoomMessageAction,
  pinRoomMessageAction,
  removeRoomMessageUnfurlAction,
  renderWithQueryClient,
  roomsClientBaseProps,
  setMessageReactionAction,
  toast,
  unpinRoomMessageAction,
  useChatRoomRealtimeMock,
} from "./rooms-client-harness";

/**
 * A change that touches one message must re-render that row only. The row
 * stub is memoized, so a row re-renders exactly when RoomsClient hands it a
 * prop with a new identity or value.
 */

const { rowRenders, fetchRoomMessagesMock } = vi.hoisted(() => ({
  rowRenders: new Map<string, number>(),
  fetchRoomMessagesMock: vi.fn(),
}));

vi.mock("@/app/chat/components/room-search-panel", () => ({
  RoomSearchPanel: () => null,
}));

vi.mock("@/app/chat/components/unread-threads-panel", () => ({
  UnreadThreadsPanel: () => null,
}));

// Scheduled room recovery reads go over GET; the poll is the refresh merge.
vi.mock("@/components/chat/fetch-room-messages", () => ({
  fetchRoomMessages: fetchRoomMessagesMock,
}));

vi.mock("../room-file-drop-zone", () => ({
  RoomFileDropZone: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("../room-session-composer", () => ({
  RoomSessionComposer: ({ ref }: { ref?: Ref<RoomComposerHandle> }) => {
    useImperativeHandle(ref, () => ({
      attachFiles: () => undefined,
      focus: () => undefined,
    }));
    return <div data-testid="room-session-composer" />;
  },
}));

vi.mock("../room-message-row", async () => {
  // Factory is hoisted before this file's imports; memo must load here.
  const { memo } = await import("react");
  return {
    ChannelMessageText: () => null,
    ChatMessageRow: memo(function ChatMessageRowStub({
      message,
      isPinned,
      isSaving,
      isEditing,
      editDraft,
      onToggleReaction,
      onPin,
      onDelete,
      onRemoveUnfurl,
      onStartEdit,
      onOpenThread,
      onEditDraftChange,
      onSaveEdit,
    }: {
      message: ChatRoomMessage;
      isPinned?: boolean;
      isSaving?: boolean;
      isEditing?: boolean;
      editDraft?: string;
      onToggleReaction: (message: ChatRoomMessage, emoji: string) => void;
      onPin?: (message: ChatRoomMessage) => void;
      onDelete?: (message: ChatRoomMessage) => void;
      onRemoveUnfurl?: (message: ChatRoomMessage, url: string) => void;
      onStartEdit?: (message: ChatRoomMessage) => void;
      onOpenThread?: (message: ChatRoomMessage) => void;
      onEditDraftChange?: (value: string) => void;
      onSaveEdit?: (content?: string) => void;
    }) {
      rowRenders.set(message.id, (rowRenders.get(message.id) ?? 0) + 1);
      return (
        <div
          data-testid="chat-message-row"
          data-message-id={message.id}
          data-pinned={String(Boolean(isPinned))}
          data-deleted={String(message.deletedAt != null)}
          data-unfurls={(message.unfurls ?? [])
            .map((unfurl) => unfurl.url)
            .join(" ")}
          aria-busy={isSaving || undefined}
          data-editing={String(Boolean(isEditing))}
          data-edit-draft={editDraft ?? ""}
        >
          {message.content}
          <button type="button" onClick={() => onToggleReaction(message, "👍")}>
            {`React ${message.id}`}
          </button>
          <button type="button" onClick={() => onPin?.(message)}>
            {`Pin ${message.id}`}
          </button>
          <button type="button" onClick={() => onStartEdit?.(message)}>
            {`Edit ${message.id}`}
          </button>
          <button type="button" onClick={() => onDelete?.(message)}>
            {`Delete ${message.id}`}
          </button>
          {(message.unfurls ?? []).map((unfurl) => (
            <button
              key={unfurl.url}
              type="button"
              onClick={() => onRemoveUnfurl?.(message, unfurl.url)}
            >
              {`Remove ${unfurl.url}`}
            </button>
          ))}
          <button type="button" onClick={() => onOpenThread?.(message)}>
            {`Thread ${message.id}`}
          </button>
          <button
            type="button"
            onClick={() => onEditDraftChange?.("typed draft")}
          >
            {`Type ${message.id}`}
          </button>
          <button type="button" onClick={() => onSaveEdit?.()}>
            {`Save ${message.id}`}
          </button>
        </div>
      );
    }),
  };
});

vi.mock("../thread-panel", () => ({
  ThreadPanel: ({
    parentMessage,
    editSession,
    onStartEdit,
  }: {
    parentMessage: ChatRoomMessage;
    editSession?: { messageId: string } | null;
    onStartEdit?: (message: ChatRoomMessage) => void;
  }) => (
    <div data-testid="thread-panel" data-editing={editSession?.messageId ?? ""}>
      <button type="button" onClick={() => onStartEdit?.(parentMessage)}>
        Edit thread parent
      </button>
    </div>
  ),
}));

vi.mock("../edit-channel-dialog", () => ({
  EditChannelDialog: ({ children }: { children?: ReactNode }) => (
    <>{children}</>
  ),
}));

function message(id: string, minute: number): ChatRoomMessage {
  return {
    id,
    roomId: "room-channel",
    parentMessageId: null,
    content: `body ${id}`,
    createdAt: new Date(
      `2026-07-01T12:${String(minute).padStart(2, "0")}:00.000Z`,
    ),
    editedAt: null,
    pinnedAt: null,
    deletedAt: null,
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: null,
    quote: null,
    membership: null,
    groupNameChange: null,
    unfurls: null,
    sender: {
      type: "user",
      user: {
        id: "user-1",
        name: "Ada",
        email: "ada@example.com",
        image: null,
        presence: "offline",
      },
    },
  };
}

const messages = [message("m1", 1), message("m2", 2), message("m3", 3)];

const baseProps = roomsClientBaseProps({ messages });

function realtimeOptions() {
  const options = useChatRoomRealtimeMock.mock.calls.at(-1)?.[0];
  if (!options) {
    throw new Error("useChatRoomRealtime was not called");
  }
  return options;
}

function snapshotRenders() {
  return new Map(rowRenders);
}

function rendersSince(before: Map<string, number>) {
  const delta: Record<string, number> = {};
  for (const [id, count] of rowRenders) {
    delta[id] = count - (before.get(id) ?? 0);
  }
  return delta;
}

async function mountRoom(initialMessages: ChatRoomMessage[] = messages) {
  renderWithQueryClient(
    <RoomsClient {...baseProps} messages={initialMessages} />,
  );
  await act(async () => {});
  expect(screen.getAllByTestId("chat-message-row")).toHaveLength(3);
  return snapshotRenders();
}

function savingRowIds() {
  return screen
    .getAllByTestId("chat-message-row")
    .filter((row) => row.getAttribute("aria-busy") === "true")
    .map((row) => row.getAttribute("data-message-id"));
}

function pinnedFlags() {
  return screen
    .getAllByTestId("chat-message-row")
    .map((row) => row.getAttribute("data-pinned"));
}

describe("RoomsClient transcript row render isolation", () => {
  beforeEach(() => {
    clearRoomReadOverlays();
    clearMembershipVisibleRoomsSnapshot();
    rowRenders.clear();
    vi.clearAllMocks();
    fetchRoomMessagesMock
      .mockReset()
      .mockResolvedValue({ messages: [], nextCursor: null });
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  });

  afterEach(() => {
    clearMembershipVisibleRoomsSnapshot();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("renders no row when a refresh merge re-sends the same messages", async () => {
    vi.useFakeTimers();
    fetchRoomMessagesMock.mockImplementation(async () => ({
      messages: [message("m1", 1), message("m2", 2), message("m3", 3)],
      nextCursor: null,
    }));
    const before = await mountRoom();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });

    expect(fetchRoomMessagesMock).toHaveBeenCalled();
    expect(rendersSince(before)).toEqual({ m1: 0, m2: 0, m3: 0 });
  });

  it("renders only the changed row when a refresh merge differs", async () => {
    vi.useFakeTimers();
    fetchRoomMessagesMock.mockImplementation(async () => ({
      messages: [
        message("m1", 1),
        { ...message("m2", 2), content: "edited elsewhere" },
        message("m3", 3),
      ],
      nextCursor: null,
    }));
    const before = await mountRoom();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });

    expect(screen.getByText("edited elsewhere")).toBeTruthy();
    expect(rendersSince(before)).toEqual({ m1: 0, m2: 1, m3: 0 });
  });

  it("renders only the new row when a realtime message arrives", async () => {
    const before = await mountRoom();

    const event = chatRoomMessageEventDataSchema.parse(
      JSON.parse(
        JSON.stringify({ eventType: "create", message: message("m4", 4) }),
      ),
    );
    await act(async () => {
      realtimeOptions().onMessage?.(event);
    });

    expect(screen.getByText("body m4")).toBeTruthy();
    expect(rendersSince(before)).toEqual({ m1: 0, m2: 0, m3: 0, m4: 1 });
  });

  it("re-renders only the reacted row", async () => {
    vi.mocked(setMessageReactionAction).mockImplementation(
      async (_roomId, messageId, emoji, reacted) => ({
        ok: true as const,
        value: {
          ...message(messageId, 2),
          reactions: reacted
            ? [{ emoji, count: 1, reactedByCurrentUser: true, reactors: [] }]
            : [],
        },
      }),
    );
    const before = await mountRoom();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "React m2" }));
    });

    expect(setMessageReactionAction).toHaveBeenCalledWith(
      "room-channel",
      "m2",
      "👍",
      true,
    );
    // Once for the Pending reaction, once for the confirmed entry.
    expect(rendersSince(before)).toEqual({ m1: 0, m2: 2, m3: 0 });
  });

  it("re-renders only the row entering edit mode", async () => {
    const before = await mountRoom();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Edit m2" }));
    });

    expect(
      screen
        .getAllByTestId("chat-message-row")
        .map((row) => row.getAttribute("data-editing")),
    ).toEqual(["false", "true", "false"]);
    expect(rendersSince(before)).toEqual({ m1: 0, m2: 1, m3: 0 });
  });

  it("edits an open thread's parent in only the surface that started it", async () => {
    await mountRoom();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Thread m2" }));
    });
    const row = () =>
      screen
        .getAllByTestId("chat-message-row")
        .find((r) => r.getAttribute("data-message-id") === "m2");
    const thread = () => screen.getByTestId("thread-panel");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Edit m2" }));
    });
    expect(row()?.getAttribute("data-editing")).toBe("true");
    expect(thread().getAttribute("data-editing")).toBe("");

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Edit thread parent" }),
      );
    });
    expect(row()?.getAttribute("data-editing")).toBe("false");
    expect(thread().getAttribute("data-editing")).toBe("m2");
  });

  it("re-renders only the edited row while its draft changes", async () => {
    await mountRoom();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Edit m2" }));
    });
    const before = snapshotRenders();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Type m2" }));
    });

    expect(
      screen
        .getAllByTestId("chat-message-row")
        .map((row) => row.getAttribute("data-edit-draft")),
    ).toEqual(["", "typed draft", ""]);
    expect(rendersSince(before)).toEqual({ m1: 0, m2: 1, m3: 0 });
  });

  it("unpins a row that was pinned over realtime after mount", async () => {
    vi.mocked(unpinRoomMessageAction).mockResolvedValue({
      ok: true as const,
      value: undefined as never,
    });
    await mountRoom();

    await act(async () => {
      realtimeOptions().onPinnedMessage?.({
        action: "pin",
        roomId: "room-channel",
        messageId: "m2",
        pinnedMessageCount: 1,
      });
    });
    expect(
      screen
        .getAllByTestId("chat-message-row")
        .map((row) => row.getAttribute("data-pinned")),
    ).toEqual(["false", "true", "false"]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pin m2" }));
    });

    expect(unpinRoomMessageAction).toHaveBeenCalledWith("room-channel", "m2");
    expect(pinRoomMessageAction).not.toHaveBeenCalled();
  });

  it("shows the Pin before Core answers and sends one write for two clicks", async () => {
    let answer: (result: { ok: true; value: never }) => void = () => {};
    vi.mocked(pinRoomMessageAction).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    await mountRoom();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pin m2" }));
    });
    expect(pinnedFlags()).toEqual(["false", "true", "false"]);
    expect(savingRowIds()).toEqual(["m2"]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pin m2" }));
    });
    expect(pinRoomMessageAction).toHaveBeenCalledTimes(1);
    expect(unpinRoomMessageAction).not.toHaveBeenCalled();

    await act(async () => {
      answer({ ok: true, value: undefined as never });
    });
    expect(pinnedFlags()).toEqual(["false", "true", "false"]);
    expect(savingRowIds()).toEqual([]);

    // The answered write frees the message for the next one.
    vi.mocked(unpinRoomMessageAction).mockResolvedValueOnce({
      ok: true as const,
      value: undefined as never,
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pin m2" }));
    });
    expect(unpinRoomMessageAction).toHaveBeenCalledWith("room-channel", "m2");
    expect(pinnedFlags()).toEqual(["false", "false", "false"]);
  });

  it("puts the row back and says so when Core refuses the Pin", async () => {
    vi.mocked(pinRoomMessageAction).mockResolvedValueOnce({
      ok: false as const,
      error: { message: "Pin refused" } as never,
    });
    await mountRoom();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pin m2" }));
    });

    expect(pinnedFlags()).toEqual(["false", "false", "false"]);
    expect(toast.error).toHaveBeenCalledWith("Pin refused", {
      description: "PinnedMessages.stateUnpinned",
    });
  });

  it("marks the row as saving until a failed Pin answers, then says it is not pinned", async () => {
    let fail: (error: Error) => void = () => {};
    vi.mocked(pinRoomMessageAction).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    await mountRoom();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pin m2" }));
    });
    expect(savingRowIds()).toEqual(["m2"]);
    expect(toast.error).not.toHaveBeenCalled();

    await act(async () => {
      fail(new Error("down"));
    });

    expect(savingRowIds()).toEqual([]);
    expect(pinnedFlags()).toEqual(["false", "false", "false"]);
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(
      "PinnedMessages.pinError",
      { description: "PinnedMessages.stateUnpinned" },
    );
  });

  it("puts the Pin back when the unpin request fails", async () => {
    vi.mocked(unpinRoomMessageAction).mockRejectedValueOnce(new Error("down"));
    await mountRoom([
      message("m1", 1),
      { ...message("m2", 2), pinnedAt: new Date("2026-07-01T13:00:00.000Z") },
      message("m3", 3),
    ]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pin m2" }));
    });

    expect(pinnedFlags()).toEqual(["false", "true", "false"]);
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(
      "PinnedMessages.unpinError",
      { description: "PinnedMessages.statePinned" },
    );
  });

  it("keeps the Pin when its own realtime event came before the failed answer", async () => {
    let fail: (error: Error) => void = () => {};
    vi.mocked(pinRoomMessageAction).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    await mountRoom();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pin m2" }));
    });

    await act(async () => {
      realtimeOptions().onPinnedMessage?.({
        action: "pin",
        roomId: "room-channel",
        messageId: "m2",
        pinnedMessageCount: 1,
      });
    });
    await act(async () => {
      fail(new Error("timeout"));
    });

    expect(pinnedFlags()).toEqual(["false", "true", "false"]);
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(
      "PinnedMessages.pinError",
      { description: "PinnedMessages.statePinned" },
    );
  });

  it("sets the Pin again when a read put the old state back during the write", async () => {
    vi.useFakeTimers();
    // A transcript read that began before Core had the write.
    fetchRoomMessagesMock.mockImplementation(async () => ({
      messages: [
        message("m1", 1),
        { ...message("m2", 2), updatedAt: new Date("2026-07-02T00:00:00Z") },
        message("m3", 3),
      ],
      nextCursor: null,
    }));
    let answer: (result: { ok: true; value: never }) => void = () => {};
    vi.mocked(pinRoomMessageAction).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    await mountRoom();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pin m2" }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(pinnedFlags()).toEqual(["false", "false", "false"]);

    await act(async () => {
      answer({ ok: true, value: undefined as never });
    });

    expect(pinnedFlags()).toEqual(["false", "true", "false"]);
  });

  describe("link preview removal", () => {
    const unfurl = (url: string) => ({
      url,
      title: url,
      description: null,
      imageUrl: null,
      siteName: null,
    });
    const withPreviews = () => [
      message("m1", 1),
      { ...message("m2", 2), unfurls: [unfurl("a"), unfurl("b"), unfurl("c")] },
      message("m3", 3),
    ];
    const previews = () =>
      screen
        .getAllByTestId("chat-message-row")
        .map((row) => row.getAttribute("data-unfurls"));
    const remove = async (url: string) => {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: `Remove ${url}` }));
      });
    };

    it("takes the card out before Core answers, then shows Core's message", async () => {
      let answer: (result: unknown) => void = () => {};
      vi.mocked(removeRoomMessageUnfurlAction).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = resolve as (result: unknown) => void;
          }) as never,
      );
      await mountRoom(withPreviews());

      await remove("b");
      expect(previews()).toEqual(["", "a c", ""]);
      expect(removeRoomMessageUnfurlAction).toHaveBeenCalledWith(
        "room-channel",
        "m2",
        "b",
      );

      await act(async () => {
        answer({
          ok: true,
          value: { ...message("m2", 2), unfurls: [unfurl("a")] },
        });
      });
      expect(previews()).toEqual(["", "a", ""]);

      // The answered removal is closed: a later answer may hold "b" again.
      vi.mocked(removeRoomMessageUnfurlAction).mockResolvedValueOnce({
        ok: true as const,
        value: { ...message("m2", 2), unfurls: [unfurl("b")] },
      } as never);
      await remove("a");
      expect(previews()).toEqual(["", "b", ""]);
    });

    it("puts a refused card back in its place and says so", async () => {
      vi.mocked(removeRoomMessageUnfurlAction).mockResolvedValueOnce({
        ok: false as const,
        error: { message: "Removal refused" } as never,
      });
      await mountRoom(withPreviews());

      await remove("b");

      expect(previews()).toEqual(["", "a b c", ""]);
      expect(toast.error).toHaveBeenCalledWith("Removal refused", {
        description: "Unfurl.restored",
      });

      // The refused removal is closed: a later answer may hold its card.
      vi.mocked(removeRoomMessageUnfurlAction).mockResolvedValueOnce({
        ok: true as const,
        value: { ...message("m2", 2), unfurls: [unfurl("b"), unfurl("c")] },
      } as never);
      await remove("a");
      expect(previews()).toEqual(["", "b c", ""]);
    });

    it("puts the card back when the request fails, and keeps a second removal", async () => {
      let fail: (error: Error) => void = () => {};
      vi.mocked(removeRoomMessageUnfurlAction)
        .mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              fail = reject;
            }) as never,
        )
        .mockImplementationOnce(() => new Promise(() => {}) as never);
      await mountRoom(withPreviews());
      await remove("b");
      await remove("a");
      expect(previews()).toEqual(["", "c", ""]);

      await act(async () => {
        fail(new Error("down"));
      });

      expect(previews()).toEqual(["", "b c", ""]);
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(
        "Unfurl.removeError",
        {
          description: "Unfurl.restored",
        },
      );
    });

    it("puts a refused last card back at the end", async () => {
      vi.mocked(removeRoomMessageUnfurlAction).mockResolvedValueOnce({
        ok: false as const,
        error: { message: "Removal refused" } as never,
      });
      await mountRoom(withPreviews());

      await remove("c");

      expect(previews()).toEqual(["", "a b c", ""]);
    });

    it("does not add the card twice when a realtime update put it back first", async () => {
      let fail: (error: Error) => void = () => {};
      vi.mocked(removeRoomMessageUnfurlAction).mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            fail = reject;
          }) as never,
      );
      await mountRoom(withPreviews());
      await remove("b");
      const event = chatRoomMessageEventDataSchema.parse(
        JSON.parse(
          JSON.stringify({ eventType: "update", message: withPreviews()[1] }),
        ),
      );
      await act(async () => {
        realtimeOptions().onMessage?.(event);
      });
      expect(previews()).toEqual(["", "a b c", ""]);

      await act(async () => {
        fail(new Error("down"));
      });

      expect(previews()).toEqual(["", "a b c", ""]);
    });

    it("keeps a second card out when Core answers the first removal", async () => {
      let answer: (result: unknown) => void = () => {};
      vi.mocked(removeRoomMessageUnfurlAction)
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              answer = resolve as (result: unknown) => void;
            }) as never,
        )
        .mockImplementationOnce(() => new Promise(() => {}) as never);
      await mountRoom(withPreviews());
      await remove("b");
      await remove("a");

      // Core's answer to the first removal still holds "a".
      await act(async () => {
        answer({
          ok: true,
          value: { ...message("m2", 2), unfurls: [unfurl("a"), unfurl("c")] },
        });
      });

      expect(previews()).toEqual(["", "c", ""]);
    });
  });

  describe("delete", () => {
    const rows = () =>
      screen
        .getAllByTestId("chat-message-row")
        .map(
          (row) =>
            `${row.getAttribute("data-deleted")}:${row.firstChild?.textContent}`,
        );
    const clickDelete = async () => {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Delete m2" }));
      });
    };

    // The transcript leaves out a message with no text, so a tombstone too.
    it("takes the message out before Core answers", async () => {
      let answer: (result: unknown) => void = () => {};
      vi.mocked(deleteRoomMessageAction).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      );
      await mountRoom();

      await clickDelete();
      expect(rows()).toEqual(["false:body m1", "false:body m3"]);
      expect(deleteRoomMessageAction).toHaveBeenCalledWith(
        "room-channel",
        "m2",
      );

      await act(async () => {
        answer({
          ok: true,
          value: {
            ...message("m2", 2),
            content: "",
            deletedAt: new Date("2026-07-02T00:00:00.000Z"),
          },
        });
      });
      expect(rows()).toEqual(["false:body m1", "false:body m3"]);
    });

    it("puts a refused message back and says so", async () => {
      vi.mocked(deleteRoomMessageAction).mockResolvedValueOnce({
        ok: false as const,
        error: { message: "Delete refused" } as never,
      });
      await mountRoom();

      await clickDelete();

      expect(rows()).toEqual([
        "false:body m1",
        "false:body m2",
        "false:body m3",
      ]);
      expect(toast.error).toHaveBeenCalledWith("Delete refused", {
        description: "Message.restored",
      });
    });

    it("puts the message back when the request fails", async () => {
      vi.mocked(deleteRoomMessageAction).mockRejectedValueOnce(
        new Error("down"),
      );
      await mountRoom();

      await clickDelete();

      expect(rows()).toEqual([
        "false:body m1",
        "false:body m2",
        "false:body m3",
      ]);
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(
        "Message.deleteError",
        { description: "Message.restored" },
      );
    });

    it("keeps the message deleted when Core's delete event came before the failed answer", async () => {
      let fail: (error: Error) => void = () => {};
      vi.mocked(deleteRoomMessageAction).mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            fail = reject;
          }),
      );
      await mountRoom();
      await clickDelete();
      const event = chatRoomMessageEventDataSchema.parse(
        JSON.parse(
          JSON.stringify({
            eventType: "delete",
            message: {
              ...message("m2", 2),
              content: "",
              deletedAt: new Date("2026-07-02T00:00:00.000Z"),
            },
          }),
        ),
      );
      await act(async () => {
        realtimeOptions().onMessage?.(event);
      });

      await act(async () => {
        fail(new Error("down"));
      });

      expect(rows()).toEqual(["false:body m1", "false:body m3"]);
      // The row stays deleted, so the toast does not say it is back.
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(
        "Message.deleteError",
        { description: undefined },
      );
    });

    it("keeps a newer realtime update when the delete then fails", async () => {
      let fail: (error: Error) => void = () => {};
      vi.mocked(deleteRoomMessageAction).mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            fail = reject;
          }),
      );
      await mountRoom();
      await clickDelete();
      const event = chatRoomMessageEventDataSchema.parse(
        JSON.parse(
          JSON.stringify({
            eventType: "update",
            message: { ...message("m2", 2), content: "edited m2" },
          }),
        ),
      );
      await act(async () => {
        realtimeOptions().onMessage?.(event);
      });

      await act(async () => {
        fail(new Error("down"));
      });

      expect(rows()).toEqual([
        "false:body m1",
        "false:edited m2",
        "false:body m3",
      ]);
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(
        "Message.deleteError",
        { description: undefined },
      );
    });
  });

  describe("save edit", () => {
    const m2 = () => {
      const row = screen
        .getAllByTestId("chat-message-row")
        .find((r) => r.getAttribute("data-message-id") === "m2");
      return [
        row?.firstChild?.textContent,
        row?.getAttribute("data-editing"),
        row?.getAttribute("data-edit-draft"),
      ];
    };
    const typeAndSave = async () => {
      for (const name of ["Edit m2", "Type m2", "Save m2"]) {
        await act(async () => {
          fireEvent.click(screen.getByRole("button", { name }));
        });
      }
    };

    it("closes the editor and shows the new text before Core answers", async () => {
      let answer: (result: unknown) => void = () => {};
      vi.mocked(editRoomMessageAction).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      );
      await mountRoom();

      await typeAndSave();
      expect(m2()).toEqual(["typed draft", "false", ""]);
      expect(savingRowIds()).toEqual(["m2"]);

      // No second edit on a text Core does not have yet.
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Edit m2" }));
      });
      expect(m2()).toEqual(["typed draft", "false", ""]);

      await act(async () => {
        answer({
          ok: true,
          value: { ...message("m2", 2), content: "typed draft, by Core" },
        });
      });
      expect(m2()).toEqual(["typed draft, by Core", "false", ""]);
      expect(savingRowIds()).toEqual([]);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Edit m2" }));
      });
      expect(m2()).toEqual([
        "typed draft, by Core",
        "true",
        "typed draft, by Core",
      ]);
    });

    it("puts the old text back and offers the editor again when Core refuses", async () => {
      vi.mocked(editRoomMessageAction).mockResolvedValueOnce({
        ok: false as const,
        error: { message: "Edit refused" } as never,
      });
      await mountRoom();

      await typeAndSave();

      expect(m2()).toEqual(["body m2", "false", ""]);
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(
        "Edit refused",
        expect.objectContaining({
          description: "Edit.restored",
          action: expect.objectContaining({ label: "Edit.action" }),
        }),
      );

      // The toast's action opens the editor with the text the user confirmed.
      await act(async () => {
        toast.error.mock.calls[0][1].action.onClick();
      });
      expect(m2()).toEqual(["body m2", "true", "typed draft"]);
    });

    it("does the same when the request fails, and marks the row as saving until then", async () => {
      let fail: (error: Error) => void = () => {};
      vi.mocked(editRoomMessageAction).mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            fail = reject;
          }),
      );
      await mountRoom();

      await typeAndSave();
      expect(savingRowIds()).toEqual(["m2"]);
      expect(toast.error).not.toHaveBeenCalled();

      await act(async () => {
        fail(new Error("down"));
      });

      expect(savingRowIds()).toEqual([]);
      expect(m2()).toEqual(["body m2", "false", ""]);
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(
        "Edit.saveError",
        expect.objectContaining({
          description: "Edit.restored",
          action: expect.objectContaining({ label: "Edit.action" }),
        }),
      );
    });

    it("keeps the saving mark while an edit is open after a pin on the same message answers", async () => {
      let answerPin: (result: { ok: true; value: never }) => void = () => {};
      let answerEdit: (result: unknown) => void = () => {};
      vi.mocked(pinRoomMessageAction).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answerPin = resolve;
          }),
      );
      vi.mocked(editRoomMessageAction).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answerEdit = resolve;
          }),
      );
      await mountRoom();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Pin m2" }));
      });
      await typeAndSave();

      await act(async () => {
        answerPin({ ok: true, value: undefined as never });
      });
      expect(savingRowIds()).toEqual(["m2"]);

      await act(async () => {
        answerEdit({ ok: true, value: { ...message("m2", 2) } });
      });
      expect(savingRowIds()).toEqual([]);
    });

    it("does not open the editor from an old toast while a newer save is open", async () => {
      let answer: (result: unknown) => void = () => {};
      vi.mocked(editRoomMessageAction)
        .mockResolvedValueOnce({
          ok: false as const,
          error: { message: "Edit refused" } as never,
        })
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              answer = resolve;
            }),
        );
      await mountRoom();
      await typeAndSave();
      await typeAndSave();
      expect(m2()).toEqual(["typed draft", "false", ""]);

      await act(async () => {
        toast.error.mock.calls[0][1].action.onClick();
      });
      expect(m2()).toEqual(["typed draft", "false", ""]);

      await act(async () => {
        answer({
          ok: true,
          value: { ...message("m2", 2), content: "typed draft" },
        });
      });
    });

    it("keeps a newer realtime text when the save then fails", async () => {
      let fail: (error: Error) => void = () => {};
      vi.mocked(editRoomMessageAction).mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            fail = reject;
          }),
      );
      await mountRoom();
      await typeAndSave();
      const event = chatRoomMessageEventDataSchema.parse(
        JSON.parse(
          JSON.stringify({
            eventType: "update",
            message: { ...message("m2", 2), content: "edited elsewhere" },
          }),
        ),
      );
      await act(async () => {
        realtimeOptions().onMessage?.(event);
      });

      await act(async () => {
        fail(new Error("down"));
      });

      expect(m2()).toEqual(["edited elsewhere", "false", ""]);
      // The row keeps the newer text, so the toast does not say the earlier
      // text is back.
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(
        "Edit.saveError",
        expect.objectContaining({ description: undefined }),
      );
    });
  });

  it("marks messages pinned on first load without opening the pinned panel", async () => {
    await mountRoom([
      message("m1", 1),
      { ...message("m2", 2), pinnedAt: new Date("2026-07-01T13:00:00.000Z") },
      message("m3", 3),
    ]);

    expect(pinnedFlags()).toEqual(["false", "true", "false"]);
  });

  it("clears the pinned mark on a realtime unpin", async () => {
    await mountRoom([
      message("m1", 1),
      { ...message("m2", 2), pinnedAt: new Date("2026-07-01T13:00:00.000Z") },
      message("m3", 3),
    ]);

    await act(async () => {
      realtimeOptions().onPinnedMessage?.({
        action: "unpin",
        roomId: "room-channel",
        messageId: "m2",
        pinnedMessageCount: 0,
      });
    });

    expect(pinnedFlags()).toEqual(["false", "false", "false"]);
  });

  it("ignores a realtime pin for another room", async () => {
    await mountRoom();

    await act(async () => {
      realtimeOptions().onPinnedMessage?.({
        action: "pin",
        roomId: "room-other",
        messageId: "m2",
        pinnedMessageCount: 1,
      });
    });

    expect(pinnedFlags()).toEqual(["false", "false", "false"]);
  });

  it("re-renders only the row a realtime pin touches", async () => {
    const before = await mountRoom();

    await act(async () => {
      realtimeOptions().onPinnedMessage?.({
        action: "pin",
        roomId: "room-channel",
        messageId: "m2",
        pinnedMessageCount: 1,
      });
    });

    expect(rendersSince(before)).toEqual({ m1: 0, m2: 1, m3: 0 });
  });

  it("keeps the pinned mark when a full realtime update includes pinnedAt", async () => {
    const pinnedAt = new Date("2026-07-01T13:00:00.000Z");
    await mountRoom([
      message("m1", 1),
      { ...message("m2", 2), pinnedAt },
      message("m3", 3),
    ]);

    const event = chatRoomMessageEventDataSchema.parse(
      JSON.parse(
        JSON.stringify({
          eventType: "update",
          message: {
            ...message("m2", 2),
            content: "edited pinned",
            pinnedAt,
          },
        }),
      ),
    );
    await act(async () => {
      realtimeOptions().onMessage?.(event);
    });

    expect(screen.getByText("edited pinned")).toBeTruthy();
    expect(pinnedFlags()).toEqual(["false", "true", "false"]);
  });

  it("clears the pinned mark when a full realtime update sends pinnedAt null", async () => {
    await mountRoom([
      message("m1", 1),
      { ...message("m2", 2), pinnedAt: new Date("2026-07-01T13:00:00.000Z") },
      message("m3", 3),
    ]);

    const event = chatRoomMessageEventDataSchema.parse(
      JSON.parse(
        JSON.stringify({
          eventType: "update",
          message: { ...message("m2", 2), content: "edited unpinned" },
        }),
      ),
    );
    await act(async () => {
      realtimeOptions().onMessage?.(event);
    });

    expect(screen.getByText("edited unpinned")).toBeTruthy();
    expect(pinnedFlags()).toEqual(["false", "false", "false"]);
  });

  it("saves the current draft after a realtime update to the edited row", async () => {
    vi.mocked(editRoomMessageAction).mockImplementation(
      async (_roomId, messageId, content) => ({
        ok: true as const,
        value: { ...message(messageId, 2), content },
      }),
    );
    await mountRoom();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Edit m2" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Type m2" }));
    });
    const event = chatRoomMessageEventDataSchema.parse(
      JSON.parse(
        JSON.stringify({
          eventType: "update",
          message: { ...message("m2", 2), reactions: [] },
        }),
      ),
    );
    await act(async () => {
      realtimeOptions().onMessage?.(event);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save m2" }));
    });

    expect(editRoomMessageAction).toHaveBeenCalledWith(
      "room-channel",
      "m2",
      "typed draft",
    );
  });
});
