import { describe, expect, it } from "vitest";

import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import { createPendingRoomMessage } from "./outbound-room-message";
import {
  buildRoomTranscriptRows,
  emptyRoomTranscript,
  mergeRoomHeadPage,
  mergeRoomJumpWindow,
  mergeRoomOlderPage,
  type RoomTranscript,
  updateRoomTranscriptMessages,
  withTranscriptRowNeighbors,
} from "./room-transcript-ranges";

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

function messages(from: number, to: number): ChatRoomMessage[] {
  const rows: ChatRoomMessage[] = [];
  for (let index = from; index <= to; index += 1) {
    rows.push(message(index));
  }
  return rows;
}

/** Compact picture of the rows: `older`, `gap`, or a message index. */
function picture(transcript: RoomTranscript): Array<string | number> {
  return buildRoomTranscriptRows(transcript.messages, transcript).map((row) => {
    if (row.kind === "boundary") {
      return row.isGap
        ? `gap@${Number(row.cursorMessageId.slice(4))}`
        : `older@${Number(row.cursorMessageId.slice(4))}`;
    }
    if (row.message.id.startsWith("pending:")) {
      return "pending";
    }
    return Number(row.message.id.slice(4));
  });
}

function openedRoom(): RoomTranscript {
  return mergeRoomHeadPage(emptyRoomTranscript(), {
    messages: messages(90, 99),
    nextCursor: "msg-090",
  });
}

describe("buildRoomTranscriptRows", () => {
  it("renders an empty room as no rows", () => {
    expect(picture(emptyRoomTranscript())).toEqual([]);
  });

  it("puts an older boundary above the newest page when Core has more", () => {
    expect(picture(openedRoom())).toEqual([
      "older@90",
      90,
      91,
      92,
      93,
      94,
      95,
      96,
      97,
      98,
      99,
    ]);
  });

  it("shows no boundary when the newest page is the whole room", () => {
    const transcript = mergeRoomHeadPage(emptyRoomTranscript(), {
      messages: messages(1, 3),
      nextCursor: null,
    });
    expect(picture(transcript)).toEqual([1, 2, 3]);
  });

  it("reads a range left alone by an emptied range above it as older history", () => {
    const transcript = mergeRoomJumpWindow(openedRoom(), {
      messages: messages(50, 52),
      nextCursor: "msg-050",
    });
    const emptiedWindow = updateRoomTranscriptMessages(transcript, (rows) =>
      rows.filter((row) => Number(row.id.slice(4)) >= 90),
    );
    expect(picture(emptiedWindow).slice(0, 2)).toEqual(["older@90", 90]);
  });
});

describe("mergeRoomJumpWindow", () => {
  it("adds a disjoint window as its own range with a gap row above the head", () => {
    const transcript = mergeRoomJumpWindow(openedRoom(), {
      messages: messages(50, 52),
      nextCursor: "msg-050",
    });
    expect(picture(transcript)).toEqual([
      "older@50",
      50,
      51,
      52,
      "gap@90",
      90,
      91,
      92,
      93,
      94,
      95,
      96,
      97,
      98,
      99,
    ]);
  });

  it("joins a window that overlaps the head into one range", () => {
    const opened = openedRoom();
    const headFirst = opened.messages[0];
    const transcript = mergeRoomJumpWindow(opened, {
      messages: messages(85, 92),
      nextCursor: "msg-085",
    });
    expect(picture(transcript)).toEqual([
      "older@85",
      ...messages(85, 99).map((_, i) => 85 + i),
    ]);
    expect(transcript.messages.find((row) => row.id === "msg-090")).toBe(
      headFirst,
    );
  });

  it("needs no boundary change for a window already inside a range", () => {
    const transcript = mergeRoomJumpWindow(openedRoom(), {
      messages: messages(93, 96),
      nextCursor: "msg-093",
    });
    expect(picture(transcript)).toEqual(picture(openedRoom()));
  });

  it("drops the older boundary when the window starts the room", () => {
    const transcript = mergeRoomJumpWindow(openedRoom(), {
      messages: messages(1, 3),
      nextCursor: null,
    });
    expect(picture(transcript)).toEqual([1, 2, 3, "gap@90", ...range(90, 99)]);
  });

  it("puts a window inside an existing gap between two gap rows", () => {
    const first = mergeRoomJumpWindow(openedRoom(), {
      messages: messages(20, 22),
      nextCursor: "msg-020",
    });
    const second = mergeRoomJumpWindow(first, {
      messages: messages(50, 52),
      nextCursor: "msg-050",
    });
    expect(picture(second)).toEqual([
      "older@20",
      20,
      21,
      22,
      "gap@50",
      50,
      51,
      52,
      "gap@90",
      ...range(90, 99),
    ]);
  });

  it("joins two windows that overlap each other", () => {
    const first = mergeRoomJumpWindow(openedRoom(), {
      messages: messages(50, 55),
      nextCursor: "msg-050",
    });
    const second = mergeRoomJumpWindow(first, {
      messages: messages(53, 60),
      nextCursor: "msg-053",
    });
    expect(picture(second)).toEqual([
      "older@50",
      ...range(50, 60),
      "gap@90",
      ...range(90, 99),
    ]);
  });

  it("makes an older disjoint window the first range and keeps the old first range as a gap", () => {
    const first = mergeRoomJumpWindow(openedRoom(), {
      messages: messages(50, 52),
      nextCursor: "msg-050",
    });
    const second = mergeRoomJumpWindow(first, {
      messages: messages(10, 12),
      nextCursor: null,
    });
    expect(picture(second)).toEqual([
      10,
      11,
      12,
      "gap@50",
      50,
      51,
      52,
      "gap@90",
      ...range(90, 99),
    ]);
  });
});

describe("mergeRoomOlderPage", () => {
  const withWindow = () =>
    mergeRoomJumpWindow(openedRoom(), {
      messages: messages(50, 52),
      nextCursor: "msg-050",
    });

  it("walks the oldest range further into the past", () => {
    const transcript = mergeRoomOlderPage(withWindow(), "msg-050", {
      messages: messages(45, 49),
      nextCursor: "msg-045",
    });
    expect(picture(transcript)).toEqual([
      "older@45",
      ...range(45, 52),
      "gap@90",
      ...range(90, 99),
    ]);
  });

  it("marks the start of the room when nothing older comes back", () => {
    const transcript = mergeRoomOlderPage(withWindow(), "msg-050", {
      messages: messages(48, 49),
      nextCursor: null,
    });
    expect(picture(transcript)).toEqual([
      ...range(48, 52),
      "gap@90",
      ...range(90, 99),
    ]);
  });

  it("moves the gap row up when the page does not reach the range above", () => {
    const transcript = mergeRoomOlderPage(withWindow(), "msg-090", {
      messages: messages(80, 89),
      nextCursor: "msg-080",
    });
    expect(picture(transcript)).toEqual([
      "older@50",
      50,
      51,
      52,
      "gap@80",
      ...range(80, 99),
    ]);
  });

  it("closes the gap when the page reaches the range above", () => {
    const transcript = mergeRoomOlderPage(withWindow(), "msg-090", {
      messages: messages(52, 89),
      nextCursor: "msg-052",
    });
    expect(picture(transcript)).toEqual(["older@50", ...range(50, 99)]);
  });

  it("closes the gap when Core has nothing older than the page", () => {
    const transcript = mergeRoomOlderPage(withWindow(), "msg-090", {
      messages: messages(60, 89),
      nextCursor: null,
    });
    expect(picture(transcript)).toEqual([
      "older@50",
      50,
      51,
      52,
      ...range(60, 99),
    ]);
  });

  it("closes the gap when the page comes back empty", () => {
    const transcript = mergeRoomOlderPage(withWindow(), "msg-090", {
      messages: [],
      nextCursor: null,
    });
    expect(picture(transcript)).toEqual([
      "older@50",
      50,
      51,
      52,
      ...range(90, 99),
    ]);
  });
});

describe("mergeRoomHeadPage", () => {
  it("merges a refetched newest page into the head without touching older ranges", () => {
    const transcript = mergeRoomJumpWindow(openedRoom(), {
      messages: messages(50, 52),
      nextCursor: "msg-050",
    });
    const refreshed = mergeRoomHeadPage(transcript, {
      messages: messages(95, 101),
      nextCursor: "msg-095",
    });
    expect(picture(refreshed)).toEqual([
      "older@50",
      50,
      51,
      52,
      "gap@90",
      ...range(90, 101),
    ]);
  });

  it("joins the head with a window a wider refetch reaches", () => {
    const transcript = mergeRoomJumpWindow(openedRoom(), {
      messages: messages(50, 52),
      nextCursor: "msg-050",
    });
    const refreshed = mergeRoomHeadPage(transcript, {
      messages: messages(52, 99),
      nextCursor: "msg-052",
    });
    expect(picture(refreshed)).toEqual(["older@50", ...range(50, 99)]);
  });

  it("starts the transcript from an empty room's first realtime message", () => {
    const transcript = updateRoomTranscriptMessages(
      mergeRoomHeadPage(emptyRoomTranscript(), {
        messages: [],
        nextCursor: null,
      }),
      () => [message(1)],
    );
    expect(picture(transcript)).toEqual([1]);
  });
});

describe("updateRoomTranscriptMessages", () => {
  it("appends a realtime message to the head", () => {
    const transcript = updateRoomTranscriptMessages(
      mergeRoomJumpWindow(openedRoom(), {
        messages: messages(50, 52),
        nextCursor: "msg-050",
      }),
      (rows) => [...rows, message(100)],
    );
    expect(picture(transcript)).toEqual([
      "older@50",
      50,
      51,
      52,
      "gap@90",
      ...range(90, 100),
    ]);
  });

  it("updates a row inside an older range in place", () => {
    const transcript = updateRoomTranscriptMessages(
      mergeRoomJumpWindow(openedRoom(), {
        messages: messages(50, 52),
        nextCursor: "msg-050",
      }),
      (rows) =>
        rows.map((row) =>
          row.id === "msg-051" ? { ...row, content: "Edited" } : row,
        ),
    );
    expect(
      transcript.messages.find((row) => row.id === "msg-051")?.content,
    ).toBe("Edited");
    expect(picture(transcript)).toEqual([
      "older@50",
      50,
      51,
      52,
      "gap@90",
      ...range(90, 99),
    ]);
  });

  it("keeps a boundary in place when its first row is hard-deleted", () => {
    const transcript = updateRoomTranscriptMessages(
      mergeRoomJumpWindow(openedRoom(), {
        messages: messages(50, 52),
        nextCursor: "msg-050",
      }),
      (rows) => rows.filter((row) => row.id !== "msg-090"),
    );
    expect(picture(transcript)).toEqual([
      "older@50",
      50,
      51,
      52,
      "gap@91",
      ...range(91, 99),
    ]);
  });

  it("keeps a pending outbound shell after the head", () => {
    const pending = createPendingRoomMessage({
      clientTurnId: "turn-1",
      roomId: "room-1",
      content: "pending",
      senderUser: {
        id: "user-1",
        name: "Ada",
        email: "ada@example.com",
        image: null,
        presence: "offline",
      },
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 100)),
    });
    const transcript = updateRoomTranscriptMessages(
      mergeRoomJumpWindow(openedRoom(), {
        messages: messages(50, 52),
        nextCursor: "msg-050",
      }),
      (rows) => [...rows, pending],
    );
    expect(transcript.messages.at(-1)?.id).toBe(pending.id);
    expect(transcript.rangeEdges).toHaveLength(2);
    expect(picture(transcript)).toEqual([
      "older@50",
      50,
      51,
      52,
      "gap@90",
      ...range(90, 99),
      "pending",
    ]);

    const refreshed = mergeRoomHeadPage(transcript, {
      messages: messages(95, 101),
      nextCursor: "msg-095",
    });
    expect(refreshed.messages.at(-1)?.id).toBe(pending.id);
    expect(picture(refreshed)).toEqual([
      "older@50",
      50,
      51,
      52,
      "gap@90",
      ...range(90, 101),
      "pending",
    ]);
  });
});

describe("withTranscriptRowNeighbors", () => {
  it("breaks continuation across a gap and keeps the day neighbor", () => {
    const transcript = mergeRoomJumpWindow(openedRoom(), {
      messages: messages(50, 52),
      nextCursor: "msg-050",
    });
    const rows = withTranscriptRowNeighbors(
      buildRoomTranscriptRows(transcript.messages, transcript),
    );
    const afterGap = rows.find(
      (row) => row.kind === "message" && row.message.id === "msg-090",
    );
    expect(afterGap?.kind).toBe("message");
    if (afterGap?.kind !== "message") {
      return;
    }
    expect(afterGap.previousMessage).toBeUndefined();
    expect(afterGap.dayPreviousMessage?.id).toBe("msg-052");
  });

  it("keeps continuation neighbors inside a range", () => {
    const transcript = openedRoom();
    const rows = withTranscriptRowNeighbors(
      buildRoomTranscriptRows(transcript.messages, transcript),
    );
    const second = rows.find(
      (row) => row.kind === "message" && row.message.id === "msg-091",
    );
    expect(second?.kind).toBe("message");
    if (second?.kind !== "message") {
      return;
    }
    expect(second.previousMessage?.id).toBe("msg-090");
    expect(second.dayPreviousMessage?.id).toBe("msg-090");
  });
});

function range(from: number, to: number): number[] {
  return messages(from, to).map((_, index) => from + index);
}
