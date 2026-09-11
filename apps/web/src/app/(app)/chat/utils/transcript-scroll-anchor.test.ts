import { afterEach, describe, expect, it } from "vitest";

import {
  CHAT_MESSAGE_LIST_ATTRIBUTE,
  CHAT_MESSAGE_LIST_ROOM,
} from "@/app/chat/chat-message-list";

import {
  captureTranscriptScrollAnchor,
  restoreTranscriptScrollAnchor,
} from "./transcript-scroll-anchor";

function scrollerWithRow(rowTop: number): {
  scroller: HTMLElement;
  row: HTMLElement;
} {
  const scroller = document.createElement("div");
  scroller.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
  const list = document.createElement("div");
  list.setAttribute(CHAT_MESSAGE_LIST_ATTRIBUTE, CHAT_MESSAGE_LIST_ROOM);
  const row = document.createElement("article");
  row.setAttribute("data-message-id", "msg-9");
  row.getBoundingClientRect = () => ({ top: rowTop }) as DOMRect;
  list.append(row);
  scroller.append(list);
  document.body.append(scroller);
  return { scroller, row };
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
});
