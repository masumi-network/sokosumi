import "./rooms-client-harness";
import type { ChatRoomMessage } from "@sokosumi/core-client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { type ReactNode, type Ref, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RoomComposerHandle } from "../room-composer";
import { RoomsClient } from "../rooms-client";
import {
  listThreadMessagesAction,
  markThreadReadAction,
  renderWithQueryClient,
  roomsClientBaseProps,
} from "./rooms-client-harness";

const { composerFocus } = vi.hoisted(() => ({ composerFocus: vi.fn() }));

vi.mock("@/app/chat/components/room-search-panel", () => ({
  RoomSearchPanel: () => null,
}));

vi.mock("@/app/chat/components/unread-threads-panel", () => ({
  UnreadThreadsPanel: () => null,
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
      focus: composerFocus,
    }));
    return <div data-testid="room-session-composer" />;
  },
}));

// The row's reply bar is the thread's way in from the transcript, so it is
// where focus goes back to.
vi.mock("../room-message-row", () => ({
  ChatMessageRow: ({
    message,
    onOpenThread,
  }: {
    message: ChatRoomMessage;
    onOpenThread?: (message: ChatRoomMessage) => void;
  }) => (
    <article data-message-id={message.id}>
      <button
        type="button"
        data-testid={`open-thread-${message.id}`}
        onClick={() => onOpenThread?.(message)}
      >
        Open thread
      </button>
      {message.threadReplyCount > 0 ? (
        <button
          type="button"
          data-slot="thread-reply-bar"
          onClick={() => onOpenThread?.(message)}
        >
          {message.threadReplyCount} replies
        </button>
      ) : null}
    </article>
  ),
}));

vi.mock("../thread-list-panel", () => ({
  ThreadListPanel: () => <aside data-testid="thread-list-panel" />,
}));

vi.mock("../thread-panel", () => ({
  ThreadPanel: ({ onClose }: { onClose: () => void }) => (
    <aside>
      <button type="button" onClick={onClose}>
        Close thread
      </button>
    </aside>
  ),
}));

vi.mock("../edit-channel-dialog", () => ({
  EditChannelDialog: () => null,
}));

function message(id: string, threadReplyCount: number): ChatRoomMessage {
  return {
    id,
    roomId: "room-channel",
    parentMessageId: null,
    content: `Message ${id}`,
    createdAt: new Date("2026-07-01T12:01:00.000Z"),
    editedAt: null,
    pinnedAt: null,
    deletedAt: null,
    mentions: [],
    reactions: [],
    threadReplyCount,
    threadLastReplyAt:
      threadReplyCount > 0 ? new Date("2026-07-01T12:02:00.000Z") : null,
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

const baseProps = roomsClientBaseProps({
  messages: [message("with-replies", 2), message("no-replies", 0)],
});

describe("RoomsClient thread close focus", () => {
  beforeEach(() => {
    composerFocus.mockReset();
    markThreadReadAction.mockResolvedValue({
      ok: true as const,
      value: { lookedAt: new Date().toISOString() },
    });
    listThreadMessagesAction.mockResolvedValue({
      ok: true as const,
      value: { messages: [], nextCursor: null },
    });
  });

  it("returns focus to the thread's reply bar, not the page", async () => {
    renderWithQueryClient(<RoomsClient {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: "2 replies" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Close thread" }),
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "2 replies" }),
      );
    });
    expect(composerFocus).not.toHaveBeenCalled();
  });

  it("falls back to the composer when the message has no reply bar", async () => {
    renderWithQueryClient(<RoomsClient {...baseProps} />);
    fireEvent.click(screen.getByTestId("open-thread-no-replies"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Close thread" }),
    );

    await waitFor(() => {
      expect(composerFocus).toHaveBeenCalled();
    });
  });
});
