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
  ROOM_MESSAGE_HIGHLIGHT_FULL_STRENGTH_SHARE,
  ROOM_MESSAGE_HIGHLIGHT_LEAVE_MS,
  ROOM_MESSAGE_HIGHLIGHT_MS,
  ROOM_MESSAGE_HIGHLIGHT_OPEN_SHARE,
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

/**
 * The scroller the list sits in, as both the room and the thread render it:
 * the list is the scroller's one child.
 */
function scrollerAround(list: string = CHAT_MESSAGE_LIST_ROOM): HTMLElement {
  const container = document.querySelector(
    `[data-chat-message-list="${list}"]`,
  );
  if (!container) {
    throw new Error(`no ${list} list`);
  }
  const scroller = document.createElement("div");
  container.replaceWith(scroller);
  scroller.append(container);
  return scroller;
}

/** A reader turning the wheel over a row. Neither event bubbles to the list. */
function wheelOver(element: HTMLElement): void {
  element.dispatchEvent(new Event("wheel"));
}

function touchDragOver(element: HTMLElement): void {
  element.dispatchEvent(new Event("touchmove"));
}

describe("room message highlight", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.restoreAllMocks();
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

  it("fades the mark out when the reader wheels over the list", () => {
    vi.useFakeTimers();
    const article = row("msg-50");

    highlightRoomTranscriptMessage("msg-50");
    vi.advanceTimersByTime(
      Math.ceil(ROOM_MESSAGE_HIGHLIGHT_MS * ROOM_MESSAGE_HIGHLIGHT_OPEN_SHARE),
    );
    wheelOver(article);

    // Still on the row, and saying so, while globals.css fades it.
    expect(article.dataset.searchLanded).toBe("leaving");

    vi.advanceTimersByTime(ROOM_MESSAGE_HIGHLIGHT_LEAVE_MS - 1);
    expect(article.dataset.searchLanded).toBe("leaving");

    vi.advanceTimersByTime(1);
    expect(article.dataset.searchLanded).toBeUndefined();
  });

  it("fades the mark out when the reader drags the list by touch", () => {
    vi.useFakeTimers();
    const article = row("msg-51");

    highlightRoomTranscriptMessage("msg-51");
    vi.advanceTimersByTime(
      Math.ceil(ROOM_MESSAGE_HIGHLIGHT_MS * ROOM_MESSAGE_HIGHLIGHT_OPEN_SHARE),
    );
    touchDragOver(article);

    expect(article.dataset.searchLanded).toBe("leaving");
  });

  /**
   * The hold fades the mark out on its own over its last stretch. A scroll
   * there must not hand it to the leave fade, which starts at full strength:
   * the row would light back up and go out a second time.
   */
  it("drops the mark outright when the hold is already fading it", () => {
    vi.useFakeTimers();
    const article = row("msg-57");

    highlightRoomTranscriptMessage("msg-57");
    vi.advanceTimersByTime(
      Math.ceil(
        ROOM_MESSAGE_HIGHLIGHT_MS * ROOM_MESSAGE_HIGHLIGHT_FULL_STRENGTH_SHARE,
      ),
    );
    wheelOver(article);

    expect(article.dataset.searchLanded).toBeUndefined();
  });

  /**
   * The hold opens the mark over its first stretch. A scroll there must not
   * hand it to the leave fade either: the fade opens at full strength, so a
   * mark still on its way in would jump to full and then go out.
   */
  it("drops the mark outright when the hold is still opening it", () => {
    vi.useFakeTimers();
    const article = row("msg-59");

    highlightRoomTranscriptMessage("msg-59");
    vi.advanceTimersByTime(
      Math.floor(
        ROOM_MESSAGE_HIGHLIGHT_MS * ROOM_MESSAGE_HIGHLIGHT_OPEN_SHARE,
      ) - 1,
    );
    wheelOver(article);

    expect(article.dataset.searchLanded).toBeUndefined();
  });

  it("fades the mark out once the hold has it at full strength", () => {
    vi.useFakeTimers();
    const article = row("msg-60");

    highlightRoomTranscriptMessage("msg-60");
    vi.advanceTimersByTime(
      Math.ceil(ROOM_MESSAGE_HIGHLIGHT_MS * ROOM_MESSAGE_HIGHLIGHT_OPEN_SHARE),
    );
    wheelOver(article);

    expect(article.dataset.searchLanded).toBe("leaving");
  });

  /**
   * The fade runs on one clock. A second wheel inside it must not restart the
   * fade, or a reader who keeps scrolling holds the mark on the row.
   */
  it("keeps one fade when the reader goes on scrolling", () => {
    vi.useFakeTimers();
    const article = row("msg-58");

    highlightRoomTranscriptMessage("msg-58");
    vi.advanceTimersByTime(
      Math.ceil(ROOM_MESSAGE_HIGHLIGHT_MS * ROOM_MESSAGE_HIGHLIGHT_OPEN_SHARE),
    );
    wheelOver(article);
    vi.advanceTimersByTime(ROOM_MESSAGE_HIGHLIGHT_LEAVE_MS - 1);
    wheelOver(article);

    vi.advanceTimersByTime(1);
    expect(article.dataset.searchLanded).toBeUndefined();
  });

  /**
   * The jump scrolls the list itself, and the virtualizer writes the scroll
   * again for as long as the rows around the landing are still measuring.
   * Both raise a scroll event the reader's own cannot be told apart from, so
   * the watch reads the reader's input instead and lets scroll events pass.
   */
  it("holds the mark through the scrolling the jump itself causes", () => {
    const article = row("msg-52");
    const scroller = scrollerAround();

    highlightRoomTranscriptMessage("msg-52");
    scroller.dispatchEvent(new Event("scroll"));
    article.dispatchEvent(new Event("scroll"));

    expect(article.dataset.searchLanded).toBe("true");
  });

  /**
   * A thread jump marks a row in each list. The reader scrolling one says
   * nothing about the other, which sits in its own scroller. Both lists share
   * ancestors that scroll, so the watch has to read the list the event came
   * from rather than any ancestor holding the marked row.
   */
  it("leaves the other list's mark alone when one list scrolls", () => {
    vi.useFakeTimers();
    const parent = row("msg-53", CHAT_MESSAGE_LIST_ROOM);
    const reply = row("msg-54", CHAT_MESSAGE_LIST_THREAD);

    highlightRoomTranscriptMessage("msg-53");
    highlightThreadMessage("msg-54");
    vi.advanceTimersByTime(
      Math.ceil(ROOM_MESSAGE_HIGHLIGHT_MS * ROOM_MESSAGE_HIGHLIGHT_OPEN_SHARE),
    );
    wheelOver(reply);

    expect(reply.dataset.searchLanded).toBe("leaving");
    expect(parent.dataset.searchLanded).toBe("true");
  });

  /**
   * A page-level scroll targets the document, which holds every list. Reading
   * it as a scroll of the landed list would clear a mark the reader never
   * scrolled past.
   */
  it("ignores a wheel outside the list that holds the mark", () => {
    const article = row("msg-55");
    scrollerAround();

    highlightRoomTranscriptMessage("msg-55");
    document.dispatchEvent(new Event("wheel"));
    document.body.dispatchEvent(new Event("wheel"));

    expect(article.dataset.searchLanded).toBe("true");
  });

  /**
   * A capture listener is only removed by a call that says `capture` too, so
   * a removal that drops the flag leaves the watch on the window for good.
   * Nothing the marked row does afterwards shows that: the map entry is gone,
   * so the stale watch finds nothing to clear and reads as clean.
   */
  it("removes the watch with the capture flag it was added with", () => {
    vi.useFakeTimers();
    const added = vi.spyOn(window, "addEventListener");
    const removed = vi.spyOn(window, "removeEventListener");
    row("msg-56");

    highlightRoomTranscriptMessage("msg-56");
    vi.advanceTimersByTime(ROOM_MESSAGE_HIGHLIGHT_MS);

    const watched = added.mock.calls.filter(
      ([type]) => type === "wheel" || type === "touchmove",
    );
    expect(watched).toHaveLength(2);
    for (const [type, handler, options] of watched) {
      expect(options).toMatchObject({ capture: true });
      expect(removed).toHaveBeenCalledWith(type, handler, { capture: true });
    }
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

  it("fades for as long as the stylesheet draws the fade", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/app/globals.css"),
      "utf8",
    );

    const declared = [...css.matchAll(/--chat-jump-leave:\s*(\S+?);/g)];

    expect(declared.map((match) => match[1])).toEqual([
      `${ROOM_MESSAGE_HIGHLIGHT_LEAVE_MS}ms`,
    ]);
  });

  /**
   * Where the hold opens the mark and where it starts dropping it again. The
   * two shares decide whether a scroll fades the mark or ends it, so they have
   * to name the stops the stylesheet actually runs — in every keyframe the
   * hold drives, not only the one the wash uses.
   */
  it("reads its stretch from the stylesheet", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/app/globals.css"),
      "utf8",
    );
    const stopsOf = (name: string) => {
      const opens = css.indexOf(`@keyframes ${name} {`);
      const block = css.slice(opens, css.indexOf("\n}", opens));
      return [...block.matchAll(/(\d+)%\s*{/g)].map((match) => match[1]);
    };

    for (const name of ["chat-jump-wash", "chat-jump-rail", "chat-jump-dim"]) {
      expect([name, stopsOf(name)]).toEqual([
        name,
        [
          "0",
          `${ROOM_MESSAGE_HIGHLIGHT_OPEN_SHARE * 100}`,
          `${ROOM_MESSAGE_HIGHLIGHT_FULL_STRENGTH_SHARE * 100}`,
          "100",
        ],
      ]);
    }
  });

  /**
   * The fade itself is drawn from the leaving mark. Nothing else in this suite
   * can see the stylesheet, so without this the rules could go and every test
   * here would still pass while the mark went back to being cut.
   */
  it("draws the leaving mark from the stylesheet", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/app/globals.css"),
      "utf8",
    );

    // The mark on its way out, and the rows coming back out of the spotlight.
    expect(css).toContain(
      '[data-message-id][data-search-landed="leaving"]::before',
    );
    expect(css).toContain(
      '[data-chat-message-list]:has([data-search-landed="leaving"])',
    );
    expect(css).toContain(
      "animation: chat-jump-leave var(--chat-jump-leave) ease-out forwards",
    );
    expect(css).toContain(
      "animation: chat-jump-undim var(--chat-jump-leave) ease-out forwards",
    );
  });
});
