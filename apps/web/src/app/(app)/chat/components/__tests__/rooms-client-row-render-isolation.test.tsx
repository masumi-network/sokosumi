import "./rooms-client-harness";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode, type Ref, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomComposerHandle } from "@/app/chat/components/room-composer";
import { clearMembershipVisibleRoomsSnapshot } from "@/components/chat/membership-visible-rooms-store";
import { clearRoomReadOverlays } from "@/components/chat/room-read-overlay";
import { chatRoomMessageEventDataSchema } from "@/lib/ably/schema";
import type { ChatRoomMessage } from "@/lib/clients/generated/core";
import { RoomsClient } from "../rooms-client";
import {
  editRoomMessageAction,
  pinRoomMessageAction,
  roomsClientBaseProps,
  setMessageReactionAction,
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
      isEditing,
      editDraft,
      onToggleReaction,
      onPin,
      onStartEdit,
      onEditDraftChange,
      onSaveEdit,
    }: {
      message: ChatRoomMessage;
      isPinned?: boolean;
      isEditing?: boolean;
      editDraft?: string;
      onToggleReaction: (message: ChatRoomMessage, emoji: string) => void;
      onPin?: (message: ChatRoomMessage) => void;
      onStartEdit?: (message: ChatRoomMessage) => void;
      onEditDraftChange?: (value: string) => void;
      onSaveEdit?: (content?: string) => void;
    }) {
      rowRenders.set(message.id, (rowRenders.get(message.id) ?? 0) + 1);
      return (
        <div
          data-testid="chat-message-row"
          data-message-id={message.id}
          data-pinned={String(Boolean(isPinned))}
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
  ThreadPanel: () => null,
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
  render(<RoomsClient {...baseProps} messages={initialMessages} />);
  await act(async () => {});
  expect(screen.getAllByTestId("chat-message-row")).toHaveLength(3);
  return snapshotRenders();
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
