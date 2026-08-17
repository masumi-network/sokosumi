import { act, render, screen } from "@testing-library/react";
import { type ReactNode, type Ref, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import type { RoomComposerHandle } from "../room-composer";
import { ThreadPanel } from "../thread-panel";

type ResizeObserverCallback = (
  entries: ResizeObserverEntry[],
  observer: ResizeObserver,
) => void;

const observerCallbacks = new Set<ResizeObserverCallback>();

class ResizeObserverMock {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    observerCallbacks.add(callback);
  }

  observe(_target: Element) {}

  disconnect() {
    observerCallbacks.delete(this.callback);
  }

  unobserve() {}
}

function fireResize() {
  for (const callback of observerCallbacks) {
    callback([], {} as ResizeObserver);
  }
}

function setScrollerMetrics(
  el: HTMLElement,
  {
    scrollHeight,
    clientHeight,
    scrollTop,
  }: {
    scrollHeight: number;
    clientHeight: number;
    scrollTop: number;
  },
) {
  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    get: () => scrollHeight,
  });
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    get: () => clientHeight,
  });
  el.scrollTop = scrollTop;
}

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

function getThreadScroller(container: HTMLElement): HTMLElement {
  const scroller = container.querySelector(".overflow-y-auto");
  if (!(scroller instanceof HTMLElement)) {
    throw new Error("Expected thread message-list overflow scroller");
  }
  return scroller;
}

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
  const view = render(
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
  return { ...view, scroller: getThreadScroller(view.container) };
}

describe("ThreadPanel stick-to-bottom", () => {
  beforeEach(() => {
    observerCallbacks.clear();
    global.ResizeObserver =
      ResizeObserverMock as unknown as typeof global.ResizeObserver;
  });

  afterEach(() => {
    observerCallbacks.clear();
  });

  it("pins the thread viewport when content grows while sticky", () => {
    const { scroller } = renderThreadPanel();
    setScrollerMetrics(scroller, {
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 600,
    });

    act(() => {
      fireResize();
    });

    expect(scroller.scrollTop).toBe(1000);
  });

  it("does not pin after the user scrolls away from the bottom", () => {
    const { scroller } = renderThreadPanel();
    setScrollerMetrics(scroller, {
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 600,
    });
    act(() => {
      fireResize();
    });

    setScrollerMetrics(scroller, {
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 200,
    });
    act(() => {
      scroller.dispatchEvent(new Event("scroll"));
    });

    const scrollTopBefore = scroller.scrollTop;
    setScrollerMetrics(scroller, {
      scrollHeight: 1400,
      clientHeight: 400,
      scrollTop: scrollTopBefore,
    });
    act(() => {
      fireResize();
    });

    expect(scroller.scrollTop).toBe(scrollTopBefore);
  });

  it("scrollToBottomIfPinned no-ops on chrome resize when unpinned", () => {
    const { scroller } = renderThreadPanel();
    setScrollerMetrics(scroller, {
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 50,
    });
    act(() => {
      scroller.dispatchEvent(new Event("scroll"));
    });

    act(() => {
      screen.getByTestId("chrome-resize").click();
    });

    expect(scroller.scrollTop).toBe(50);
  });

  it("re-pins to bottom after a successful send even when previously unpinned", async () => {
    const { scroller } = renderThreadPanel();
    setScrollerMetrics(scroller, {
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 50,
    });
    act(() => {
      scroller.dispatchEvent(new Event("scroll"));
    });

    setScrollerMetrics(scroller, {
      scrollHeight: 1300,
      clientHeight: 400,
      scrollTop: 50,
    });

    await act(async () => {
      screen.getByTestId("send-reply").click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(scroller.scrollTop).toBe(1300);
  });
});
