import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode, Ref } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    <div>{message.content}</div>
  ),
}));

vi.mock(
  "@/app/chat/components/transcript-viewport",
  () => import("./transcript-viewport-stub"),
);

type ObserverCallback = (entries: Array<{ isIntersecting: boolean }>) => void;

const observers: Array<{
  callback: ObserverCallback;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}> = [];

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(callback: ObserverCallback) {
        observers.push({
          callback,
          observe: this.observe,
          disconnect: this.disconnect,
        });
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function parentMessage(): ChatRoomMessage {
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
  };
}

function replyMessage(): ChatRoomMessage {
  return {
    ...parentMessage(),
    id: "r1",
    parentMessageId: "parent-1",
    content: "Reply r1",
    threadReplyCount: 0,
  };
}

function renderThreadPanel(
  olderLoadStatus: "idle" | "loading" | "failed",
  onLoadOlder: () => void,
) {
  return render(
    <ThreadPanel
      parentMessage={parentMessage()}
      replies={[replyMessage()]}
      isLoading={false}
      olderNextCursor="cursor-1"
      olderLoadStatus={olderLoadStatus}
      onLoadOlder={onLoadOlder}
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

describe("ThreadPanel older boundary", () => {
  it("does not auto-load after a failed older page until the reader retries", () => {
    const onLoadOlder = vi.fn();
    renderThreadPanel("failed", onLoadOlder);

    expect(observers).toHaveLength(0);
    expect(screen.getByRole("alert")).toHaveTextContent("Boundary.loadFailed");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Boundary.loadFailed Boundary.retry",
      }),
    );

    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });

  it("auto-loads while idle when the older boundary scrolls into view", () => {
    const onLoadOlder = vi.fn();
    renderThreadPanel("idle", onLoadOlder);

    expect(observers).toHaveLength(1);
    observers[0]?.callback([{ isIntersecting: true }]);

    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });
});
