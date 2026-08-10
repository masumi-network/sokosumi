import { act, fireEvent, render } from "@testing-library/react";
import { type ReactNode, type Ref, useImperativeHandle } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import type { RoomComposerHandle } from "../room-composer";
import type { PendingRoomQuote } from "../room-helpers";
import { ThreadPanel } from "../thread-panel";

const composerFocus = vi.hoisted(() => vi.fn());

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
  RoomSessionComposer: ({ ref }: { ref?: Ref<RoomComposerHandle> }) => {
    useImperativeHandle(ref, () => ({
      attachFiles: () => undefined,
      focus: () => {
        composerFocus();
      },
    }));
    return <div data-testid="thread-composer" />;
  },
}));

vi.mock("../room-message-row", () => ({
  ChatMessageRow: ({
    message,
    onQuote,
  }: {
    message: ChatRoomMessage;
    onQuote?: (message: ChatRoomMessage) => void;
  }) => (
    <button type="button" onClick={() => onQuote?.(message)}>
      {`quote-${message.id}`}
    </button>
  ),
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
    threadReplyCount: 1,
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

function renderThreadPanel(
  overrides: {
    onQuote?: (message: ChatRoomMessage) => void;
    onRestorePendingQuote?: (quote: PendingRoomQuote) => void;
  } = {},
) {
  return render(
    <ThreadPanel
      parentMessage={parentMessage()}
      replies={[]}
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
      onQuote={overrides.onQuote}
      onRestorePendingQuote={overrides.onRestorePendingQuote}
      roomId="room-1"
    />,
  );
}

async function flushAnimationFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  });
}

describe("ThreadPanel composer focus", () => {
  it("calls onQuote and focuses the thread composer after rAF", async () => {
    composerFocus.mockClear();
    const onQuote = vi.fn();
    const { getByRole } = renderThreadPanel({ onQuote });

    const message = parentMessage();
    fireEvent.click(getByRole("button", { name: `quote-${message.id}` }));

    expect(onQuote).toHaveBeenCalledTimes(1);
    expect(onQuote).toHaveBeenCalledWith(
      expect.objectContaining({ id: message.id }),
    );
    expect(composerFocus).not.toHaveBeenCalled();

    await flushAnimationFrame();
    expect(composerFocus).toHaveBeenCalledTimes(1);
  });

  it("does not focus when onRestorePendingQuote runs", async () => {
    composerFocus.mockClear();
    const onRestorePendingQuote = vi.fn();
    renderThreadPanel({ onRestorePendingQuote });

    onRestorePendingQuote({
      messageId: "quoted-1",
      authorName: "Ada",
      snippet: "quoted",
      attachment: null,
    });

    await flushAnimationFrame();
    expect(composerFocus).not.toHaveBeenCalled();
  });
});
