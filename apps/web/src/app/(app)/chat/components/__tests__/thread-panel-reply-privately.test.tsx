import type { ChatRoomMessage } from "@sokosumi/core-client";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode, Ref } from "react";
import { describe, expect, it, vi } from "vitest";

import type { RoomComposerHandle } from "../room-composer";
import { ThreadPanel } from "../thread-panel";

// The thread's mute button loads the thread through a server action; a DOM
// test has no server to run it on (`thread-mute-button.test.tsx` covers it).
vi.mock("@/app/chat/actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/chat/actions")>()),
  getRoomThreadAction: async () => ({
    ok: true as const,
    value: { mutedAt: null },
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (key === "Thread.replyCount" && values) {
      return `replies:${values.count}`;
    }
    return key;
  },
}));

vi.mock("../room-file-drop-zone", () => ({
  RoomFileDropZone: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("../room-session-composer", () => ({
  RoomSessionComposer: ({ ref: _ref }: { ref?: Ref<RoomComposerHandle> }) => (
    <div data-testid="thread-composer" />
  ),
}));

vi.mock("../room-message-row", () => ({
  ChatMessageRow: ({
    message,
    onReplyPrivately,
  }: {
    message: ChatRoomMessage;
    onReplyPrivately?: (message: ChatRoomMessage) => void;
  }) => (
    <div>{`row-${message.id}${onReplyPrivately ? " reply-privately" : ""}`}</div>
  ),
}));

vi.mock(
  "@/app/chat/components/transcript-viewport",
  () => import("./transcript-viewport-stub"),
);

function parentMessage(
  overrides: Partial<ChatRoomMessage> = {},
): ChatRoomMessage {
  return {
    id: "parent-1",
    roomId: "room-1",
    parentMessageId: null,
    content: "Parent",
    createdAt: new Date("2026-07-01T14:35:00.000Z"),
    editedAt: null,
    pinnedAt: null,
    deletedAt: null,
    mentions: [],
    reactions: [],
    threadReplyCount: 3,
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
    ...overrides,
  };
}

describe("ThreadPanel Reply privately", () => {
  it("offers it only on replies whose author the room can still quote to", async () => {
    const stayed = parentMessage({
      id: "r-stayed",
      parentMessageId: "parent-1",
    });
    const left = parentMessage({
      id: "r-left",
      parentMessageId: "parent-1",
      sender: {
        type: "user",
        user: {
          id: "user-gone",
          name: "Former",
          email: "former@example.com",
          image: null,
          presence: "offline",
        },
      },
    });
    await act(async () =>
      render(
        <ThreadPanel
          parentMessage={parentMessage()}
          replies={[stayed, left]}
          isLoading={false}
          olderNextCursor={null}
          onLoadOlder={() => undefined}
          coworkersById={new Map()}
          coworkersBySlug={new Map()}
          mentionRecords={{}}
          draftKey="thread:parent-1"
          onSendReply={async () => ({ ok: true })}
          isSendingReply={false}
          onClose={() => undefined}
          onToggleReaction={() => undefined}
          roomId="room-1"
          onReplyPrivately={vi.fn()}
          canReplyPrivately={(message) =>
            message.sender.type === "user" &&
            message.sender.user.id !== "user-gone"
          }
        />,
      ),
    );

    expect(screen.getByText("row-r-stayed reply-privately")).toBeTruthy();
    expect(screen.getByText("row-r-left")).toBeTruthy();
  });
});
