import { render, screen } from "@testing-library/react";
import type { ReactNode, Ref } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import type { RoomComposerHandle } from "../room-composer";
import { ThreadPanel } from "../thread-panel";

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
  ChatMessageRow: ({ message }: { message: ChatRoomMessage }) => (
    <div>{`row-${message.id}`}</div>
  ),
}));

vi.mock("@/app/chat/hooks/use-stick-to-bottom", () => ({
  useStickToBottom: () => ({
    scrollerRef: { current: null },
    contentRef: { current: null },
    contentMinHeight: null,
    pinToBottomAfterOwnSend: () => undefined,
    scrollToBottomIfPinned: () => undefined,
  }),
}));

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
    deletedAt: null,
    mentions: [],
    reactions: [],
    threadReplyCount: 3,
    threadLastReplyAt: null,
    metadata: null,
    quote: null,
    membership: null,
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

function renderPanel(options: {
  isLoading: boolean;
  replies?: ChatRoomMessage[];
}) {
  return render(
    <ThreadPanel
      parentMessage={parentMessage()}
      replies={options.replies ?? []}
      isLoading={options.isLoading}
      olderNextCursor={null}
      isLoadingOlder={false}
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
    />,
  );
}

describe("ThreadPanel empty vs loading", () => {
  it("shows loading, not empty, while replies are still fetching", () => {
    // Regression: open thread used to paint "No replies yet" before the
    // fetch transition started (await mark-read first cleared messages with
    // isLoading still false). Loading must suppress empty.
    renderPanel({ isLoading: true, replies: [] });

    expect(screen.getByText("Thread.loading")).toBeTruthy();
    expect(screen.queryByText("Thread.empty")).toBeNull();
  });

  it("shows empty only after load settles with zero replies", () => {
    renderPanel({
      isLoading: false,
      replies: [],
    });

    expect(screen.getByText("Thread.empty")).toBeTruthy();
    expect(screen.queryByText("Thread.loading")).toBeNull();
  });
});
