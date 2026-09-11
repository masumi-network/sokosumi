import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CHAT_MESSAGE_LIST_ROOM,
  CHAT_MESSAGE_LIST_THREAD,
} from "@/app/chat/chat-message-list";
import {
  highlightRoomTranscriptMessage,
  highlightThreadMessage,
  ROOM_MESSAGE_HIGHLIGHT_MS,
} from "@/app/chat/utils/room-message-highlight";

/** One container per list, as the room renders it: two rows, one list. */
function row(
  messageId: string,
  list: string = CHAT_MESSAGE_LIST_ROOM,
): HTMLElement {
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

describe("room message highlight", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("scrolls the landed message into view instantly and marks it", () => {
    const article = row("msg-1");

    expect(highlightRoomTranscriptMessage("msg-1")).toBe(true);

    expect(article.scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "center",
    });
    expect(article.dataset.searchLanded).toBe("true");
    // The mark is styled in globals.css from the attribute alone, so the
    // helper must not also mutate the class list.
    expect(article.className).toBe("");
  });

  it("reports false for a message that is not rendered", () => {
    expect(highlightRoomTranscriptMessage("msg-missing")).toBe(false);
  });

  /**
   * Two notifications for replies in one thread land on the same transcript
   * parent. The attribute leaves and returns inside one task, so without a
   * style recalc in between the wash and the rail carry on from where they
   * were and the second landing shows the reader nothing.
   */
  it("reads layout while the row is unmarked, so a second landing shows", () => {
    const article = row("msg-40");
    const rect = article.getBoundingClientRect();
    const markWhenRead: (string | undefined)[] = [];
    vi.spyOn(article, "getBoundingClientRect").mockImplementation(() => {
      markWhenRead.push(article.dataset.searchLanded);
      return rect;
    });

    highlightRoomTranscriptMessage("msg-40");
    highlightRoomTranscriptMessage("msg-40");

    expect(markWhenRead).toEqual([undefined, undefined]);
    expect(article.dataset.searchLanded).toBe("true");
  });

  it("drops the mark when the hold ends", () => {
    vi.useFakeTimers();
    const article = row("msg-3");

    highlightRoomTranscriptMessage("msg-3");
    expect(article.dataset.searchLanded).toBe("true");

    vi.advanceTimersByTime(ROOM_MESSAGE_HIGHLIGHT_MS - 1);
    expect(article.dataset.searchLanded).toBe("true");

    vi.advanceTimersByTime(1);
    expect(article.dataset.searchLanded).toBeUndefined();
  });

  it("keeps one mark per list when a second jump lands inside the hold", () => {
    vi.useFakeTimers();
    const first = row("msg-4", CHAT_MESSAGE_LIST_ROOM);
    const second = row("msg-5", CHAT_MESSAGE_LIST_ROOM);

    highlightRoomTranscriptMessage("msg-4");
    vi.advanceTimersByTime(1000);
    highlightRoomTranscriptMessage("msg-5");

    expect(first.dataset.searchLanded).toBeUndefined();
    expect(second.dataset.searchLanded).toBe("true");

    // The first jump's mark must not take the second one with it when its own
    // hold would have ended.
    vi.advanceTimersByTime(ROOM_MESSAGE_HIGHLIGHT_MS - 1);
    expect(second.dataset.searchLanded).toBe("true");

    vi.advanceTimersByTime(1);
    expect(second.dataset.searchLanded).toBeUndefined();
  });

  /**
   * A reply's parent is rendered twice while its thread is open: once in the
   * transcript and once at the head of the panel. An unscoped lookup takes
   * whichever comes first in the document, which would scroll the panel and
   * leave the transcript where it was.
   */
  it("lands on the transcript copy of a parent and not on the thread's", () => {
    const thread = row("msg-10", CHAT_MESSAGE_LIST_THREAD);
    const room = row("msg-10", CHAT_MESSAGE_LIST_ROOM);

    expect(highlightRoomTranscriptMessage("msg-10")).toBe(true);

    expect(room.scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "center",
    });
    expect(room.dataset.searchLanded).toBe("true");
    expect(thread.scrollIntoView).not.toHaveBeenCalled();
    expect(thread.dataset.searchLanded).toBeUndefined();
  });

  it("reports false for a parent the transcript has not loaded", () => {
    row("msg-12", CHAT_MESSAGE_LIST_ROOM);

    expect(highlightRoomTranscriptMessage("msg-13")).toBe(false);
  });

  /**
   * Both lists render a thread's parent. Each function answers for its own
   * list, so which copy a jump lands on never rests on where the panel sits in
   * the document.
   */
  it("keeps the two copies of a parent apart", () => {
    const thread = row("msg-30", CHAT_MESSAGE_LIST_THREAD);
    const room = row("msg-30", CHAT_MESSAGE_LIST_ROOM);

    expect(highlightRoomTranscriptMessage("msg-30")).toBe(true);
    expect(room.dataset.searchLanded).toBe("true");
    expect(thread.dataset.searchLanded).toBeUndefined();

    expect(highlightThreadMessage("msg-30")).toBe(true);
    expect(thread.dataset.searchLanded).toBe("true");
  });

  it("reports false for a reply the thread has not loaded", () => {
    row("msg-31", CHAT_MESSAGE_LIST_THREAD);

    expect(highlightThreadMessage("msg-32")).toBe(false);
  });

  /**
   * The whole point of keying the marks by list: a thread jump marks the reply
   * in the panel and the message its thread hangs off in the transcript, and
   * the reader sees both at once.
   */
  it("holds the reply mark and the parent mark at the same time", () => {
    const parent = row("msg-20", CHAT_MESSAGE_LIST_ROOM);
    const reply = row("msg-21", CHAT_MESSAGE_LIST_THREAD);

    highlightThreadMessage("msg-21");
    highlightRoomTranscriptMessage("msg-20");

    expect(reply.dataset.searchLanded).toBe("true");
    expect(parent.dataset.searchLanded).toBe("true");
  });

  /**
   * The hold is written down twice: here, as the timer that removes the
   * attribute, and in globals.css, as the animation that draws the mark and
   * steps the other rows back. A drift between them either wipes the mark
   * mid-animation or leaves the row marked with nothing to see.
   */
  it("holds for as long as the stylesheet draws the mark", () => {
    // Vitest runs this suite with apps/web as the working directory.
    const css = readFileSync(
      resolve(process.cwd(), "src/app/globals.css"),
      "utf8",
    );

    // Every definition, so a second one added later cannot shadow the one the
    // mark reads and leave this passing on a value nothing uses.
    const declared = [...css.matchAll(/--chat-jump-hold:\s*(\S+?);/g)];

    expect(declared.map((match) => match[1])).toEqual([
      `${ROOM_MESSAGE_HIGHLIGHT_MS}ms`,
    ]);
  });
});
