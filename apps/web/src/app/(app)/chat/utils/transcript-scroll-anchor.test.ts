import { afterEach, describe, expect, it } from "vitest";

import {
  CHAT_MESSAGE_LIST_ATTRIBUTE,
  CHAT_MESSAGE_LIST_ROOM,
  CHAT_MESSAGE_LIST_THREAD,
} from "@/app/chat/chat-message-list";

import {
  captureTranscriptScrollAnchor,
  captureVisibleTranscriptScrollAnchor,
} from "./transcript-scroll-anchor";

function scrollerWithRow(
  rowTop: number,
  listName: string = CHAT_MESSAGE_LIST_ROOM,
): {
  scroller: HTMLElement;
  row: HTMLElement;
} {
  const scroller = document.createElement("div");
  scroller.getBoundingClientRect = () => ({ top: 100, bottom: 400 }) as DOMRect;
  const list = document.createElement("div");
  list.setAttribute(CHAT_MESSAGE_LIST_ATTRIBUTE, listName);
  const row = document.createElement("article");
  row.setAttribute("data-message-id", "msg-9");
  row.getBoundingClientRect = () =>
    ({ top: rowTop, bottom: rowTop + 40 }) as DOMRect;
  list.append(row);
  scroller.append(list);
  document.body.append(scroller);
  return { scroller, row };
}

function scrollerWithRows(
  rows: Array<{ id: string; top: number; height?: number }>,
  listName: string = CHAT_MESSAGE_LIST_ROOM,
): HTMLElement {
  const scroller = document.createElement("div");
  scroller.getBoundingClientRect = () => ({ top: 100, bottom: 400 }) as DOMRect;
  const list = document.createElement("div");
  list.setAttribute(CHAT_MESSAGE_LIST_ATTRIBUTE, listName);
  for (const spec of rows) {
    const height = spec.height ?? 40;
    const row = document.createElement("article");
    row.setAttribute("data-message-id", spec.id);
    row.getBoundingClientRect = () =>
      ({ top: spec.top, bottom: spec.top + height }) as DOMRect;
    list.append(row);
  }
  scroller.append(list);
  document.body.append(scroller);
  return scroller;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("transcript scroll anchor", () => {
  it("captures nothing for a row the transcript has not rendered", () => {
    const { scroller } = scrollerWithRow(140);

    expect(captureTranscriptScrollAnchor(scroller, "msg-missing")).toBeNull();
  });

  it("holds the in-view jump row rather than the cursor below a gap", () => {
    const scroller = scrollerWithRows([
      { id: "msg-50", top: 120 },
      { id: "msg-90", top: 500 },
    ]);

    expect(captureVisibleTranscriptScrollAnchor(scroller)).toEqual({
      messageId: "msg-50",
      offset: 20,
    });
    expect(captureTranscriptScrollAnchor(scroller, "msg-90")).toEqual({
      messageId: "msg-90",
      offset: 400,
    });
  });

  it("prefers the first fully visible row over one straddling the top edge", () => {
    // The straddling row is held by its top, so an image landing inside it
    // would still push the rows below; the fully visible row can be put back.
    const scroller = scrollerWithRows([
      { id: "msg-40", top: 60, height: 100 },
      { id: "msg-41", top: 160 },
    ]);

    expect(captureVisibleTranscriptScrollAnchor(scroller)).toEqual({
      messageId: "msg-41",
      offset: 60,
    });
  });

  it("falls back to the straddling row when it fills the viewport alone", () => {
    const scroller = scrollerWithRows([
      { id: "msg-40", top: -100, height: 800 },
    ]);

    expect(captureVisibleTranscriptScrollAnchor(scroller)).toEqual({
      messageId: "msg-40",
      offset: -200,
    });
  });

  it("captures nothing when every row sits outside the viewport", () => {
    const scroller = scrollerWithRows([{ id: "msg-50", top: 40, height: 20 }]);

    expect(captureVisibleTranscriptScrollAnchor(scroller)).toBeNull();
  });

  it("anchors a thread list the same way as the room transcript", () => {
    const scroller = scrollerWithRows(
      [{ id: "msg-9", top: 140 }],
      CHAT_MESSAGE_LIST_THREAD,
    );

    expect(captureTranscriptScrollAnchor(scroller, "msg-9")).toEqual({
      messageId: "msg-9",
      offset: 40,
    });
    expect(captureVisibleTranscriptScrollAnchor(scroller)).toEqual({
      messageId: "msg-9",
      offset: 40,
    });
  });
});
