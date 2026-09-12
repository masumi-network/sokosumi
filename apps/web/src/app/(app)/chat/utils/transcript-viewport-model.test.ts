import { describe, expect, it } from "vitest";

import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import { createPendingRoomMessage } from "./outbound-room-message";
import type { RoomTranscriptRow } from "./room-transcript-ranges";
import {
  findTranscriptRowIndex,
  firstItemIndexAfterRowsChange,
  TRANSCRIPT_FIRST_ITEM_INDEX_START,
  transcriptRowKey,
} from "./transcript-viewport-model";

function message(index: number): ChatRoomMessage {
  return {
    id: `msg-${String(index).padStart(3, "0")}`,
    roomId: "room-1",
    parentMessageId: null,
    content: `Message ${index}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
    deletedAt: null,
    editedAt: null,
    sender: { type: "unknown" },
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: null,
    quote: null,
    membership: null,
    unfurls: null,
  };
}

function row(index: number): RoomTranscriptRow {
  return { kind: "message", message: message(index) };
}

function boundary(cursorIndex: number, isGap = false): RoomTranscriptRow {
  return {
    kind: "boundary",
    cursorMessageId: message(cursorIndex).id,
    isGap,
  };
}

describe("transcriptRowKey", () => {
  it("keys a message row by its id", () => {
    expect(transcriptRowKey(row(3))).toBe("msg-003");
  });

  it("keys an outbound row by its client turn so pending→confirmed keeps one row", () => {
    const pending = createPendingRoomMessage({
      clientTurnId: "turn-1",
      roomId: "room-1",
      content: "hi",
      senderUser: {
        id: "user-1",
        name: "Me",
        email: "me@example.com",
        image: null,
        presence: "online",
      },
      mentionedCoworkerIds: [],
      mentionedSokoBotIds: [],
      quote: null,
    });
    expect(transcriptRowKey({ kind: "message", message: pending })).toBe(
      "turn-1",
    );
  });

  it("keys a boundary row by the cursor it loads from", () => {
    expect(transcriptRowKey(boundary(7, true))).toBe("boundary:msg-007");
  });
});

describe("findTranscriptRowIndex", () => {
  it("finds a message row by message id", () => {
    expect(
      findTranscriptRowIndex([boundary(5), row(5), row(6), row(7)], "msg-006"),
    ).toBe(2);
  });

  it("reports -1 for a message the transcript does not hold", () => {
    expect(findTranscriptRowIndex([row(5), row(6)], "msg-009")).toBe(-1);
  });
});

describe("firstItemIndexAfterRowsChange", () => {
  it("starts high enough that prepends stay positive", () => {
    expect(TRANSCRIPT_FIRST_ITEM_INDEX_START).toBeGreaterThanOrEqual(100_000);
  });

  it("moves back by however many rows landed above the first surviving row", () => {
    // Older page: the boundary above msg-5 becomes a boundary above msg-1
    // plus four rows, all inserted before what used to be the first row.
    const previous = [boundary(5), row(5), row(6)];
    const next = [boundary(1), row(1), row(2), row(3), row(4), row(5), row(6)];
    expect(
      firstItemIndexAfterRowsChange({
        previousRows: previous,
        nextRows: next,
        previousFirstItemIndex: 1000,
      }),
    ).toBe(996);
  });

  it("stays put when rows change below the first row", () => {
    // Gap fill between two ranges: nothing moved above msg-1.
    const previous = [row(1), row(2), boundary(8, true), row(8), row(9)];
    const next = [row(1), row(2), row(3), row(4), row(8), row(9)];
    expect(
      firstItemIndexAfterRowsChange({
        previousRows: previous,
        nextRows: next,
        previousFirstItemIndex: 1000,
      }),
    ).toBe(1000);
  });

  it("stays put when a realtime message is appended", () => {
    const previous = [row(1), row(2)];
    const next = [row(1), row(2), row(3)];
    expect(
      firstItemIndexAfterRowsChange({
        previousRows: previous,
        nextRows: next,
        previousFirstItemIndex: 1000,
      }),
    ).toBe(1000);
  });

  it("moves forward when a row above the viewport is removed", () => {
    // A refresh dropped a deleted first row; everything below shifts up one.
    const previous = [row(1), row(2)];
    const next = [row(2), row(3)];
    expect(
      firstItemIndexAfterRowsChange({
        previousRows: previous,
        nextRows: next,
        previousFirstItemIndex: 1000,
      }),
    ).toBe(1001);
  });

  it("stays put when no previous row survived", () => {
    expect(
      firstItemIndexAfterRowsChange({
        previousRows: [row(1), row(2)],
        nextRows: [row(8), row(9)],
        previousFirstItemIndex: 1000,
      }),
    ).toBe(1000);
  });

  it("stays put when the transcript was empty", () => {
    expect(
      firstItemIndexAfterRowsChange({
        previousRows: [],
        nextRows: [row(1)],
        previousFirstItemIndex: 1000,
      }),
    ).toBe(1000);
  });
});
