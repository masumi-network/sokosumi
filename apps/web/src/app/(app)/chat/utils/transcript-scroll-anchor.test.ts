import { afterEach, describe, expect, it } from "vitest";

import {
  CHAT_MESSAGE_LIST_ATTRIBUTE,
  CHAT_MESSAGE_LIST_ROOM,
} from "@/app/chat/chat-message-list";

import {
  captureTranscriptScrollAnchor,
  captureVisibleTranscriptScrollAnchor,
  restoreTranscriptScrollAnchor,
} from "./transcript-scroll-anchor";

function scrollerWithRow(rowTop: number): {
  scroller: HTMLElement;
  row: HTMLElement;
} {
  const scroller = document.createElement("div");
  scroller.getBoundingClientRect = () => ({ top: 100, bottom: 400 }) as DOMRect;
  const list = document.createElement("div");
  list.setAttribute(CHAT_MESSAGE_LIST_ATTRIBUTE, CHAT_MESSAGE_LIST_ROOM);
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
): HTMLElement {
  const scroller = document.createElement("div");
  scroller.getBoundingClientRect = () => ({ top: 100, bottom: 400 }) as DOMRect;
  const list = document.createElement("div");
  list.setAttribute(CHAT_MESSAGE_LIST_ATTRIBUTE, CHAT_MESSAGE_LIST_ROOM);
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
  it("scrolls by however far the row moved after rows were inserted above it", () => {
    const { scroller, row } = scrollerWithRow(140);
    scroller.scrollTop = 500;

    const anchor = captureTranscriptScrollAnchor(scroller, "msg-9");
    expect(anchor).toEqual({ messageId: "msg-9", offset: 40 });

    row.getBoundingClientRect = () => ({ top: 940 }) as DOMRect;
    restoreTranscriptScrollAnchor(
      scroller,
      anchor as NonNullable<typeof anchor>,
    );

    expect(scroller.scrollTop).toBe(1300);
  });

  it("leaves the scroller alone when the row did not move", () => {
    const { scroller } = scrollerWithRow(140);
    scroller.scrollTop = 500;

    const anchor = captureTranscriptScrollAnchor(scroller, "msg-9");
    restoreTranscriptScrollAnchor(
      scroller,
      anchor as NonNullable<typeof anchor>,
    );

    expect(scroller.scrollTop).toBe(500);
  });

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

  it("captures nothing when every row sits outside the viewport", () => {
    const scroller = scrollerWithRows([{ id: "msg-50", top: 40, height: 20 }]);

    expect(captureVisibleTranscriptScrollAnchor(scroller)).toBeNull();
  });
});
