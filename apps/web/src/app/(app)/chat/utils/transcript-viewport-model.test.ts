import { describe, expect, it } from "vitest";

import type {
  ChatRoomMessage,
  ChatRoomMessageUnfurl,
} from "@/lib/clients/generated/core";

import { createPendingRoomMessage } from "./outbound-room-message";
import type { RoomTranscriptRow } from "./room-transcript-ranges";
import {
  estimateTranscriptRowHeight,
  findTranscriptRowIndex,
  transcriptRowKey,
} from "./transcript-viewport-model";

function message(
  index: number,
  unfurls: ChatRoomMessage["unfurls"] = null,
): ChatRoomMessage {
  return {
    id: `msg-${String(index).padStart(3, "0")}`,
    roomId: "room-1",
    parentMessageId: null,
    content: `Message ${index}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
    deletedAt: null,
    editedAt: null,
    pinnedAt: null,
    sender: { type: "unknown" },
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: null,
    quote: null,
    membership: null,
    unfurls,
  };
}

function row(
  index: number,
  unfurls: ChatRoomMessage["unfurls"] = null,
): RoomTranscriptRow {
  return { kind: "message", message: message(index, unfurls) };
}

function unfurl(
  fields: Partial<ChatRoomMessageUnfurl> & Pick<ChatRoomMessageUnfurl, "url">,
): ChatRoomMessageUnfurl {
  return {
    title: "Preview",
    description: "A page",
    imageUrl: null,
    siteName: "example.com",
    ...fields,
  };
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

describe("estimateTranscriptRowHeight", () => {
  it("assumes 80px for a short text row", () => {
    expect(estimateTranscriptRowHeight(row(1))).toBe(80);
  });

  it("assumes 80px for a boundary row", () => {
    expect(estimateTranscriptRowHeight(boundary(1))).toBe(80);
  });

  it("assumes 80px when the row is missing", () => {
    expect(estimateTranscriptRowHeight(undefined)).toBe(80);
  });

  it("adds card chrome for a text-only unfurl", () => {
    expect(
      estimateTranscriptRowHeight(
        row(1, [unfurl({ url: "https://example.com/a" })]),
      ),
    ).toBe(230);
  });

  it("adds the 250px image cap plus card chrome for an image unfurl", () => {
    expect(
      estimateTranscriptRowHeight(
        row(1, [
          unfurl({
            url: "https://example.com/a",
            imageUrl: "https://blob.example/preview.png",
          }),
        ]),
      ),
    ).toBe(480);
  });

  it("stacks extras for each visible unfurl", () => {
    expect(
      estimateTranscriptRowHeight(
        row(1, [
          unfurl({
            url: "https://example.com/a",
            imageUrl: "https://blob.example/a.png",
          }),
          unfurl({
            url: "https://example.com/b",
            imageUrl: "https://blob.example/b.png",
          }),
        ]),
      ),
    ).toBe(880);
  });

  it("ignores a title-only card the UI would not render", () => {
    expect(
      estimateTranscriptRowHeight(
        row(1, [
          unfurl({
            url: "https://example.com/a",
            description: null,
            imageUrl: null,
          }),
        ]),
      ),
    ).toBe(80);
  });

  it("adds a 24px line for each line the body wraps to", () => {
    const long = row(1);
    if (long.kind === "message") {
      // 402px phone: 316px of text at 8px a character is 39 characters.
      long.message.content = "x".repeat(39 * 3);
    }
    expect(estimateTranscriptRowHeight(long, 402)).toBe(80 + 2 * 24);
  });

  it("wraps the same body to fewer lines in a wide list", () => {
    const long = row(1);
    if (long.kind === "message") {
      long.message.content = "x".repeat(39 * 3);
    }
    expect(estimateTranscriptRowHeight(long, 1000)).toBe(80);
  });

  it("counts each newline as a line", () => {
    const lines = row(1);
    if (lines.kind === "message") {
      lines.message.content = "a\nb\nc";
    }
    expect(estimateTranscriptRowHeight(lines, 402)).toBe(80 + 2 * 24);
  });

  it("stops at the 16 lines the body is clamped to", () => {
    const huge = row(1);
    if (huge.kind === "message") {
      huge.message.content = "x".repeat(10_000);
    }
    expect(estimateTranscriptRowHeight(huge, 402)).toBe(80 + 15 * 24);
  });

  it("treats a whitespace image URL as text-only", () => {
    expect(
      estimateTranscriptRowHeight(
        row(1, [unfurl({ url: "https://example.com/a", imageUrl: "  " })]),
      ),
    ).toBe(230);
  });
});
