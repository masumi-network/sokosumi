import { render } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CHAT_MESSAGE_LIST_ROOM,
  CHAT_MESSAGE_LIST_THREAD,
} from "@/app/chat/chat-message-list";
import {
  clearListHighlight,
  highlightListMessage,
  ROOM_MESSAGE_HIGHLIGHT_MS,
} from "@/app/chat/utils/room-message-highlight";
import { useListHighlightCleanup } from "./use-list-highlight-cleanup";

function mountRow(messageId: string, list: string): HTMLElement {
  const article = document.createElement("article");
  article.setAttribute("data-message-id", messageId);
  article.scrollIntoView = vi.fn();
  const container =
    document.querySelector(`[data-chat-message-list="${list}"]`) ??
    document.body.appendChild(document.createElement("div"));
  container.setAttribute("data-chat-message-list", list);
  container.append(article);
  return article;
}

function Probe({ list }: { list: string }) {
  useListHighlightCleanup(list);
  return null;
}

describe("useListHighlightCleanup", () => {
  afterEach(() => {
    clearListHighlight(CHAT_MESSAGE_LIST_ROOM);
    clearListHighlight(CHAT_MESSAGE_LIST_THREAD);
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("clears the list highlight, scroll listeners, and timer on unmount without touching other lists", () => {
    vi.useFakeTimers();
    const removed = vi.spyOn(window, "removeEventListener");
    const roomRow = mountRow("msg-room", CHAT_MESSAGE_LIST_ROOM);
    const threadRow = mountRow("msg-thread", CHAT_MESSAGE_LIST_THREAD);

    const { unmount } = render(<Probe list={CHAT_MESSAGE_LIST_ROOM} />);
    highlightListMessage(CHAT_MESSAGE_LIST_ROOM, "msg-room");
    highlightListMessage(CHAT_MESSAGE_LIST_THREAD, "msg-thread");

    unmount();

    expect(roomRow.dataset.searchLanded).toBeUndefined();
    expect(threadRow.dataset.searchLanded).toBe("true");
    expect(removed).toHaveBeenCalledWith("wheel", expect.any(Function), {
      capture: true,
    });
    expect(removed).toHaveBeenCalledWith("touchmove", expect.any(Function), {
      capture: true,
    });

    // Clear the remaining thread highlight and confirm no timer still needs window.
    clearListHighlight(CHAT_MESSAGE_LIST_THREAD);
    const originalWindow = globalThis.window;
    // @ts-expect-error simulates happy-dom teardown deleting window.
    delete globalThis.window;
    try {
      vi.advanceTimersByTime(ROOM_MESSAGE_HIGHLIGHT_MS + 100);
    } finally {
      globalThis.window = originalWindow;
    }
  });

  it("clears the previous list on list change and on Activity hide under StrictMode", () => {
    vi.useFakeTimers();
    const roomRow = mountRow("msg-room", CHAT_MESSAGE_LIST_ROOM);
    const threadRow = mountRow("msg-thread", CHAT_MESSAGE_LIST_THREAD);

    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <Probe list={CHAT_MESSAGE_LIST_ROOM} />
        </Activity>
      </StrictMode>,
    );

    highlightListMessage(CHAT_MESSAGE_LIST_ROOM, "msg-room");
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe list={CHAT_MESSAGE_LIST_THREAD} />
        </Activity>
      </StrictMode>,
    );
    expect(roomRow.dataset.searchLanded).toBeUndefined();

    highlightListMessage(CHAT_MESSAGE_LIST_THREAD, "msg-thread");
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe list={CHAT_MESSAGE_LIST_THREAD} />
        </Activity>
      </StrictMode>,
    );
    expect(threadRow.dataset.searchLanded).toBeUndefined();

    unmount();
  });
});
