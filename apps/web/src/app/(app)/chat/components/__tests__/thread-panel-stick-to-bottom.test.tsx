import { act, render, screen } from "@testing-library/react";
import { type ReactNode, type Ref, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import type { RoomComposerHandle } from "../room-composer";
import { ThreadPanel } from "../thread-panel";
import { transcriptViewportSpies } from "./transcript-viewport-stub";

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
  RoomSessionComposer: ({
    ref,
    onChromeResize,
    onSend,
  }: {
    ref?: Ref<RoomComposerHandle>;
    onChromeResize?: () => void;
    onSend?: () => Promise<{ ok: boolean }>;
  }) => {
    useImperativeHandle(ref, () => ({
      attachFiles: () => undefined,
      focus: () => undefined,
    }));
    return (
      <>
        <button
          type="button"
          data-testid="chrome-resize"
          onClick={onChromeResize}
        >
          chrome-resize
        </button>
        <button
          type="button"
          data-testid="send-reply"
          onClick={() => {
            void onSend?.();
          }}
        >
          send-reply
        </button>
      </>
    );
  },
}));

vi.mock("../room-message-row", () => ({
  ChatMessageRow: ({ message }: { message: ChatRoomMessage }) => (
    <div>{message.content}</div>
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
    deletedAt: null,
    mentions: [],
    reactions: [],
    threadReplyCount: 2,
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

function replyMessage(id: string): ChatRoomMessage {
  return parentMessage({
    id,
    parentMessageId: "parent-1",
    content: `Reply ${id}`,
    threadReplyCount: 0,
  });
}

function renderThreadPanel(replies: ChatRoomMessage[] = [replyMessage("r1")]) {
  return render(
    <ThreadPanel
      parentMessage={parentMessage()}
      replies={replies}
      isLoading={false}
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

describe("ThreadPanel transcript viewport", () => {
  beforeEach(() => {
    transcriptViewportSpies.pinToBottomAfterOwnSend.mockClear();
    transcriptViewportSpies.scrollToBottomIfPinned.mockClear();
  });

  it("opens the thread on the viewport contract (stub mounts every row)", () => {
    renderThreadPanel([replyMessage("r1"), replyMessage("r2")]);

    expect(screen.getByText("Parent")).toBeTruthy();
    expect(screen.getByText("Reply r1")).toBeTruthy();
    expect(screen.getByText("Reply r2")).toBeTruthy();
  });

  it("asks the viewport to follow chrome resize when pinned", () => {
    renderThreadPanel();

    act(() => {
      screen.getByTestId("chrome-resize").click();
    });

    expect(transcriptViewportSpies.scrollToBottomIfPinned).toHaveBeenCalled();
  });

  it("re-pins to the live edge after a successful send", async () => {
    renderThreadPanel();

    await act(async () => {
      screen.getByTestId("send-reply").click();
    });

    expect(transcriptViewportSpies.pinToBottomAfterOwnSend).toHaveBeenCalled();
  });
});
